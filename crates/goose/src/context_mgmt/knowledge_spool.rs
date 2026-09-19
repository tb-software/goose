//! TB-Software Milestone [12]: Wissens-Ablage bei der Verdichtung.
//!
//! Beim Verdichten (dem einzigen Chokepoint `compact_messages`) schreiben wir eine kompakte
//! "Spool"-Datei mit dem herausgefallenen Verlauf + der Zusammenfassung. Der Electron-Main-Prozess
//! liest sie und legt die `.knowledge/`-Ablage an (getesteter TS-Writer). Alles hier ist
//! best-effort und darf die Verdichtung NIE beeinflussen (Fehler werden nur geloggt).
use crate::config::Config;
use crate::conversation::message::Message;
use crate::session::export_session_to_markdown;
use crate::session::session_manager::SessionManager;
use serde_json::json;
use std::path::PathBuf;
use tracing::{info, warn};

/// Von Electron-Main gesetzter Ordner. Ohne diese Env passiert nichts (z. B. CLI-only Nutzung).
fn spool_dir() -> Option<PathBuf> {
    std::env::var("TB_KNOWLEDGE_SPOOL_DIR")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
}

fn knowledge_enabled() -> bool {
    Config::global()
        .get_param::<bool>("GOOSE_KNOWLEDGE_ENABLED")
        .unwrap_or(true)
}

pub(crate) struct SpoolInputs {
    pub session_id: String,
    pub working_dir: String,
    pub title: String,
    pub model: Option<String>,
    pub scope: String,
    pub global_dir: Option<String>,
    pub local_dirname: Option<String>,
    pub summary_text: String,
    pub detail_markdown: String,
    pub compaction_iso: String,
}

/// Reine Payload-Erzeugung (unit-testbar). Feldnamen == KnowledgePersistRequest im TS-Writer.
pub(crate) fn build_payload(i: &SpoolInputs) -> serde_json::Value {
    json!({
        "scope": i.scope,
        "workingDir": i.working_dir,
        "globalDir": i.global_dir,
        "localDirName": i.local_dirname,
        "sessionId": i.session_id,
        "title": i.title,
        "model": i.model,
        "summaryText": i.summary_text,
        "detailMarkdown": i.detail_markdown,
        "compactionIso": i.compaction_iso,
    })
}

fn write_payload(dir: &PathBuf, payload: &serde_json::Value) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let id = uuid::Uuid::now_v7();
    let tmp = dir.join(format!(".{id}.tmp"));
    let target = dir.join(format!("{id}.json"));
    let bytes = serde_json::to_vec_pretty(payload).unwrap_or_default();
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &target)?; // atomar
    Ok(target)
}

/// Best-effort: schreibt die Spool-Datei fürs Wissen. Loggt Fehler, gibt nie einen Fehler zurück.
pub(crate) async fn spool_compaction(
    session_id: &str,
    model_name: &str,
    messages_to_compact: &[Message],
    summary_text: &str,
) {
    let Some(dir) = spool_dir() else {
        return;
    };
    if !knowledge_enabled() {
        return;
    }

    let session = match SessionManager::instance().get_session(session_id, false).await {
        Ok(s) => s,
        Err(e) => {
            warn!("knowledge spool: Session {session_id} nicht ladbar: {e}");
            return;
        }
    };

    let cfg = Config::global();
    let scope = cfg
        .get_param::<String>("GOOSE_KNOWLEDGE_SCOPE")
        .unwrap_or_else(|_| "local".to_string());
    let global_dir = cfg.get_param::<String>("GOOSE_KNOWLEDGE_GLOBAL_DIR").ok();
    let local_dirname = cfg.get_param::<String>("GOOSE_KNOWLEDGE_LOCAL_DIRNAME").ok();

    // Nur die aktuell agent-sichtbaren Nachrichten sind der "herausfallende" Verlauf; bereits
    // früher archivierte (agent-invisible) Nachrichten NICHT erneut mitschreiben.
    let details: Vec<Message> = messages_to_compact
        .iter()
        .filter(|m| m.is_agent_visible())
        .cloned()
        .collect();
    let detail_markdown = export_session_to_markdown(details, &session.name);

    let inputs = SpoolInputs {
        session_id: session_id.to_string(),
        working_dir: session.working_dir.to_string_lossy().to_string(),
        title: session.name.clone(),
        model: Some(model_name.to_string()),
        scope,
        global_dir,
        local_dirname,
        summary_text: summary_text.to_string(),
        detail_markdown,
        compaction_iso: chrono::Utc::now().to_rfc3339(),
    };

    match write_payload(&dir, &build_payload(&inputs)) {
        Ok(p) => info!("knowledge spool geschrieben: {}", p.display()),
        Err(e) => warn!("knowledge spool Schreibfehler: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> SpoolInputs {
        SpoolInputs {
            session_id: "ses_1".into(),
            working_dir: "D:/P".into(),
            title: "Kesb Ronny".into(),
            model: Some("gericom/auto:code".into()),
            scope: "local".into(),
            global_dir: None,
            local_dirname: None,
            summary_text: "## Ziel".into(),
            detail_markdown: "# Session".into(),
            compaction_iso: "2026-09-19T20:51:03+00:00".into(),
        }
    }

    #[test]
    fn build_payload_has_ts_writer_field_names() {
        let v = build_payload(&sample());
        assert_eq!(v["scope"], "local");
        assert_eq!(v["workingDir"], "D:/P");
        assert_eq!(v["sessionId"], "ses_1");
        assert_eq!(v["title"], "Kesb Ronny");
        assert_eq!(v["model"], "gericom/auto:code");
        assert_eq!(v["summaryText"], "## Ziel");
        assert_eq!(v["detailMarkdown"], "# Session");
        assert_eq!(v["compactionIso"], "2026-09-19T20:51:03+00:00");
        assert!(v["globalDir"].is_null());
    }

    #[test]
    fn write_payload_writes_atomically_and_parses_back() {
        let dir = std::env::temp_dir().join(format!("kspool-test-{}", uuid::Uuid::now_v7()));
        let target = write_payload(&dir, &build_payload(&sample())).expect("write");
        assert!(target.exists());
        let back: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&target).unwrap()).unwrap();
        assert_eq!(back["sessionId"], "ses_1");
        // Keine Temp-Reste.
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }
}
