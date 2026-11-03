use anyhow::Result;
use goose_providers::conversation::message::{Message, MessageContent};
use goose_providers::conversation::token_usage::{ProviderUsage, Usage};
use goose_providers::errors::ProviderError;
use rmcp::model::Role;
use serde::Serialize;
use tracing::warn;

use crate::format::format_message_for_compacting;
use crate::model::{CompactionModel, TokenEstimator};
use crate::structured::StructuredSummary;
use crate::templates::{render, Templates};

const REMOVAL_PERCENTAGES: [u32; 5] = [0, 10, 20, 50, 100];

const SUMMARIZE_REQUEST_TEXT: &str =
    "Please summarize the conversation history provided in the system prompt.";

#[derive(Serialize)]
struct SummarizeContext {
    messages: String,
}

#[derive(Debug)]
pub struct Summary {
    pub message: Message,
    pub usage: ProviderUsage,
}

fn has_tool_response(msg: &Message) -> bool {
    msg.content
        .iter()
        .any(|c| matches!(c, MessageContent::ToolResponse(_)))
}

/// Drops tool responses from the middle outwards, where context is least
/// likely to matter, to fit an oversized history into the summarizer.
fn filter_tool_responses(messages: &[Message], remove_percent: u32) -> Vec<&Message> {
    if remove_percent == 0 {
        return messages.iter().collect();
    }

    let tool_indices: Vec<usize> = messages
        .iter()
        .enumerate()
        .filter(|(_, msg)| has_tool_response(msg))
        .map(|(i, _)| i)
        .collect();

    if tool_indices.is_empty() {
        return messages.iter().collect();
    }

    let num_to_remove = ((tool_indices.len() * remove_percent as usize) / 100).max(1);
    let middle = tool_indices.len() / 2;
    let mut indices_to_remove = Vec::new();

    for i in 0..num_to_remove {
        let offset = i / 2;
        if i % 2 == 0 {
            if middle > offset {
                indices_to_remove.push(tool_indices[middle - offset - 1]);
            }
        } else if middle + offset < tool_indices.len() {
            indices_to_remove.push(tool_indices[middle + offset]);
        }
    }

    messages
        .iter()
        .enumerate()
        .filter(|(i, _)| !indices_to_remove.contains(i))
        .map(|(_, msg)| msg)
        .collect()
}

/// When the model didn't follow the structured output format (schema-ignoring
/// models, user-customized prompts), the raw response text is kept unchanged
/// as the summary.
fn apply_structured_summary(response: &mut Message, summary_template: &str) {
    let Some(summary) = StructuredSummary::parse(&response.as_concat_text()) else {
        return;
    };
    match summary.render_with(summary_template) {
        Ok(rendered) if !rendered.trim().is_empty() => {
            response.content = vec![MessageContent::text(rendered)];
        }
        Ok(_) => warn!(
            "Structured compaction summary rendered empty (broken template override?), keeping raw output"
        ),
        Err(e) => warn!("Failed to render structured compaction summary, keeping raw output: {e}"),
    }
}

async fn ensure_usage_tokens(
    usage: &mut ProviderUsage,
    estimator: &dyn TokenEstimator,
    system_prompt: &str,
    request: &[Message],
    response: &Message,
) {
    if usage.usage.input_tokens.is_none() {
        let count = estimator.count_chat_tokens(system_prompt, request).await;
        usage.usage.input_tokens = Some(count as i32);
    }
    if usage.usage.output_tokens.is_none() {
        let text = response
            .content
            .iter()
            .map(|c| format!("{}", c))
            .collect::<Vec<_>>()
            .join(" ");
        let count = estimator.count_text_tokens(&text).await;
        usage.usage.output_tokens = Some(count as i32);
    }
    if let (Some(input), Some(output)) = (usage.usage.input_tokens, usage.usage.output_tokens) {
        usage.usage.total_tokens = Some(input + output);
    }
}

