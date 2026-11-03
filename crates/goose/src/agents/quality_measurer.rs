// TB-Software: Phase B - Messung/Baseline für die Qualität.
// Misst die Qualität der Ausgabe und vergleicht sie mit einer Baseline.

use std::collections::HashMap;

/// Qualitäts-Metrik.
pub struct QualityMetric {
    pub name: String,
    pub value: f64,
}

/// Qualitäts-Ergebnis.
pub struct QualityResult {
    pub metrics: Vec<QualityMetric>,
    pub score: f64,
}

/// Baseline für die Qualität.
pub struct QualityBaseline {
    pub metrics: HashMap<String, f64>,
}

/// Qualitäts-Messer.
pub struct QualityMeasurer {
    baseline: QualityBaseline,
}

impl QualityMeasurer {
    pub fn new(baseline: QualityBaseline) -> Self {
        Self { baseline }
    }

    /// Misst die Qualität der Ausgabe.
    pub fn measure(&self, output: &str) -> QualityResult {
        let mut metrics = Vec::new();
        let mut score = 0.0;

        // Beispiel-Metrik: Token-Anzahl
        let token_count = output.split_whitespace().count() as f64;
        metrics.push(QualityMetric {
            name: "token_count".to_string(),
            value: token_count,
        });

        // Beispiel-Metrik: Satz-Anzahl
        let sentence_count = output.split('.').count() as f64;
        metrics.push(QualityMetric {
            name: "sentence_count".to_string(),
            value: sentence_count,
        });

        // Berechne den Score
        for metric in &metrics {
            if let Some(baseline_value) = self.baseline.metrics.get(&metric.name) {
                let ratio = metric.value / *baseline_value;
                score += ratio;
            }
        }

        QualityResult {
            metrics,
            score,
        }
    }
}