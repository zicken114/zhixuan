use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/* ───────────────────────────────────────────────
   Data structures
   ─────────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArxivPaper {
    pub title: String,
    pub authors: Vec<String>,
    pub summary: String,
    pub id: String,
    pub pdf_url: String,
    pub published: String,
    pub doi: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticPaper {
    pub paper_id: String,
    pub title: String,
    pub authors: Vec<SemanticAuthor>,
    #[serde(rename = "abstract")]
    pub paper_abstract: Option<String>,
    pub url: Option<String>,
    pub open_access_pdf: Option<OpenAccessPdf>,
    pub publication_date: Option<String>,
    pub doi: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticAuthor {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAccessPdf {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiedPaper {
    pub title: String,
    pub authors: String,
    pub paper_abstract: String,
    pub url: String,
    pub pdf_url: Option<String>,
    pub doi: Option<String>,
    pub published_date: Option<String>,
    pub source: String,
}

/* ───────────────────────────────────────────────
   arXiv API
   ─────────────────────────────────────────────── */

pub async fn search_arxiv(keywords: &[String], days: u32) -> Result<Vec<ArxivPaper>, String> {
    let query = keywords.join(" AND ");
    let url = format!(
        "http://export.arxiv.org/api/query?search_query=all:{}&start=0&max_results=20&sortBy=submittedDate&sortOrder=descending",
        urlencoding::encode(&query)
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("arXiv request failed: {}", e))?;

    let body = response
        .text()
        .await
        .map_err(|e| format!("arXiv response read failed: {}", e))?;

    // Parse Atom XML with a lightweight regex-based approach
    let papers = parse_arxiv_atom(&body, days);
    Ok(papers)
}

fn parse_arxiv_atom(xml: &str, days: u32) -> Vec<ArxivPaper> {
    let mut papers = Vec::new();
    let now = chrono::Utc::now();
    let cutoff = now - chrono::Duration::days(days as i64);

    // Split by <entry> tags
    for entry in xml.split("<entry>").skip(1) {
        let title = extract_xml_tag(entry, "title").unwrap_or_default().trim().to_string();
        let summary = extract_xml_tag(entry, "summary").unwrap_or_default().trim().to_string();
        let id = extract_xml_tag(entry, "id").unwrap_or_default().trim().to_string();
        let published = extract_xml_tag(entry, "published").unwrap_or_default().trim().to_string();

        // Extract authors
        let mut authors = Vec::new();
        for author_block in entry.split("<author>").skip(1) {
            if let Some(name) = extract_xml_tag(author_block, "name") {
                authors.push(name.trim().to_string());
            }
        }

        // Extract PDF link (type="application/pdf")
        let pdf_url = extract_attr(entry, "link", "href", "type", "application/pdf")
            .unwrap_or_else(|| id.replace("abs", "pdf") + ".pdf");

        // Extract DOI if present
        let doi = extract_xml_tag(entry, "arxiv:doi")
            .or_else(|| extract_doi_from_text(&summary))
            .map(|s| s.trim().to_string());

        // Filter by date
        if let Ok(date) = chrono::DateTime::parse_from_rfc3339(&published) {
            if date.with_timezone(&chrono::Utc) < cutoff {
                continue;
            }
        }

        if !title.is_empty() {
            papers.push(ArxivPaper {
                title,
                authors,
                summary,
                id,
                pdf_url,
                published,
                doi,
            });
        }
    }

    papers
}

fn extract_xml_tag(xml: &str, tag: &str) -> Option<String> {
    let start = format!("<{}>", tag);
    let end = format!("</{}>", tag);
    let start_idx = xml.find(&start)?;
    let content_start = start_idx + start.len();
    let end_idx = xml[content_start..].find(&end)?;
    Some(xml[content_start..content_start + end_idx].to_string())
}

fn extract_attr(xml: &str, tag: &str, attr: &str, filter_attr: &str, filter_val: &str) -> Option<String> {
    for block in xml.split(&format!("<{} ", tag)) {
        if let Some(end) = block.find(">") {
            let attrs = &block[..end];
            if attrs.contains(&format!("{}=\"{}\"", filter_attr, filter_val))
                || attrs.contains(&format!("{}='{}'", filter_attr, filter_val))
            {
                let attr_prefix = format!("{}=\"", attr);
                if let Some(start) = attrs.find(&attr_prefix) {
                    let val_start = start + attr_prefix.len();
                    if let Some(val_end) = attrs[val_start..].find("\"") {
                        return Some(attrs[val_start..val_start + val_end].to_string());
                    }
                }
            }
        }
    }
    None
}

