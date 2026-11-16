import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_RESUME_BYTES,
  cleanFileName,
  handleConfirmUpload,
  handleCreateUploadUrl,
  handleGetResume,
  validateUploadRequest,
  type ResumeHandlerDeps,
  type ResumeRow,
  type ResumeStorage,
  type ResumeStore,
} from "@/lib/candidate/resume";
import {
  createS3Client,
  createS3ResumeStorage,
  deleteUserResumeFiles,
  readResumeS3Config,
} from "@/lib/candidate/resume-s3";

const USER = "11111111-2222-4333-8444-555555555555";
const RESUME = "33333333-3333-4333-8333-333333333333";
const PDF = "application/pdf";

function post(body: unknown) {
  return new Request("http://localhost:3000/api/candidate/resume/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function row(over: Partial<ResumeRow> = {}): ResumeRow {
  return {
    id: RESUME,
    user_id: USER,
    s3_key: `resumes/${USER}/abc.pdf`,
    file_name: "cv.pdf",
    content_type: PDF,
    size_bytes: 1000,
    status: "pending",
    created_at: "2026-11-14T00:00:00Z",
    uploaded_at: null,
    ...over,
  };
}

function deps(
  over: { userId?: string | null; store?: Partial<ResumeStore>; storage?: Partial<ResumeStorage> } = {},
) {
  const store: ResumeStore = {
    createPending: vi.fn(async () => ({ id: RESUME })),
    get: vi.fn(async () => row()),
    markUploaded: vi.fn(async () => row({ status: "uploaded", uploaded_at: "2026-11-14T00:01:00Z" })),
    latestUploaded: vi.fn(async () => row({ status: "uploaded", uploaded_at: "2026-11-14T00:01:00Z" })),
    ...over.store,
  };
  const storage: ResumeStorage = {
    presignPut: vi.fn(async () => "https://s3.example/put"),
    presignGet: vi.fn(async () => "https://s3.example/get"),
    head: vi.fn(async () => ({ size: 1000, contentType: PDF })),
    deleteObject: vi.fn(async () => {}),
    ...over.storage,
  };
  const d: ResumeHandlerDeps = {
    getUserId: async () => (over.userId === undefined ? USER : over.userId),
    store,
    storage,
  };
  return { d, store, storage };
}

describe("validateUploadRequest", () => {
  it("accepts a PDF or .docx up to 5 MB and keeps only the base name", () => {
    expect(validateUploadRequest({ fileName: "C:\\docs\\cv.pdf", contentType: PDF, size: 10 })).toEqual({
      ok: true,
      fileName: "cv.pdf",
      contentType: PDF,
      size: 10,
    });
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(validateUploadRequest({ fileName: "cv.docx", contentType: docx, size: MAX_RESUME_BYTES }).ok).toBe(true);
  });

  it.each([
    ["another type", { fileName: "cv.png", contentType: "image/png", size: 10 }],
    ["an empty file", { fileName: "cv.pdf", contentType: PDF, size: 0 }],
    ["over 5 MB", { fileName: "cv.pdf", contentType: PDF, size: MAX_RESUME_BYTES + 1 }],
    ["a fractional size", { fileName: "cv.pdf", contentType: PDF, size: 1.5 }],
    ["no name", { fileName: "  ", contentType: PDF, size: 10 }],
    ["a long name", { fileName: `${"a".repeat(256)}.pdf`, contentType: PDF, size: 10 }],
    ["not an object", ["cv.pdf"]],
  ])("rejects %s", (_label, value) => {
    expect(validateUploadRequest(value).ok).toBe(false);
  });

  it("drops path parts and control characters from names", () => {
    expect(cleanFileName("../../etc/x\u0000y.pdf")).toBe("xy.pdf");
  });
});

describe("handleCreateUploadUrl", () => {
  const body = { fileName: "cv.pdf", contentType: PDF, size: 1000 };

  it("records a pending row under the user's folder and returns a PUT URL", async () => {
    const { d, store, storage } = deps();
    const res = await handleCreateUploadUrl(post(body), d);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({
      success: true,
      resumeId: RESUME,
      upload: { url: "https://s3.example/put", method: "PUT", headers: { "Content-Type": PDF } },
    });
    const pending = vi.mocked(store.createPending).mock.calls[0][0];
    expect(pending.userId).toBe(USER);
    expect(pending.key).toMatch(new RegExp(`^resumes/${USER}/[0-9a-f-]{36}\\.pdf$`));
    expect(storage.presignPut).toHaveBeenCalledWith(pending.key, PDF, 1000, 300);
  });

  it("needs a signed-in user", async () => {
    const { d, store } = deps({ userId: null });
    expect((await handleCreateUploadUrl(post(body), d)).status).toBe(401);
    expect(store.createPending).not.toHaveBeenCalled();
  });

  it("rejects a bad request without touching storage", async () => {
    const { d, store } = deps();
    expect((await handleCreateUploadUrl(post({ ...body, contentType: "text/plain" }), d)).status).toBe(400);
    expect((await handleCreateUploadUrl(post("{nope"), d)).status).toBe(400);
    expect(store.createPending).not.toHaveBeenCalled();
  });

  it("answers storage_failed without details when the database fails", async () => {
    const { d } = deps({ store: { createPending: vi.fn(async () => { throw new Error("db secret"); }) } });
    const res = await handleCreateUploadUrl(post(body), d);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

describe("handleConfirmUpload", () => {
  const confirm = (resumeId: unknown) => post({ resumeId });

  it("marks the resume uploaded when the object in S3 matches", async () => {
    const { d, store } = deps();
    const res = await handleConfirmUpload(confirm(RESUME), d);
    expect(res.status).toBe(200);
    expect((await res.json()).resume).toMatchObject({ id: RESUME, fileName: "cv.pdf", size: 1000 });
    expect(store.get).toHaveBeenCalledWith(USER, RESUME);
    expect(store.markUploaded).toHaveBeenCalledWith(USER, RESUME);
  });

  it("is 404 for someone else's or an unknown resume", async () => {
    const { d } = deps({ store: { get: vi.fn(async () => null) } });
    expect((await handleConfirmUpload(confirm(RESUME), d)).status).toBe(404);
  });

  it("is 409 while the file is not in S3 yet", async () => {
    const { d, store } = deps({ storage: { head: vi.fn(async () => null) } });
    expect((await handleConfirmUpload(confirm(RESUME), d)).status).toBe(409);
    expect(store.markUploaded).not.toHaveBeenCalled();
  });

  it("deletes a file that does not match what was announced", async () => {
    const { d, store, storage } = deps({
      storage: { head: vi.fn(async () => ({ size: 999_999, contentType: PDF })) },
    });
    expect((await handleConfirmUpload(confirm(RESUME), d)).status).toBe(422);
    expect(storage.deleteObject).toHaveBeenCalledWith(`resumes/${USER}/abc.pdf`);
    expect(store.markUploaded).not.toHaveBeenCalled();
  });

  it("is idempotent once uploaded", async () => {
    const { d, storage } = deps({ store: { get: vi.fn(async () => row({ status: "uploaded" })) } });
    expect((await handleConfirmUpload(confirm(RESUME), d)).status).toBe(200);
    expect(storage.head).not.toHaveBeenCalled();
  });

  it("needs sign-in and a uuid", async () => {
    expect((await handleConfirmUpload(confirm(RESUME), deps({ userId: null }).d)).status).toBe(401);
    expect((await handleConfirmUpload(confirm("x"), deps().d)).status).toBe(400);
  });
});

describe("handleGetResume", () => {
  it("returns the latest uploaded resume with a download URL", async () => {
    const { d, storage } = deps();
    const res = await handleGetResume(d);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      resume: { id: RESUME, fileName: "cv.pdf" },
      download: { url: "https://s3.example/get", expiresIn: 300 },
    });
    expect(storage.presignGet).toHaveBeenCalledWith(`resumes/${USER}/abc.pdf`, "cv.pdf", 300);
  });

  it("is 404 with no resume and 401 when signed out", async () => {
    expect((await handleGetResume(deps({ store: { latestUploaded: vi.fn(async () => null) } }).d)).status).toBe(404);
    expect((await handleGetResume(deps({ userId: null }).d)).status).toBe(401);
  });
});

describe("readResumeS3Config", () => {
  const env = {
    AWS_REGION: "ap-southeast-1",
    AWS_S3_BUCKET: "b",
    AWS_ACCESS_KEY_ID: "k",
    AWS_SECRET_ACCESS_KEY: "s",
  };

  it("needs the four AWS variables and lists the missing names", () => {
    expect(readResumeS3Config({ ...env, AWS_S3_BUCKET: " " })).toEqual({ ok: false, missing: ["AWS_S3_BUCKET"] });
    expect(readResumeS3Config({})).toMatchObject({ ok: false, missing: expect.arrayContaining(["AWS_REGION"]) });
  });

  it("uses an endpoint only when set (local S3)", () => {
    const real = readResumeS3Config(env);
    expect(real.ok && real.config.endpoint).toBeUndefined();
    const local = readResumeS3Config({ ...env, AWS_S3_ENDPOINT: "http://127.0.0.1:54490" });
    expect(local.ok && local.config.endpoint).toBe("http://127.0.0.1:54490");
  });
});

describe("S3 storage", () => {
  const config = {
    region: "us-east-1",
    bucket: "bucket",
    accessKeyId: "k",
    secretAccessKey: "s",
    endpoint: "http://127.0.0.1:54490",
  };

  it("signs a PUT URL that expires and pins the content type", async () => {
    const storage = createS3ResumeStorage(createS3Client(config), "bucket");
    const url = new URL(await storage.presignPut(`resumes/${USER}/a.pdf`, PDF, 10, 300));
    expect(url.origin + url.pathname).toBe(`http://127.0.0.1:54490/bucket/resumes/${USER}/a.pdf`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
  });

  it("deletes every file under the user's folder", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Contents: [{ Key: "resumes/u/1.pdf" }], IsTruncated: true, NextContinuationToken: "t" })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Contents: [{ Key: "resumes/u/2.pdf" }], IsTruncated: false })
      .mockResolvedValueOnce({});
    await deleteUserResumeFiles({ send } as never, "bucket", "u");
    const inputs = send.mock.calls.map(([cmd]) => cmd.input);
    expect(inputs[0]).toMatchObject({ Prefix: "resumes/u/" });
    expect(inputs[1].Delete.Objects).toEqual([{ Key: "resumes/u/1.pdf" }]);
    expect(inputs[2]).toMatchObject({ ContinuationToken: "t" });
    expect(inputs[3].Delete.Objects).toEqual([{ Key: "resumes/u/2.pdf" }]);
  });
});

describe("candidate_resumes migration", () => {
  const sql = readFileSync(
    fileURLToPath(new URL("../supabase/migrations/20261114000000_candidate_resumes.sql", import.meta.url)),
    "utf8",
  )
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();

  it("creates the table with RLS and lets browsers only read their own rows", () => {
    expect(sql).toContain("create table if not exists public.candidate_resumes");
    expect(sql).toContain("user_id uuid not null references public.profiles (id) on delete cascade");
    expect(sql).toContain("alter table public.candidate_resumes enable row level security");
    expect(sql).toContain("revoke all on table public.candidate_resumes from anon, authenticated");
    expect(sql).toContain("grant select on table public.candidate_resumes to authenticated");
    expect(sql).toContain("using (user_id = (select auth.uid()))");
    expect(sql).not.toMatch(/grant [a-z, ]*(insert|update|delete)[a-z, ]* on table public\.candidate_resumes to (authenticated|anon)/);
  });
});
