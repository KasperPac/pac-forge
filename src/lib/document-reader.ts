import { extractTextFromDocx, extractTextFromPdf } from "@/lib/document-extractor";
import { supabase } from "@/lib/supabase";

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".scl", ".csv", ".json"]);

/**
 * Extract text from a PDF via the server-side Edge Function.
 * Falls back to client-side extraction if the Edge Function call fails.
 */
export async function extractPdfServerSide(file: File): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();

  const formData = new FormData();
  formData.append("file", file);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

  const resp = await fetch(`${supabaseUrl}/functions/v1/extract-pdf`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session?.access_token ?? supabaseAnonKey}`,
      apikey: supabaseAnonKey,
    },
    body: formData,
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `PDF extraction failed (${resp.status})`,
    );
  }

  const { text } = await resp.json() as { text: string };
  return text;
}

/**
 * Reads a file and returns its text content.
 * - .pdf files are extracted via PDF.js
 * - .docx files are extracted via mammoth
 * - .md, .txt, .scl, and other text files use the File API
 */
export async function readFileAsText(file: File): Promise<string> {
  const ext = getExtension(file.name);

  if (ext === ".pdf") {
    return extractTextFromPdf(file);
  }

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
