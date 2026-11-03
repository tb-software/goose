// TB-Software: Phase B - Echte Rollen-Agenten/Orchestrierung.
// Orchestriert getrennte Rollen-Agenten mit mehreren Durchläufen.

use std::sync::Arc;

use crate::agents::agent::Agent;
use crate::agents::types::SessionConfig;
use crate::providers::base::Provider;

/// Rolle für die Orchestrierung.
pub struct Role {
    pub id: String,
    pub name: String,
    pub prompt: String,
}

/// Ergebnis eines Rollen-Agenten.
pub struct RoleResult {
    pub role_id: String,
    pub output: String,
    pub success: bool,
}

/// Orchestrierungs-Konfiguration.
pub struct OrchestrationConfig {
    pub max_rounds: u32,
    pub roles: Vec<Role>,
}

/// Orchestrierer für Rollen-Agenten.
pub struct RoleOrchestrator {
    config: OrchestrationConfig,
}

impl RoleOrchestrator {
    pub fn new(config: OrchestrationConfig) -> Self {
        Self { config }
    }

    /// Führt die Orchestrierung durch.
    pub async fn orchestrate(
        &self,
        provider: Arc<dyn Provider>,
        session_config: SessionConfig,
        initial_prompt: &str,
    ) -> Result<String, anyhow::Error> {
        let mut current_prompt = initial_prompt.to_string();
        let mut results: Vec<RoleResult> = Vec::new();

        for round in 0..self.config.max_rounds {
            println!("Round {}", round + 1);

            // Jede Rolle führt einen Durchlauf durch
            for role in &self.config.roles {
                println!("  Role: {}", role.name);

                // Erstelle einen Agenten für diese Rolle
                let agent = Agent::new(
                    provider.clone(),
                    session_config.clone(),
                    role.prompt.clone(),
                );

                // Führe den Agenten aus
                let result = agent.run(&current_prompt).await?;

                // Speichere das Ergebnis
                results.push(RoleResult {
                    role_id: role.id.clone(),
                    output: result.clone(),
                    success: true,
                });

                // Aktualisiere den Prompt für die nächste Rolle
                current_prompt = format!(
                    "Previous role ({}) said:\n{}\n\nYour turn:",
                    role.name, result
                );
            }

            // Prüfe Abbruchbedingung
            if self.should_stop(&results) {
                break;
            }
        }

        // Gib das letzte Ergebnis zurück
        Ok(current_prompt)
    }

    /// Prüft, ob die Orchestrierung stoppen soll.
    fn should_stop(&self, results: &[RoleResult]) -> bool {
        // Einfache Abbruchbedingung: Alle Rollen haben erfolgreich gearbeitet
        results.iter().all(|r| r.success)
    }
}