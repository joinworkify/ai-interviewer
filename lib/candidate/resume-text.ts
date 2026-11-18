/**
 * Plain text from a candidate's resume file, used only to tailor interview
 * questions. The text is untrusted: it is cleaned and capped here, and the
 * prompt treats it as data (see lib/ai/prompts/candidate-questions.ts).
 */

/** Enough for a typical two-page resume; keeps the prompt small. */
export const MAX_RESUME_TEXT_CHARS = 6_000;

const PDF_TYPE = "application/pdf";

/** Collapses whitespace, removes control characters and caps the length. */
export function cleanResumeText(raw: string): string {
  return raw
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_RESUME_TEXT_CHARS);
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  // The legacy build runs in Node without a browser worker.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes, useSystemFonts: false });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    let length = 0;
    for (let i = 1; i <= doc.numPages && length < MAX_RESUME_TEXT_CHARS; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      pages.push(text);
      length += text.length;
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}

/**
 * Text of a PDF resume, or null when the file type is not supported yet or
 * no text could be read (for example a scanned image).
 * shortcut: .docx resumes return null (role-only questions) until a Word
 * text extractor is approved for the project.
 */
export async function extractResumeText(bytes: Uint8Array, contentType: string): Promise<string | null> {
  if (contentType !== PDF_TYPE) return null;
  const text = cleanResumeText(await pdfText(bytes));
  return text.length > 0 ? text : null;
}
