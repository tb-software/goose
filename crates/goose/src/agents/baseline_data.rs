// TB-Software: Preset 6b - Baseline-Daten-Sammlung.
// Sammelt Baseline-Daten für die Qualität und Token-Ersparnis.

use crate::agents::notation_metrics::{measure_token_savings, measure_semantics_preservation};

/// Baseline-Daten.
pub struct BaselineData {
    pub original_text: String,
    pub token_savings: f64,
    pub semantics_preserved: bool,
}

/// Sammelt Baseline-Daten.
pub fn collect_baseline_data(texts: &[&str]) -> Vec<BaselineData> {
    let mut data = Vec::new();
    for text in texts {
        let token_savings = measure_token_savings(text);
        let semantics_preserved = measure_semantics_preservation(text);
        data.push(BaselineData {
            original_text: text.to_string(),
            token_savings,
            semantics_preserved,
        });
    }
    data
}

/// Berechnet den durchschnittlichen Token-Ersparnis.
pub fn average_token_savings(data: &[BaselineData]) -> f64 {
    if data.is_empty() {
        return 0.0;
    }
    let total: f64 = data.iter().map(|d| d.token_savings).sum();
    total / data.len() as f64
}

/// Berechnet die durchschnittliche Semantik-Erhaltung.
pub fn average_semantics_preservation(data: &[BaselineData]) -> f64 {
    if data.is_empty() {
        return 0.0;
    }
    let total: f64 = data.iter().map(|d| if d.semantics_preserved { 1.0 } else { 0.0 }).sum();
    total / data.len() as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_collect_baseline_data() {
        let texts = ["The quick brown fox jumps over the lazy dog."];
        let data = collect_baseline_data(&texts);
        assert_eq!(data.len(), 1);
        assert!(data[0].token_savings > 0.0);
        assert!(data[0].semantics_preserved);
    }

    #[test]
    fn test_average_token_savings() {
        let data = vec![
            BaselineData {
                original_text: "test".to_string(),
                token_savings: 0.1,
                semantics_preserved: true,
            },
            BaselineData {
                original_text: "test".to_string(),
                token_savings: 0.2,
                semantics_preserved: true,
            },
        ];
        let avg = average_token_savings(&data);
        assert_eq!(avg, 0.15);
    }

    #[test]
    fn test_average_semantics_preservation() {
        let data = vec![
            BaselineData {
                original_text: "test".to_string(),
                token_savings: 0.1,
                semantics_preserved: true,
            },
            BaselineData {
                original_text: "test".to_string(),
                token_savings: 0.2,
                semantics_preserved: false,
            },
        ];
        let avg = average_semantics_preservation(&data);
        assert_eq!(avg, 0.5);
    }
}