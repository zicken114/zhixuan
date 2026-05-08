/* ───────────────────────────────────────────────
   Content Type Detection for PDF Pages
   Heuristic-based detection of formulas, tables,
   and theorems from extracted PDF text.
   ─────────────────────────────────────────────── */

use regex::Regex;
use serde::{Deserialize, Serialize};

/// Types of content that can be detected on a PDF page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentType {
    /// Mathematical formulas (LaTeX-heavy text)
    Formula,
    /// Data tables (aligned columns, pipe separators)
    Table,
    /// Theorems, definitions, lemmas, etc.
    Theorem,
    /// No special content detected
    PlainText,
}

/// Result of content type detection for a single page.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentDetectionResult {
    pub content_types: Vec<ContentType>,
    pub confidence: f64,
    pub details: String,
}

/// Detect content types present in a page of text.
pub fn detect_content_types(page_text: &str) -> ContentDetectionResult {
    let mut detected = Vec::new();
    let mut confidence_scores = Vec::new();
    let mut details = Vec::new();

    // Check for formulas
    let formula_result = detect_formula(page_text);
    if formula_result.0 {
        detected.push(ContentType::Formula);
        confidence_scores.push(formula_result.1);
        details.push(format!("Formula detected (confidence: {:.0}%)", formula_result.1 * 100.0));
    }

    // Check for tables
    let table_result = detect_table(page_text);
    if table_result.0 {
        detected.push(ContentType::Table);
        confidence_scores.push(table_result.1);
        details.push(format!("Table detected (confidence: {:.0}%)", table_result.1 * 100.0));
    }

    // Check for theorems
    let theorem_result = detect_theorem(page_text);
    if theorem_result.0 {
        detected.push(ContentType::Theorem);
        confidence_scores.push(theorem_result.1);
        details.push(format!("Theorem/Definition detected (confidence: {:.0}%)", theorem_result.1 * 100.0));
    }

    if detected.is_empty() {
        detected.push(ContentType::PlainText);
        confidence_scores.push(1.0);
        details.push("Plain text page".to_string());
    }

    let avg_confidence = if confidence_scores.is_empty() {
        0.0
    } else {
        confidence_scores.iter().sum::<f64>() / confidence_scores.len() as f64
    };

    ContentDetectionResult {
        content_types: detected,
        confidence: avg_confidence,
        details: details.join("; "),
    }
}

/// Detect if the page contains mathematical formulas.
/// Returns (found, confidence_score).
fn detect_formula(text: &str) -> (bool, f64) {
    let formula_markers = [
        r"\$\$", r"\$[^\$]+\$", r"\\begin\{equation",
        r"\\begin\{align", r"\\frac\{", r"\\sum_",
        r"\\int_", r"\\prod_", r"\\lim_",
        r"\\alpha", r"\\beta", r"\\gamma", r"\\delta",
        r"\\theta", r"\\lambda", r"\\mu", r"\\sigma",
        r"\\infty", r"\\partial", r"\\nabla",
        r"\\left\(", r"\\right\)", r"\\left\[", r"\\right\]",
        r"\\sqrt\{", r"\\overline\{", r"\\underline\{",
        r"\\hat\{", r"\\tilde\{", r"\\vec\{",
        r"\\cdot", r"\\times", r"\\pm", r"\\mp",
        r"\\leq", r"\\geq", r"\\neq", r"\\approx",
        r"\\in", r"\\subset", r"\\cup", r"\\cap",
        r"\\forall", r"\\exists", r"\\implies",
    ];

    let mut marker_count = 0;
    for pattern in &formula_markers {
        if let Ok(re) = Regex::new(pattern) {
            marker_count += re.find_iter(text).count();
        }
    }

    let text_len = text.len().max(1);
    let density = marker_count as f64 / text_len as f64 * 1000.0; // markers per 1000 chars

    // Threshold: at least 3 markers and density > 1.5 per 1000 chars
    let found = marker_count >= 3 && density > 1.5;
    let confidence = (density / 5.0).min(1.0); // Cap at 1.0

    (found, confidence.max(0.3))
}

/// Detect if the page contains data tables.
/// Returns (found, confidence_score).
fn detect_table(text: &str) -> (bool, f64) {
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() < 3 {
        return (false, 0.0);
    }

    // Heuristic 1: Pipe-separated rows (Markdown-style tables)
    let pipe_rows = lines.iter().filter(|l| l.contains('|')).count();
    let pipe_ratio = pipe_rows as f64 / lines.len() as f64;

    // Heuristic 2: Rows with consistent multi-space column alignment
    let mut aligned_rows = 0;
    for window in lines.windows(2) {
        let spaces_a: Vec<usize> = window[0].match_indices("  ").map(|(i, _)| i).collect();
        let spaces_b: Vec<usize> = window[1].match_indices("  ").map(|(i, _)| i).collect();

        if !spaces_a.is_empty() && !spaces_b.is_empty() {
            let common: Vec<_> = spaces_a.iter().filter(|a| spaces_b.contains(a)).collect();
            if common.len() >= 2 {
                aligned_rows += 1;
            }
        }
    }
    let align_ratio = aligned_rows as f64 / lines.len().max(1) as f64;

    // Heuristic 3: Table header keywords
    let header_re = Regex::new(r"(?i)(table\s+\d+|fig\.?\s*\d+|figure\s*\d+)").unwrap();
    let has_table_header = header_re.is_match(text);

    let found = pipe_ratio > 0.3 || align_ratio > 0.2 || (has_table_header && align_ratio > 0.1);
    let confidence = (pipe_ratio * 0.5 + align_ratio * 0.5).max(0.3).min(1.0);

    (found, confidence)
}

/// Detect if the page contains theorems, definitions, lemmas, etc.
/// Returns (found, confidence_score).
fn detect_theorem(text: &str) -> (bool, f64) {
    let theorem_keywords = [
        r"(?m)^\s*Theorem\s+\d+",
        r"(?m)^\s*Definition\s+\d+",
        r"(?m)^\s*Lemma\s+\d+",
        r"(?m)^\s*Corollary\s+\d+",
        r"(?m)^\s*Proposition\s+\d+",
        r"(?m)^\s*Assumption\s+\d+",
        r"(?m)^\s*Remark\s+\d+",
        r"(?m)^\s*Proof[.:\s]",
        r"(?i)\btheorem\b.*\b(prove|show|state)\b",
        r"(?i)\bdefinition\b.*\b(let|denote|call)\b",
    ];

    let mut match_count = 0;
    for pattern in &theorem_keywords {
        if let Ok(re) = Regex::new(pattern) {
            match_count += re.find_iter(text).count();
        }
    }

    let found = match_count >= 1;
    let confidence = (match_count as f64 / 3.0).min(1.0).max(0.4);

    (found, confidence)
}

/* ───────────────────────────────────────────────
   Tauri commands
   ─────────────────────────────────────────────── */

/// Tauri command: detect content types in a page of text.
#[tauri::command]
pub fn detect_page_content_types(page_text: String) -> ContentDetectionResult {
    detect_content_types(&page_text)
}

/// Tauri command: check if a page contains extractable content (formula/table/theorem).
/// Returns true if any non-plain content is detected.
#[tauri::command]
pub fn has_extractable_content(page_text: String) -> bool {
    let result = detect_content_types(&page_text);
    result.content_types.iter().any(|t| *t != ContentType::PlainText)
}
