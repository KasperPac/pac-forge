import mammoth from "mammoth";

/**
 * Extract plain text from a .docx file.
 * Tables and lists are preserved as text; formatting is stripped.
 */
export async function extractTextFromDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}