fn extract_doi_from_text(text: &str) -> Option<String> {
    // Simple regex-like extraction for DOI patterns
    if let Some(idx) = text.to_lowercase().find("doi:") {
        let start = idx + 4;
        let rest = &text[start..];
        let end = rest.find(|c: char| c.is_whitespace() || c == ',' || c == ';' || c == ')').unwrap_or(rest.len());
        let doi = rest[..end].trim().to_string();
        if !doi.is_empty() {
            return Some(doi);
        }
    }
    None
}

/* ───────────────────────────────────────────────
   Semantic Scholar API
   ─────────────────────────────────────────────── */

#[derive(Debug, Deserialize)]
struct SemanticSearchResponse {
    data: Vec<SemanticPaper>,
}

pub async fn search_semantic_scholar(
    keywords: &[String],
    limit: u32,
) -> Result<Vec<SemanticPaper>, String> {
    let query = keywords.join(" ");
    let url = format!(
        "https://api.semanticscholar.org/graph/v1/paper/search?query={}&fields=paperId,title,authors,abstract,url,openAccessPdf,publicationDate,doi&limit={}",
        urlencoding::encode(&query),
        limit
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Semantic Scholar request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Semantic Scholar API error {}: {}", status, body));
    }

    let parsed: SemanticSearchResponse = response
        .json()
        .await
        .map_err(|e| format!("Semantic Scholar JSON parse failed: {}", e))?;

    Ok(parsed.data)
}

/* ───────────────────────────────────────────────
   Paper deduplication & unification
   ─────────────────────────────────────────────── */

pub fn deduplicate_papers(papers: Vec<UnifiedPaper>) -> Vec<UnifiedPaper> {
    let mut seen = HashSet::new();
    papers
        .into_iter()
        .filter(|p| {
            let key = p.doi.clone().unwrap_or_else(|| p.title.clone());
            let key_lower = key.to_lowercase();
            if seen.contains(&key_lower) {
                false
            } else {
                seen.insert(key_lower);
                true
            }
        })
        .collect()
}

pub fn unify_arxiv_papers(arxiv: Vec<ArxivPaper>) -> Vec<UnifiedPaper> {
    arxiv
        .into_iter()
        .map(|p| UnifiedPaper {
            title: p.title,
            authors: p.authors.join(", "),
            paper_abstract: p.summary,
            url: p.id,
            pdf_url: Some(p.pdf_url),
            doi: p.doi,
            published_date: Some(p.published),
            source: "arxiv".to_string(),
        })
        .collect()
}

pub fn unify_semantic_papers(semantic: Vec<SemanticPaper>) -> Vec<UnifiedPaper> {
    semantic
        .into_iter()
        .map(|p| UnifiedPaper {
            title: p.title,
            authors: p.authors.into_iter().map(|a| a.name).collect::<Vec<_>>().join(", "),
            paper_abstract: p.paper_abstract.unwrap_or_default(),
            url: p.url.unwrap_or_else(|| format!("https://www.semanticscholar.org/paper/{}", p.paper_id)),
            pdf_url: p.open_access_pdf.map(|pdf| pdf.url),
            doi: p.doi,
            published_date: p.publication_date,
            source: "semantic_scholar".to_string(),
        })
        .collect()
}

/* ───────────────────────────────────────────────
   Direction inference (stub for now)
   ─────────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResearchTopic {
    pub name: String,
    pub keywords: Vec<String>,
}

/// Infer research directions from recent chat messages and knowledge base keywords.
/// This is a placeholder that returns demo topics. Full implementation will call AI.
pub async fn infer_research_directions(
    _project_id: Option<String>,
) -> Result<Vec<ResearchTopic>, String> {
    // TODO: Implement full inference by reading messages + knowledge_docs
    // For now, return empty so the UI can prompt user to create topics manually
    Ok(Vec::new())
}

/* ───────────────────────────────────────────────
   Tauri Commands
   ─────────────────────────────────────────────── */

#[tauri::command]
pub async fn search_arxiv_command(keywords: Vec<String>, days: u32) -> Result<Vec<ArxivPaper>, String> {
    search_arxiv(&keywords, days).await
}

#[tauri::command]
pub async fn search_semantic_scholar_command(
    keywords: Vec<String>,
    limit: u32,
) -> Result<Vec<SemanticPaper>, String> {
    search_semantic_scholar(&keywords, limit).await
}

#[tauri::command]
pub async fn infer_research_directions_command(
    project_id: Option<String>,
) -> Result<Vec<ResearchTopic>, String> {
    infer_research_directions(project_id).await
}
