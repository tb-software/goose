//! TB-Software: Recovery fuer als TEXT geleakte Werkzeug-Aufrufe.
//!
//! Manche Modelle/Nodes geben Werkzeug-Aufrufe als reinen TEXT aus statt als native `tool_calls`:
//! ```text
//! <tool_call><function=NAME><parameter=KEY>VALUE</parameter>...</function></tool_call>
//! ```
//! oder als Hermes-JSON:
//! ```text
//! <tool_call>{"name":"NAME","arguments":{...}}</tool_call>
//! ```
//! Im Modus "Nativ" (ohne Toolshim/Ollama) erkennt Goose das nicht als Aufruf -> es erscheint nur als
//! Text, wird NIE ausgefuehrt, und die autonome Schleife bleibt stehen (der Nutzer muss wieder
//! ankicken). Dieser deterministische Parser (kein LLM) faengt das auf.
//!
//! SICHERHEIT: Der Recovery greift NUR, wenn die Nachricht KEINE nativen tool_calls enthaelt (der
//! Normalfall bleibt voellig unberuehrt) und nur bei dem sehr spezifischen `<tool_call>`/`<function=`-
//! Format. Erkennbare Namen werden auf den kanonischen Tool-Namen aufgeloest.

use crate::conversation::message::{Message, MessageContent};
use rmcp::model::{object, CallToolRequestParams, Tool};
use serde_json::{Map, Value};

struct LeakedCall {
    name: String,
    args: Value, // immer ein JSON-Objekt
    raw: String, // Original-Span, um ihn aus dem Text zu entfernen
}

