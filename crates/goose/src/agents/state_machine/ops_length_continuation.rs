//! TB-Software: Setzt eine am Ausgabe-Token-Limit abgeschnittene Antwort automatisch fort.
//!
//! Paritaet zum Legacy-Agent-Loop (agent.rs, `MAX_LENGTH_CONTINUATIONS`): endet der Turn mit
//! einer Assistant-Antwort ohne offene Tool-Requests, wurde diese aber am Ausgabe-Token-Limit
//! abgeschnitten (`finish_reason: length`), injiziert diese Operation eine versteckte
//! Fortsetzungs-Nachricht und laesst die Maschine erneut inferieren. So reissen lange autonome
//! Laeufe nicht ab. Gedeckelt via `MAX_LENGTH_CONTINUATIONS`; die Zahl der bereits erfolgten
//! Fortsetzungen wird rekonstruierbar aus den Message-Notes des aktuellen Turns gezaehlt.

use anyhow::Result;
use async_trait::async_trait;

use crate::agents::state_machine::{
    applied, ends_turn, messages_since_kickoff, not_applicable, Emitter, GooseEffect, Operation,
    OperationResult,
};
use crate::conversation::message::{Message, SystemNotificationType};
use crate::conversation::Conversation;
use crate::session::Session;

const OP_NAME: &str = "length_continuation";
const MAX_LENGTH_CONTINUATIONS: u32 = 3;
const CONTINUED_NOTE: &str = "continued";
const LENGTH_CONTINUATION_MESSAGE: &str =
    "Deine vorige Antwort wurde am Ausgabe-Token-Limit abgeschnitten. Setze GENAU dort fort, \
     wo du aufgehoert hast — ohne den bereits geschriebenen Teil zu wiederholen. Ist die \
     Aufgabe damit erledigt, schliesse sauber ab.";

/// Wie oft wurde in diesem Turn bereits automatisch fortgesetzt (aus den Notes gezaehlt).
fn continuations_so_far(messages: &[Message]) -> u32 {
    messages
        .iter()
        .filter(|message| message.metadata.operation_note(OP_NAME, CONTINUED_NOTE).is_some())
        .count() as u32
}

/// Soll fortgesetzt werden? Turn wuerde enden (Assistant, keine Tool-Requests), die letzte
/// Antwort wurde am Ausgabe-Token-Limit abgeschnitten, und die Deckelung ist nicht erreicht.
fn should_continue(messages: &[Message]) -> bool {
    if !ends_turn(messages) {
        return false;
    }
    let reached = messages
        .last()
        .is_some_and(|message| message.metadata.output_token_limit_reached);
    reached && continuations_so_far(messages) < MAX_LENGTH_CONTINUATIONS
}

pub struct LengthContinuationOperation;

#[async_trait]
impl Operation<Session, GooseEffect> for LengthContinuationOperation {
    fn name(&self) -> &'static str {
        OP_NAME
    }

    async fn run(
        &self,
        _session: &Session,
        conversation: &Conversation,
        emit: &Emitter,
    ) -> Result<OperationResult<GooseEffect>> {
        let messages = messages_since_kickoff(conversation)?;
        if !should_continue(messages) {
            return not_applicable();
        }

        let mut message = Message::user()
            .with_text(LENGTH_CONTINUATION_MESSAGE)
            .with_visibility(false, true);
        self.set_message_meta(
            &mut message,
            CONTINUED_NOTE,
            serde_json::json!(continuations_so_far(messages) + 1),
        );
        emit.message(Message::assistant().with_system_notification(
            SystemNotificationType::InlineMessage,
            "Antwort war abgeschnitten — setze automatisch fort …".to_string(),
        ))
        .await;
        applied([message.into()])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assistant_at_limit() -> Message {
        let mut message = Message::assistant().with_text("abgeschnitten …");
        message.metadata.output_token_limit_reached = true;
        message
    }

    fn continuation_note() -> Message {
        let mut message = Message::user()
            .with_text(LENGTH_CONTINUATION_MESSAGE)
            .with_visibility(false, true);
        message
            .metadata
            .set_operation_note(OP_NAME, CONTINUED_NOTE, serde_json::json!(1));
        message
    }

    #[test]
    fn continues_when_cut_off_at_limit_without_tools() {
        let messages = vec![Message::user().with_text("mach was Langes"), assistant_at_limit()];
        assert!(should_continue(&messages));
    }

    #[test]
    fn does_not_continue_when_not_cut_off() {
        let messages = vec![
            Message::user().with_text("frage"),
            Message::assistant().with_text("vollstaendige Antwort"),
        ];
        assert!(!should_continue(&messages));
    }

    #[test]
    fn does_not_continue_when_turn_is_not_ended() {
        // Letzte Nachricht ist keine Assistant-Antwort -> Turn endet hier nicht.
        let messages = vec![assistant_at_limit(), Message::user().with_text("weiter?")];
        assert!(!should_continue(&messages));
    }

    #[test]
    fn stops_at_the_continuation_cap() {
        let mut messages = vec![Message::user().with_text("start")];
        for _ in 0..MAX_LENGTH_CONTINUATIONS {
            messages.push(continuation_note());
        }
        messages.push(assistant_at_limit());
        assert_eq!(continuations_so_far(&messages), MAX_LENGTH_CONTINUATIONS);
        assert!(!should_continue(&messages));
    }
}
