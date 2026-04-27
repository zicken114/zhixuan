/**
 * PDF text extraction using pdfjs-dist.
 * Runs in the browser/WebView — no external dependencies.
 */

import * as pdfjs from 'pdfjs-dist';

// Configure worker for Vite/bundler environments
// pdfjs-dist v5 uses a different worker setup; we use the bundled worker
const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfPage {
  pageNumber: number;
  text: string;
}

export interface PdfExtractResult {
  fileName: string;
  totalPages: number;
  pages: PdfPage[];
  fullText: string;
}

/**
 * Extract text from a PDF file (provided as Uint8Array).
 * Returns page-by-page text and total page count.
 */
export async function extractPdfText(
  data: Uint8Array,
  fileName: string
): Promise<PdfExtractResult> {
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const pages: PdfPage[] = [];

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => {
        if ('str' in item) return item.str;
        return '';
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    pages.push({ pageNumber: i, text });
  }

  const fullText = pages.map((p) => p.text).join('\n\n');

  return {
    fileName,
    totalPages,
    pages,
    fullText
  };
}
