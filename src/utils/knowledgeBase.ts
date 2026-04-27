/**
 * Knowledge Base core logic.
 *
 * Responsibilities:
 * - Scan folders for PDF files (via Tauri fs API)
 * - Extract text, chunk, embed, and persist to SQLite
 * - Semantic search: embed query, cosine-similarity against stored vectors
 */

import { open } from '@tauri-apps/plugin-dialog';
import { readDir, readFile, readTextFile } from '@tauri-apps/plugin-fs';
import {
  loadKnowledgeDocs,
  saveKnowledgeDoc,
  updateKnowledgeDocStatus,
  deleteKnowledgeDoc,
  loadProjectChunks,
  saveDocChunk,
  deleteDocChunks,
  type KnowledgeDoc,
  type DocChunk
} from '../composables/useDatabase';
import { extractPdfText } from './pdfExtractor';
import { chunkPages, chunkText, type TextChunk } from './textChunker';
import { embed, embedBatch } from './embedder';

export interface SearchResult {
  chunk: DocChunk;
  score: number;
  docId: string;
  docName: string;
}

/**
 * Open a folder picker dialog and return the selected path.
 */
export async function pickFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false
  });
  if (Array.isArray(selected)) return selected[0] || null;
  return selected;
}

/**
 * Recursively scan a folder for supported document files (PDF, Markdown, TXT).
 * Returns an array of file paths.
 */
export async function scanFolderForDocs(folderPath: string): Promise<string[]> {
  const docs: string[] = [];
  const supportedExts = ['.pdf', '.md', '.markdown', '.txt'];

  async function scanDir(dirPath: string) {
    try {
      const entries = await readDir(dirPath);
      for (const entry of entries) {
        const entryPath = `${dirPath}/${entry.name}`;
        if (entry.isDirectory) {
          await scanDir(entryPath);
        } else {
          const ext = entry.name.toLowerCase().slice(entry.name.lastIndexOf('.'));
          if (supportedExts.includes(ext)) {
            docs.push(entryPath);
          }
        }
      }
    } catch (e) {
      console.warn('[KB] Failed to scan directory:', dirPath, e);
    }
  }

  await scanDir(folderPath);
  return docs;
}

/**
 * Add a document record to the knowledge base (without indexing).
 */
export async function addDocument(
  filePath: string,
  fileName: string,
  projectId?: string | null
): Promise<KnowledgeDoc> {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  const fileType = ext === '.markdown' ? 'md' : ext.slice(1);
  const now = Date.now();
  const doc: KnowledgeDoc = {
    id: `doc_${now}_${Math.random().toString(36).slice(2, 8)}`,
    projectId: projectId || null,
    filePath,
    fileName,
    fileType,
    indexStatus: 'pending',
    createdAt: now,
    updatedAt: now
  };
  await saveKnowledgeDoc(doc);
  return doc;
}

/**
 * Index a document: extract text, chunk, embed, save chunks.
 * Updates the document's index_status along the way.
 */
export async function indexDocument(doc: KnowledgeDoc): Promise<void> {
  await updateKnowledgeDocStatus(doc.id, 'indexing');

  try {
    let chunks: TextChunk[] = [];

    if (doc.fileType === 'pdf') {
      // Read file as bytes
      const fileData = await readFile(doc.filePath);
      const uint8Array = new Uint8Array(fileData);

      // Extract text from PDF
      const extractResult = await extractPdfText(uint8Array, doc.fileName);

      // Update doc with page count
      doc.totalPages = extractResult.totalPages;
      doc.updatedAt = Date.now();
      await saveKnowledgeDoc(doc);

      // Chunk the pages
      const pages = extractResult.pages
        .filter((p) => p.text.trim().length > 0)
        .map((p) => ({ text: p.text, pageNumber: p.pageNumber }));

      if (pages.length === 0) {
        await updateKnowledgeDocStatus(doc.id, 'completed');
        return;
      }

      chunks = chunkPages(pages);
    } else {
      // Markdown or plain text
      const text = await readTextFile(doc.filePath);
      doc.updatedAt = Date.now();
      await saveKnowledgeDoc(doc);

      if (text.trim().length === 0) {
        await updateKnowledgeDocStatus(doc.id, 'completed');
        return;
      }

      chunks = chunkText(text);
    }

    // Delete old chunks if re-indexing
    await deleteDocChunks(doc.id);

    // Embed chunks in batches of 8 (balance speed vs. memory)
    const BATCH_SIZE = 8;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => c.content);
      const embeddings = await embedBatch(texts);

      for (let j = 0; j < batch.length; j++) {
        await saveDocChunk({
          docId: doc.id,
          content: batch[j].content,
          pageNumber: batch[j].pageNumber,
          chunkIndex: batch[j].chunkIndex,
          embedding: embeddings[j],
          createdAt: Date.now()
        });
      }
    }

    await updateKnowledgeDocStatus(doc.id, 'completed');
    console.log(`[KB] Indexed ${doc.fileName}: ${chunks.length} chunks`);
  } catch (error: any) {
    console.error('[KB] Failed to index document:', doc.filePath, error);
    await updateKnowledgeDocStatus(doc.id, 'error', error?.message || 'Unknown error');
  }
}

/**
 * Remove a document and all its chunks from the knowledge base.
 */
export async function removeDocument(docId: string): Promise<void> {
  await deleteKnowledgeDoc(docId);
}

/**
 * Compute cosine similarity between two normalized vectors.
 * Since embeddings are L2-normalised by the model, this is just a dot product.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Search the knowledge base for chunks semantically similar to the query.
 * Returns top-K results sorted by relevance score.
 */
export async function searchKnowledgeBase(
  query: string,
  projectId: string | null,
  topK: number = 5
): Promise<SearchResult[]> {
  const queryEmbedding = await embed(query);
  const chunks = await loadProjectChunks(projectId);

  // Build doc name lookup
  const docs = await loadKnowledgeDocs(projectId);
  const docNameMap = new Map(docs.map((d) => [d.id, d.fileName]));

  const scored: SearchResult[] = [];
  for (const chunk of chunks) {
    if (!chunk.embedding) continue;
    const score = cosineSimilarity(queryEmbedding, chunk.embedding);
    scored.push({ chunk, score, docId: chunk.docId, docName: docNameMap.get(chunk.docId) || 'Unknown' });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Load all documents for a project.
 */
export async function getProjectDocuments(projectId?: string | null): Promise<KnowledgeDoc[]> {
  return loadKnowledgeDocs(projectId);
}

/**
 * Scan a folder, add all supported documents as pending, then index them.
 * Returns the list of added documents.
 */
export async function addFolderToKnowledgeBase(
  folderPath: string,
  projectId?: string | null,
  onProgress?: (indexed: number, total: number) => void
): Promise<KnowledgeDoc[]> {
  const docPaths = await scanFolderForDocs(folderPath);
  const docs: KnowledgeDoc[] = [];

  for (const path of docPaths) {
    const fileName = path.split('/').pop() || path.split('\\').pop() || 'unknown.pdf';
    const doc = await addDocument(path, fileName, projectId);
    docs.push(doc);
  }

  // Index documents one by one
  for (let i = 0; i < docs.length; i++) {
    await indexDocument(docs[i]);
    onProgress?.(i + 1, docs.length);
  }

  return docs;
}