/// Runs the summarizer model once on `messages`. Returns `Ok(Some(summary))` on
/// success, `Ok(None)` when the model overflowed its context window on this input
/// (caller should shrink and retry), and `Err` for genuine, non-context errors.
async fn try_summarize_slice(
    model: &dyn CompactionModel,
    estimator: Option<&dyn TokenEstimator>,
    templates: &Templates,
    messages: &[&Message],
    request: &[Message],
) -> Result<Option<Summary>> {
    let context = SummarizeContext {
        messages: messages
            .iter()
            .map(|&msg| format_message_for_compacting(msg))
            .collect::<Vec<_>>()
            .join("\n"),
    };
    let system_prompt = render(&templates.compaction, &context)?;

    match model.complete(&system_prompt, request).await {
        Ok((mut response, mut usage)) => {
            response.role = Role::User;

            // Usage must reflect the raw model output (billable tokens), so
            // estimate before the response is rewritten to the smaller rendered
            // summary.
            if let Some(estimator) = estimator {
                ensure_usage_tokens(&mut usage, estimator, &system_prompt, request, &response)
                    .await;
            }

            apply_structured_summary(&mut response, &templates.summary);

            Ok(Some(Summary {
                message: response,
                usage,
            }))
        }
        Err(ProviderError::ContextLengthExceeded(_)) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Prepends a short note so the agent knows earlier turns were dropped from the
/// (otherwise model-written) summary.
fn with_truncation_note(mut summary: Summary, dropped: usize) -> Summary {
    if dropped == 0 {
        return summary;
    }
    let note = MessageContent::text(format!(
        "[Note: the earliest {dropped} message(s) exceeded the model's context window and were omitted from this summary. Continue from the most recent context below.]\n\n"
    ));
    let mut content = Vec::with_capacity(summary.message.content.len() + 1);
    content.push(note);
    content.append(&mut summary.message.content);
    summary.message.content = content;
    summary
}

/// Last-resort summary built WITHOUT a model call, for when not even a single
/// recent message fits the summarizer. Keeps the tail of the most recent message
/// so the live task is not lost, and never fails - compaction must always return
/// something the conversation can continue from.
fn synthetic_truncation_summary(messages: &[&Message]) -> Summary {
    const TAIL_CHARS: usize = 2000;
    let recent = messages
        .last()
        .map(|msg| msg.as_concat_text())
        .unwrap_or_default();
    // Keep the last TAIL_CHARS characters without slicing on a byte index (which
    // could split a UTF-8 char): collect from the end, then restore order.
    let mut tail_chars: Vec<char> = recent.chars().rev().take(TAIL_CHARS).collect();
    tail_chars.reverse();
    let tail: String = tail_chars.into_iter().collect();

    let text = format!(
        "[The conversation history was too large to summarize and had to be truncated to keep going. \
         Earlier context is unavailable. Most recent message follows.]\n\n{tail}"
    );
    Summary {
        message: Message::user().with_text(text),
        usage: ProviderUsage::new(String::new(), Usage::default()),
    }
}

/// Summarizes `messages` into a single user-role message.
///
/// Three escalating strategies make this ALWAYS return a usable summary instead
/// of dead-ending the conversation:
///   1. Summarize the full history, dropping tool responses from the middle
///      outwards when the summarizer overflows.
///   2. If even a tool-response-free history overflows, keep only the most recent
///      messages (halving the kept tail until it fits). The full history stays
///      user-visible; only the agent-visible summary shrinks.
///   3. If not even the single most recent message fits, synthesize a summary
///      locally so compaction still returns.
///
/// Only genuine, non-context errors (network, auth, broken template) surface.
pub async fn summarize(
    model: &dyn CompactionModel,
    estimator: Option<&dyn TokenEstimator>,
    templates: &Templates,
    messages: &[Message],
) -> Result<Summary> {
    let request = vec![Message::user().with_text(SUMMARIZE_REQUEST_TEXT)];

    // Strategy 1: full history, progressively dropping tool responses.
    for &remove_percent in REMOVAL_PERCENTAGES.iter() {
        let filtered = filter_tool_responses(messages, remove_percent);
        if let Some(summary) =
            try_summarize_slice(model, estimator, templates, &filtered, &request).await?
        {
            return Ok(summary);
        }
    }

    // Strategy 2: tool responses are all gone but the history still overflows.
    // Keep only the most recent messages, halving the kept tail until it fits.
    let stripped = filter_tool_responses(messages, 100);
    let mut keep = stripped.len() / 2;
    while keep >= 1 {
        let tail = &stripped[stripped.len() - keep..];
        if let Some(summary) =
            try_summarize_slice(model, estimator, templates, tail, &request).await?
        {
            return Ok(with_truncation_note(summary, stripped.len() - keep));
        }
        keep /= 2;
    }

    // Strategy 3: not even one message fits - synthesize locally, never fail.
    Ok(synthetic_truncation_summary(&stripped))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::CompactionModel;
    use crate::templates::Templates;
    use async_trait::async_trait;
    use rmcp::model::CallToolResult;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct OverflowingModel {
        request_count: AtomicUsize,
    }

    impl OverflowingModel {
        fn new() -> Self {
            Self {
                request_count: AtomicUsize::new(0),
            }
        }

        fn request_count(&self) -> usize {
            self.request_count.load(Ordering::Relaxed)
        }
    }

    #[async_trait]
    impl CompactionModel for OverflowingModel {
        async fn complete(
            &self,
            _system: &str,
            _messages: &[Message],
        ) -> Result<(Message, ProviderUsage), ProviderError> {
            self.request_count.fetch_add(1, Ordering::Relaxed);
            Err(ProviderError::ContextLengthExceeded(
                "Prompt exceeds context limit".to_string(),
            ))
        }
    }

    /// Overflows only while the rendered prompt still embeds more than
    /// `max_marks` tagged messages, so a small-enough recent tail succeeds.
    struct FitsFewMarksModel {
        request_count: AtomicUsize,
        max_marks: usize,
    }

    #[async_trait]
    impl CompactionModel for FitsFewMarksModel {
        async fn complete(
            &self,
            system: &str,
            _messages: &[Message],
        ) -> Result<(Message, ProviderUsage), ProviderError> {
            self.request_count.fetch_add(1, Ordering::Relaxed);
            if system.matches("MSGMARK").count() > self.max_marks {
                Err(ProviderError::ContextLengthExceeded(
                    "Prompt exceeds context limit".to_string(),
                ))
            } else {
                Ok((
                    Message::assistant().with_text("MODEL_SUMMARY"),
                    ProviderUsage::new("test".to_string(), Usage::default()),
                ))
            }
        }
    }

    // Der Dead-End "Failed to compact..." darf NIE mehr entstehen. Ueberlaeuft der
    // Summarizer sogar ohne Tool-Antworten, liefert summarize eine (lokal
    // synthetisierte) Zusammenfassung statt eines Fehlers - der Chat bleibt nutzbar.
    #[tokio::test]
    async fn never_dead_ends_when_model_always_overflows() {
        let model = OverflowingModel::new();
        let messages = vec![Message::user().with_text("oversized conversation")];

        let summary = summarize(&model, None, &Templates::default(), &messages)
            .await
            .expect("compaction must never dead-end on context overflow");

        assert_eq!(summary.message.role, Role::User);
        assert!(summary
            .message
            .as_concat_text()
            .contains("too large to summarize"));
        // Strategy 1 exhausts all removal percentages before falling back.
        assert_eq!(model.request_count(), REMOVAL_PERCENTAGES.len());
    }

    #[tokio::test]
    async fn never_dead_ends_with_tool_responses() {
        let model = OverflowingModel::new();
        let messages = vec![
            Message::user().with_text("please read the file"),
            Message::user().with_tool_response(
                "tool_0",
                Ok(CallToolResult::success(vec![
                    rmcp::model::ContentBlock::text("contents"),
                ])),
            ),
        ];

        let summary = summarize(&model, None, &Templates::default(), &messages)
            .await
            .expect("compaction must never dead-end even with tool responses");

        assert_eq!(summary.message.role, Role::User);
        assert!(summary
            .message
            .as_concat_text()
            .contains("too large to summarize"));
    }

    // Reicht die volle Historie nicht, muss summarize auf die juengsten Nachrichten
    // zurueckfallen und sie zusammenfassen (mit Hinweis auf die weggelassenen Turns).
    #[tokio::test]
    async fn falls_back_to_recent_tail_when_full_history_overflows() {
        let model = FitsFewMarksModel {
            request_count: AtomicUsize::new(0),
            max_marks: 2,
        };
        let messages: Vec<Message> = (0..8)
            .map(|i| Message::user().with_text(format!("MSGMARK block {i}")))
            .collect();

        let summary = summarize(&model, None, &Templates::default(), &messages)
            .await
            .expect("must recover via recent-tail fallback");

        let text = summary.message.as_concat_text();
        assert!(
            text.contains("MODEL_SUMMARY"),
            "uses the model summary of the tail"
        );
        assert!(
            text.contains("were omitted"),
            "notes that earlier turns were dropped"
        );
        assert_eq!(summary.message.role, Role::User);
    }
}
