import { describe, expect, it, vi } from "vitest";
import {
  ResumeUploadError,
  deleteResume,
  fetchSavedResumes,
  resumeContentType,
  selectResume,
  uploadResume,
} from "@/lib/candidate/resume-client";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const RESUME = { id: "r1", fileName: "cv.pdf", size: 4 };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function pdf() {
  return new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
}

describe("resumeContentType", () => {
  it("derives the type from the extension, not the browser's guess", () => {
    expect(resumeContentType({ name: "CV.PDF" })).toBe("application/pdf");
    expect(resumeContentType({ name: "cv.docx" })).toBe(DOCX);
  });
});

describe("uploadResume", () => {
  const createdBody = {
    success: true,
    resumeId: "r1",
    upload: {
      url: "https://s3.test/put",
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
    },
  };

  it("asks for a URL, PUTs the file to it, then confirms", async () => {
    const file = pdf();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(201, createdBody))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(json(200, { success: true, resume: RESUME }));

    await expect(uploadResume(file, fetchImpl as unknown as typeof fetch)).resolves.toEqual(RESUME);

    const [first, second, third] = fetchImpl.mock.calls;
    expect(first[0]).toBe("/api/candidate/resume/upload-url");
    expect(JSON.parse(first[1].body)).toEqual({
      fileName: "cv.pdf",
      contentType: "application/pdf",
      size: file.size,
    });
    expect(second[0]).toBe("https://s3.test/put");
    expect(second[1]).toMatchObject({
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    });
    expect(third[0]).toBe("/api/candidate/resume/confirm");
    expect(JSON.parse(third[1].body)).toEqual({ resumeId: "r1" });
  });

  it("shows the server's message when the upload cannot start, and never touches S3", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(401, { message: "Sign in to upload a resume." }));
    await expect(uploadResume(pdf(), fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      "Sign in to upload a resume.",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not confirm when the PUT to S3 fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(201, createdBody))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(uploadResume(pdf(), fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(
      ResumeUploadError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("turns a network failure on the PUT into a friendly error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(201, createdBody))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(uploadResume(pdf(), fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /connection/,
    );
  });

  it("surfaces a confirm mismatch message", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(201, createdBody))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        json(422, { message: "The uploaded file does not match. Please upload it again." }),
      );
    await expect(uploadResume(pdf(), fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /does not match/,
    );
  });
});

describe("fetchSavedResumes", () => {
  it("returns every saved resume, the one in use first", async () => {
    const other = { id: "r2", fileName: "old.pdf", size: 9 };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json(200, { success: true, resume: RESUME, resumes: [RESUME, other] }));
    await expect(fetchSavedResumes(fetchImpl as unknown as typeof fetch)).resolves.toEqual([
      RESUME,
      other,
    ]);
  });

  it("returns an empty list when there is none, when signed out, or when the request fails", async () => {
    for (const impl of [
      vi.fn().mockResolvedValue(json(404, { message: "No resume uploaded yet." })),
      vi.fn().mockResolvedValue(json(401, {})),
      vi.fn().mockRejectedValue(new Error("offline")),
    ]) {
      await expect(fetchSavedResumes(impl as unknown as typeof fetch)).resolves.toEqual([]);
    }
  });
});

describe("selectResume and deleteResume", () => {
  it("call the resume's own URL with POST and DELETE", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { success: true }));
    await selectResume("r 1", fetchImpl as unknown as typeof fetch);
    await deleteResume("r 1", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/api/candidate/resume/r%201", "POST"],
      ["/api/candidate/resume/r%201", "DELETE"],
    ]);
  });

  it("throw the server's message, or a friendly one when offline", async () => {
    const notFound = vi.fn().mockResolvedValue(json(404, { message: "Resume not found." }));
    await expect(deleteResume("r1", notFound as unknown as typeof fetch)).rejects.toThrow(
      "Resume not found.",
    );
    const offline = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(selectResume("r1", offline as unknown as typeof fetch)).rejects.toThrow(
      /connection/,
    );
  });
});