/// Wandelt als Text geleakte Tool-Calls in echte ToolRequests um. No-op, wenn bereits native
/// tool_calls vorhanden sind oder kein wohlgeformter Tool-Call-Text gefunden wird.
pub fn recover_leaked_tool_calls(message: Message, tools: &[Tool]) -> Message {
    // SICHERHEIT: nur eingreifen, wenn gar keine nativen Tool-Requests da sind.
    if message
        .content
        .iter()
        .any(|c| matches!(c, MessageContent::ToolRequest(_)))
    {
        return message;
    }

    let full_text: String = message
        .content
        .iter()
        .filter_map(|c| match c {
            MessageContent::Text(t) => Some(t.text.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");

    if !full_text.contains("<tool_call>") && !full_text.contains("<function=") {
        return message;
    }

    let parsed = parse_leaked_tool_calls(&full_text);
    if parsed.is_empty() {
        return message;
    }

    let mut message = message;

    // Die geparsten Spans aus den Text-Bloecken entfernen (saubere Historie).
    for p in &parsed {
        for c in message.content.iter_mut() {
            if let MessageContent::Text(t) = c {
                if t.text.contains(&p.raw) {
                    t.text = t.text.replace(&p.raw, "");
                }
            }
        }
    }
    for c in message.content.iter_mut() {
        if let MessageContent::Text(t) = c {
            t.text = t.text.trim().to_string();
        }
    }
    message
        .content
        .retain(|c| !matches!(c, MessageContent::Text(t) if t.text.is_empty()));

    let ts = chrono::Utc::now().timestamp_millis();
    for (idx, p) in parsed.into_iter().enumerate() {
        let name = resolve_tool_name(&p.name, tools).unwrap_or(p.name);
        let id = format!("call_rec_{ts}_{idx}");
        message = message.with_tool_request(
            id,
            Ok(CallToolRequestParams::new(name).with_arguments(object(p.args))),
        );
    }
    message
}

/// Loest einen (evtl. abgekuerzten) Tool-Namen auf den kanonischen Namen eines verfuegbaren Tools auf:
/// exakt, dann case-insensitiv, dann als Suffix nach `__`/`.` (namespaced Tools). Sonst None.
fn resolve_tool_name(raw: &str, tools: &[Tool]) -> Option<String> {
    for t in tools {
        if t.name.as_ref() == raw {
            return Some(t.name.to_string());
        }
    }
    let raw_l = raw.to_lowercase();
    for t in tools {
        if t.name.to_lowercase() == raw_l {
            return Some(t.name.to_string());
        }
    }
    for t in tools {
        // Namespace nur an "__" (Goose-Konvention) bzw. "." trennen, NICHT an einzelnem "_"
        // (sonst wuerde "text_editor" faelschlich zu "editor").
        let suffix = t.name.rsplit("__").next().unwrap_or(t.name.as_ref());
        let suffix = suffix.rsplit('.').next().unwrap_or(suffix);
        if suffix.to_lowercase() == raw_l {
            return Some(t.name.to_string());
        }
    }
    None
}

fn parse_leaked_tool_calls(text: &str) -> Vec<LeakedCall> {
    let mut out = Vec::new();

    // 1) <tool_call> ... </tool_call> Bloecke.
    const OPEN: &str = "<tool_call>";
    const CLOSE: &str = "</tool_call>";
    let mut from = 0usize;
    while let Some(start_rel) = text[from..].find(OPEN) {
        let start = from + start_rel;
        let inner_start = start + OPEN.len();
        let Some(end_rel) = text[inner_start..].find(CLOSE) else {
            break;
        };
        let inner_end = inner_start + end_rel;
        let raw = text[start..inner_end + CLOSE.len()].to_string();
        let inner = text[inner_start..inner_end].trim();
        if let Some(call) = parse_one_call(inner, raw) {
            out.push(call);
        }
        from = inner_end + CLOSE.len();
    }

    // 2) Fallback: nackte <function=...>...</function> ohne <tool_call>-Wrapper.
    if out.is_empty() {
        let mut from = 0usize;
        while let Some(s_rel) = text[from..].find("<function=") {
            let s = from + s_rel;
            let Some(e_rel) = text[s..].find("</function>") else {
                break;
            };
            let e = s + e_rel + "</function>".len();
            let raw = text[s..e].to_string();
            if let Some(call) = parse_function_form(&text[s..e], raw) {
                out.push(call);
            }
            from = e;
        }
    }

    out
}

fn parse_one_call(inner: &str, raw: String) -> Option<LeakedCall> {
    let trimmed = inner.trim();
    // Hermes-JSON-Variante: {"name":"x","arguments":{...}}
    if trimmed.starts_with('{') {
        if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
            let name = v.get("name").and_then(Value::as_str)?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            let args = match v.get("arguments") {
                Some(a) if a.is_object() => a.clone(),
                _ => Value::Object(Map::new()),
            };
            return Some(LeakedCall { name, args, raw });
        }
    }
    // XML-Variante.
    parse_function_form(inner, raw)
}

fn parse_function_form(inner: &str, raw: String) -> Option<LeakedCall> {
    let fstart = inner.find("<function=")? + "<function=".len();
    let fname_end = inner[fstart..].find('>')? + fstart;
    let name = inner[fstart..fname_end].trim().to_string();
    if name.is_empty() {
        return None;
    }

    let mut args = Map::new();
    let mut from = fname_end;
    while let Some(p_rel) = inner[from..].find("<parameter=") {
        let p = from + p_rel + "<parameter=".len();
        let Some(key_end_rel) = inner[p..].find('>') else {
            break;
        };
        let key_end = p + key_end_rel;
        let key = inner[p..key_end].trim().to_string();
        let val_start = key_end + 1;
        let Some(val_end_rel) = inner[val_start..].find("</parameter>") else {
            break;
        };
        let val_end = val_start + val_end_rel;
        let val_raw = inner[val_start..val_end].trim();
        if !key.is_empty() {
            args.insert(key, coerce_value(val_raw));
        }
        from = val_end + "</parameter>".len();
    }

    Some(LeakedCall {
        name,
        args: Value::Object(args),
        raw,
    })
}

/// Zahlen/Bool/Objekt/Array automatisch typisieren; alles andere bleibt String (Pfade z. B.
/// `G:\...` sind kein gueltiges JSON -> bleiben korrekt String).
fn coerce_value(s: &str) -> Value {
    if let Ok(v) = serde_json::from_str::<Value>(s) {
        if v.is_number() || v.is_boolean() || v.is_object() || v.is_array() || v.is_null() {
            return v;
        }
    }
    Value::String(s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(name: &'static str) -> Tool {
        Tool::new(name, "test", Map::new())
    }

    fn tool_requests(m: &Message) -> Vec<(String, Value)> {
        m.content
            .iter()
            .filter_map(|c| match c {
                MessageContent::ToolRequest(r) => r.tool_call.as_ref().ok().map(|tc| {
                    let args = tc
                        .arguments
                        .clone()
                        .map(Value::Object)
                        .unwrap_or(Value::Null);
                    (tc.name.to_string(), args)
                }),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn parses_xml_form_two_calls() {
        let text = concat!(
            "Ich pruefe die Startdaten.\n",
            "<tool_call>\n<function=read>\n<parameter=path>\nG:\\a\\charge7.txt\n</parameter>\n</function>\n</tool_call>\n",
            "<tool_call>\n<function=read>\n<parameter=path>\nG:\\a\\charge7.py\n</parameter>\n</function>\n</tool_call>"
        );
        let calls = parse_leaked_tool_calls(text);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "read");
        assert_eq!(calls[0].args["path"], Value::String("G:\\a\\charge7.txt".into()));
        assert_eq!(calls[1].args["path"], Value::String("G:\\a\\charge7.py".into()));
    }

    #[test]
    fn parses_hermes_json_form() {
        let text = r#"<tool_call>{"name":"shell","arguments":{"command":"ls","timeout":5}}</tool_call>"#;
        let calls = parse_leaked_tool_calls(text);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "shell");
        assert_eq!(calls[0].args["command"], Value::String("ls".into()));
        assert_eq!(calls[0].args["timeout"], Value::from(5));
    }

    #[test]
    fn coerces_param_types() {
        // Zahl/Bool werden typisiert, Pfade bleiben String.
        assert_eq!(coerce_value("5"), Value::from(5));
        assert_eq!(coerce_value("true"), Value::Bool(true));
        assert_eq!(coerce_value("G:\\x\\y.txt"), Value::String("G:\\x\\y.txt".into()));
        assert_eq!(coerce_value("hallo welt"), Value::String("hallo welt".into()));
    }

    #[test]
    fn no_tool_call_text_is_empty() {
        assert!(parse_leaked_tool_calls("nur ganz normaler Text ohne Aufrufe").is_empty());
    }

    #[test]
    fn recover_converts_leaked_text_and_strips_it() {
        let msg = Message::assistant().with_text(
            "Los geht's.\n<tool_call>\n<function=read>\n<parameter=path>\n/tmp/a.txt\n</parameter>\n</function>\n</tool_call>",
        );
        let out = recover_leaked_tool_calls(msg, &[]);
        let trs = tool_requests(&out);
        assert_eq!(trs.len(), 1);
        assert_eq!(trs[0].0, "read");
        assert_eq!(trs[0].1["path"], Value::String("/tmp/a.txt".into()));
        // Der Leak-Text wurde entfernt, nur die Prosa bleibt.
        let text: String = out
            .content
            .iter()
            .filter_map(|c| match c {
                MessageContent::Text(t) => Some(t.text.clone()),
                _ => None,
            })
            .collect();
        assert!(!text.contains("<tool_call>"));
        assert!(text.contains("Los geht"));
    }

    #[test]
    fn recover_resolves_namespaced_tool_name() {
        let msg = Message::assistant().with_text(
            "<tool_call><function=text_editor><parameter=path>/a</parameter></function></tool_call>",
        );
        let out = recover_leaked_tool_calls(msg, &[tool("developer__text_editor")]);
        let trs = tool_requests(&out);
        assert_eq!(trs.len(), 1);
        assert_eq!(trs[0].0, "developer__text_editor");
    }

    #[test]
    fn recover_noop_when_native_tool_calls_present() {
        // SICHERHEIT: native tool_calls -> unveraendert, kein doppelter Recovery.
        let msg = Message::assistant()
            .with_text("<tool_call><function=read><parameter=path>/a</parameter></function></tool_call>")
            .with_tool_request("call_1", Ok(CallToolRequestParams::new("read")));
        let out = recover_leaked_tool_calls(msg, &[]);
        assert_eq!(tool_requests(&out).len(), 1);
        // Keine zusaetzliche Recovery-Anfrage (id beginnt nicht mit call_rec_).
        for c in &out.content {
            if let MessageContent::ToolRequest(r) = c {
                assert!(!r.id.starts_with("call_rec_"));
            }
        }
    }

    #[test]
    fn recover_noop_on_plain_text() {
        let msg = Message::assistant().with_text("Alles erledigt, keine Werkzeuge noetig.");
        let out = recover_leaked_tool_calls(msg, &[]);
        assert!(tool_requests(&out).is_empty());
    }
}
