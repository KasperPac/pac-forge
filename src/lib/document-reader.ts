import { extractTextFromDocx } from "@/lib/document-extractor";

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".scl", ".csv", ".json"]);

/**
 * Reads a file and returns its text content.
 * - .docx files are extracted via mammoth
 * - .md, .txt, .scl, and other text files use the File API
 */
export async function readFileAsText(file: File): Promise<string> {
  const ext = getExtension(file.name);

  if (ext === ".docx") {
    return extractTextFromDocx(file);
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    return file.text();
  }

  // Fallback: try reading as text
  return file.text();
}

export function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

export function getFileType(filename: string): string {
  const ext = getExtension(filename);
  return ext ? ext.slice(1) : "txt";
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
