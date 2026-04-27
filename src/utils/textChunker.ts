/**
 * Smart text chunking for knowledge-base indexing.
 *
 * Strategy:
 * 1. Split on paragraph boundaries (\n\n)
 * 2. If a paragraph exceeds maxLen, split on sentence boundaries
 * 3. Overlap the last `overlap` chars of the previous chunk to preserve context
 *
 * Target: ~300-500 English tokens ≈ 1200-2000 characters for Chinese/English mix
 * We use character count as a rough proxy since exact tokenisation requires
 * loading the model tokenizer.
 */

export interface TextChunk {
  content: string;
  pageNumber?: number;
  chunkIndex: number;
}

const DEFAULT_MAX_CHARS = 1500;
const DEFAULT_OVERLAP = 80;

function splitIntoSentences(text: string): string[] {
  // Simple sentence splitter — handles common CJK and Latin punctuation
  return text
    .replace(/([。！？.?!])\s*/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/**
 * Chunk a single block of text (e.g. one page or one document).
 */
export function chunkText(
  text: string,
  pageNumber?: number,
  maxChars: number = DEFAULT_MAX_CHARS,
  overlap: number = DEFAULT_OVERLAP
): TextChunk[] {
  const paragraphs = splitIntoParagraphs(text);
  const chunks: TextChunk[] = [];
  let currentChunk = '';
  let chunkIndex = 0;

  const flushChunk = () => {
    if (currentChunk.trim().length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        pageNumber,
        chunkIndex: chunkIndex++
      });
    }
  };

  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      // Paragraph fits — try to append
      if (currentChunk.length + para.length + 1 <= maxChars) {
        currentChunk = currentChunk ? `${currentChunk}\n\n${para}` : para;
      } else {
        flushChunk();
        currentChunk = para;
      }
    } else {
      // Paragraph too long — split into sentences
      flushChunk();
      const sentences = splitIntoSentences(para);
      for (const sent of sentences) {
        if (currentChunk.length + sent.length + 1 <= maxChars) {
          currentChunk = currentChunk ? `${currentChunk} ${sent}` : sent;
        } else {
          flushChunk();
          currentChunk = sent;
        }
      }
    }
  }

  flushChunk();

  // Apply overlap: prepend last `overlap` chars of previous chunk
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1].content;
    const overlapText = prev.slice(-overlap);
    chunks[i].content = overlapText + chunks[i].content;
  }

  return chunks;
}

/**
 * Chunk an array of {text, pageNumber} objects (e.g. pages from a PDF).
 */
export function chunkPages(
  pages: { text: string; pageNumber: number }[],
  maxChars?: number,
  overlap?: number
): TextChunk[] {
  const allChunks: TextChunk[] = [];
  for (const page of pages) {
    const pageChunks = chunkText(page.text, page.pageNumber, maxChars, overlap);
    allChunks.push(...pageChunks);
  }
  return allChunks;
}
