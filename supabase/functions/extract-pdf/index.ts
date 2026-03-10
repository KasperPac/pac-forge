// Supabase Edge Function: Server-side PDF text extraction
// Accepts a multipart form upload with a PDF file, extracts text using unpdf,
// and returns the plain text. Fixes client-side OOM on large PDFs.

// @ts-ignore — unpdf is a runtime import; no local type stubs
import { extractText } from "npm:unpdf";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Detect if a page of text looks like a table of contents */
function isTocPage(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 3) return false;
  const headerLines = lines.slice(0, 3).join(" ").toLowerCase();
  const hasTocHeading =
    headerLines.includes("table of contents") ||
    headerLines.includes("inhaltsverzeichnis") ||
    (headerLines.includes("contents") && !headerLines.includes("section"));
  if (!hasTocHeading) return false;
  let dotLeaderCount = 0;
  for (const line of lines) {
    if (/\.{3,}\s*\d+\s*$/.test(line) || /\s{3,}\d+\s*$/.test(line)) {
      dotLeaderCount++;
    }
  }
  return dotLeaderCount > lines.length * 0.3;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return jsonResponse({ error: "No file provided" }, 400);
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return jsonResponse({ error: "Only PDF files are supported" }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();

    // extractText returns { text: string[] } — one string per page
    const { text: pages } = await extractText(
      new Uint8Array(arrayBuffer),
      { mergePages: false },
    );

    // Filter TOC pages and join
    const filteredPages = (pages as string[]).filter(
      (p) => !isTocPage(p),
    );
    const text = filteredPages.join("\n\n");

    return jsonResponse({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    console.error("[extract-pdf] Error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
