/**
 * Browser side of the resume upload (see lib/candidate/resume.ts for the API):
 * ask for a presigned URL, PUT the file straight to S3, then confirm.
 * `fetch` is injected so the flow can be unit-tested without a network.
 */

type Fetch = typeof fetch;

export interface SavedResume {
  id: string;
  fileName: string;
  size: number;
}

export class ResumeUploadError extends Error {}

// Not imported from resume.ts: that module is server-side (node:crypto).
const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Browsers often report an empty type for .docx, so derive it from the extension the page already checked. */
export function resumeContentType(file: { name: string }): string {
  return /\.pdf$/i.test(file.name) ? "application/pdf" : DOCX_TYPE;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

async function readMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === "string" ? body.message : fallback;
  } catch {
    return fallback;
  }
}

/** The candidate's latest uploaded resume, or null when there is none. */
export async function fetchSavedResume(
  fetchImpl: Fetch = fetch,
): Promise<SavedResume | null> {
  try {
    const res = await fetchImpl("/api/candidate/resume", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { resume?: SavedResume };
    return body.resume ?? null;
  } catch {
    // Not having a saved resume is not an error for the page.
    return null;
  }
}

/** Uploads `file` and returns the stored resume. Throws ResumeUploadError with a message fit to show. */
export async function uploadResume(
  file: File,
  fetchImpl: Fetch = fetch,
): Promise<SavedResume> {
  const created = await fetchImpl("/api/candidate/resume/upload-url", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      fileName: file.name,
      contentType: resumeContentType(file),
      size: file.size,
    }),
  });
  if (!created.ok) {
    throw new ResumeUploadError(
      await readMessage(
        created,
        "Could not start the upload. Please try again.",
      ),
    );
  }
  const { resumeId, upload } = (await created.json()) as {
    resumeId: string;
    upload: { url: string; method: string; headers: Record<string, string> };
  };

  let put: Response;
  try {
    put = await fetchImpl(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: file,
    });
  } catch {
    throw new ResumeUploadError(
      "The upload did not go through. Check your connection and try again.",
    );
  }
  if (!put.ok)
    throw new ResumeUploadError(
      "The upload did not go through. Please try again.",
    );

  const confirmed = await fetchImpl("/api/candidate/resume/confirm", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ resumeId }),
  });
  if (!confirmed.ok) {
    throw new ResumeUploadError(
      await readMessage(
        confirmed,
        "Could not save the resume. Please try again.",
      ),
    );
  }
  const body = (await confirmed.json()) as { resume: SavedResume };
  return body.resume;
}
