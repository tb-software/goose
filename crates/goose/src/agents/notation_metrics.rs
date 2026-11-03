// TB-Software: Preset 6b - Messung der Token-Ersparnis.
// Misst die Token-Ersparnis durch die eigene Notation.

use crate::agents::llm_notation::{encode, decode};

/// Misst die Token-Ersparnis.
pub fn measure_token_savings(original: &str) -> f64 {
    let encoded = encode(original);
    let original_tokens = original.split_whitespace().count();
    let encoded_tokens = encoded.split_whitespace().count();
    let savings = (original_tokens - encoded_tokens) as f64 / original_tokens as f64;
    savings
}

/// Misst die Semantik-Erhaltung.
pub fn measure_semantics_preservation(original: &str) -> bool {
    let encoded = encode(original);
    let decoded = decode(&encoded);
    decoded == original
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_savings() {
        let original = "The quick brown fox jumps over the lazy dog.";
        let savings = measure_token_savings(original);
        assert!(savings > 0.0);
    }

    #[test]
    fn test_semantics_preservation() {
        let original = "The quick brown fox jumps over the lazy dog.";
        let preserved = measure_semantics_preservation(original);
        assert!(preserved);
    }
}