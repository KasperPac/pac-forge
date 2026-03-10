import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

/**
 * Extract plain text from a .docx file.
 * Tables and lists are preserved as text; formatting is stripped.
 */
export async function extractTextFromDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

/**
 * Extract plain text from a .pdf file using PDF.js.
 * Preserves line breaks by detecting Y-position changes between text items.
 * Filters out table of contents pages.
 */
export async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // Build lines by grouping text items with similar Y positions
    const items = textContent.items.filter(
      (item) => "str" in item && "transform" in item,
    );
    if (items.length === 0) {
      pages.push("");
      continue;
    }

    const lines: string[] = [];
    let currentLine = "";
    let lastY: number | null = null;

    for (const item of items) {
      const str = (item as { str: string }).str;
      const transform = (item as { transform: number[] }).transform;
      const itemHeight = (item as { height?: number }).height;
      const y = transform[5]; // Y position from transform matrix
      const lineHeight = itemHeight || 12;

      if (lastY !== null && Math.abs(y - lastY) > lineHeight * 0.5) {
        // Y position changed significantly — new line
        if (currentLine.trim()) lines.push(currentLine.trimEnd());
        currentLine = str;
      } else {
        // Same line — append with space if needed
        if (currentLine && !currentLine.endsWith(" ") && !str.startsWith(" ")) {
          currentLine += " ";
        }
        currentLine += str;
      }
      lastY = y;
    }
    if (currentLine.trim()) lines.push(currentLine.trimEnd());

    const pageText = lines.join("\n");

    // Release pdfjs page resources (fonts, images, canvas data) to avoid OOM on large docs
    page.cleanup();

    // Skip table of contents pages
    if (isTocPage(pageText)) continue;

    pages.push(pageText);
  }

  const text = pages.join("\n\n");
  await pdf.destroy();
  return text;
}

/** Detect if a page is likely a table of contents */
function isTocPage(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 3) return false;

  // Check first few lines for "table of contents" / "contents" heading
  const headerLines = lines.slice(0, 3).join(" ").toLowerCase();
  const hasTocHeading =
    headerLines.includes("table of contents") ||
    headerLines.includes("inhaltsverzeichnis") ||
    (headerLines.includes("contents") && !headerLines.includes("section"));

  if (!hasTocHeading) return false;

  // Confirm: majority of lines end with page numbers or have dot leaders
  let dotLeaderCount = 0;
  for (const line of lines) {
    if (/\.{3,}\s*\d+\s*$/.test(line) || /\s{3,}\d+\s*$/.test(line)) {
      dotLeaderCount++;
    }
  }
  return dotLeaderCount > lines.length * 0.3;
}

/**
 * Render a single PDF page to a PNG data URI for vision processing.
 * Scale controls the resolution (1.5 = 150% of natural size, good for readability).
 */
export async function renderPdfPageToImage(
  file: File,
  pageNum: number,
  scale = 1.5,
): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;

  await page.render({ canvasContext: ctx, viewport, canvas } as Parameters<typeof page.render>[0]).promise;
  return canvas.toDataURL("image/png");
}

/** Get the total number of pages in a PDF */
export async function getPdfPageCount(file: File): Promise<number> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return pdf.numPages;
}
