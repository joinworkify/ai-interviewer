import { describe, expect, it, vi } from "vitest";

import { uploadRecording } from "@/lib/recording/client";
import { baseMimeType, pickRecordingType } from "@/lib/recording/recorder";
import {
  handleConfirmRecording,
  handleCreateRecordingUpload,
  MAX_RECORDING_BYTES,
  recordingKey,
  type RecordingHandlerDeps,
  type RecordingRow,
} from "@/lib/recording/recording";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SID = "22222222-2222-4222-8222-222222222222";

function setup(over: { userId?: string | null; owns?: boolean; row?: RecordingRow | null; head?: { size: number; contentType: string } | null } = {}) {
  let row: RecordingRow | null = over.row ?? null;
  const deleteObject = vi.fn(async () => {});
  const deps: RecordingHandlerDeps = {
    getUserId: async () => (over.userId === undefined ? ME : over.userId),
    store: {
      ownsSession: async () => over.owns ?? true,
      get: async () => row,
      savePending: async (r) => void (row = { ...r, status: "pending" }),
      markUploaded: async () => void (row && (row = { ...row, status: "uploaded" })),
    },
    storage: {
      presignPut: vi.fn(async (key: string) => `https://s3.example/${key}?sig=1`),
      head: async () => (over.head === undefined ? null : over.head),
      deleteObject,
    },
  };
  return { deps, deleteObject, row: () => row };
}

const post = (body: unknown) =>
  new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("handleCreateRecordingUpload", () => {
  it("records a pending row under the user's folder and returns a presigned PUT", async () => {
    const t = setup();
    const res = await handleCreateRecordingUpload(post({ contentType: "audio/webm", size: 1000 }), SID, t.deps);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.upload.method).toBe("PUT");
    expect(body.upload.headers).toEqual({ "Content-Type": "audio/webm" });
    expect(body.upload.url).toContain(`recordings/${ME}/${SID}.webm`);
    expect(t.row()).toMatchObject({ user_id: ME, s3_key: recordingKey(ME, SID, "audio/webm"), status: "pending", size_bytes: 1000 });
  });

  it.each([
    ["signed out", { userId: null }, { contentType: "audio/webm", size: 10 }, 401],
    ["someone else's session", { owns: false }, { contentType: "audio/webm", size: 10 }, 404],
    ["a video type", {}, { contentType: "video/webm", size: 10 }, 400],
    ["a codec parameter", {}, { contentType: "audio/webm;codecs=opus", size: 10 }, 400],
    ["a prototype-key type", {}, { contentType: "constructor", size: 10 }, 400],
    ["zero bytes", {}, { contentType: "audio/webm", size: 0 }, 400],
    ["too big", {}, { contentType: "audio/webm", size: MAX_RECORDING_BYTES + 1 }, 400],
    ["fractional size", {}, { contentType: "audio/webm", size: 1.5 }, 400],
  ])("rejects %s", async (_label, over, body, status) => {
    const t = setup(over);
    const res = await handleCreateRecordingUpload(post(body), SID, t.deps);
    expect(res.status).toBe(status);
    expect(t.row()).toBeNull();
  });

  it("refuses a second recording once one is uploaded", async () => {
    const t = setup({ row: { session_id: SID, user_id: ME, s3_key: "k", content_type: "audio/webm", size_bytes: 5, status: "uploaded" } });
    const res = await handleCreateRecordingUpload(post({ contentType: "audio/webm", size: 10 }), SID, t.deps);
    expect(res.status).toBe(409);
  });

  it("answers 404 for a malformed id", async () => {
    const res = await handleCreateRecordingUpload(post({ contentType: "audio/webm", size: 10 }), "nope", setup().deps);
    expect(res.status).toBe(404);
  });
});

describe("handleConfirmRecording", () => {
  const pending: RecordingRow = { session_id: SID, user_id: ME, s3_key: "recordings/k.webm", content_type: "audio/webm", size_bytes: 1000, status: "pending" };

  it("marks the recording uploaded when the stored object matches", async () => {
    const t = setup({ row: pending, head: { size: 1000, contentType: "audio/webm" } });
    expect((await handleConfirmRecording(SID, t.deps)).status).toBe(200);
    expect(t.row()?.status).toBe("uploaded");
  });

  it("answers 409 when nothing was uploaded", async () => {
    const t = setup({ row: pending, head: null });
    expect((await handleConfirmRecording(SID, t.deps)).status).toBe(409);
    expect(t.row()?.status).toBe("pending");
  });

  it("deletes a mismatched object and answers 422", async () => {
    const t = setup({ row: pending, head: { size: 999, contentType: "audio/webm" } });
    expect((await handleConfirmRecording(SID, t.deps)).status).toBe(422);
    expect(t.deleteObject).toHaveBeenCalledWith("recordings/k.webm");
    expect(t.row()?.status).toBe("pending");
  });

  it("gives a stranger the same 404 as a missing recording", async () => {
    const t = setup({ userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", row: pending, head: { size: 1000, contentType: "audio/webm" } });
    expect((await handleConfirmRecording(SID, t.deps)).status).toBe(404);
    expect(t.row()?.status).toBe("pending");
  });

  it("requires sign-in", async () => {
    expect((await handleConfirmRecording(SID, setup({ userId: null }).deps)).status).toBe(401);
  });
});

describe("recorder helpers", () => {
  it("picks the first supported type, preferring webm/opus", () => {
    expect(pickRecordingType(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickRecordingType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickRecordingType(() => false)).toBeNull();
  });
  it("strips codec parameters", () => {
    expect(baseMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(baseMimeType("Audio/MP4")).toBe("audio/mp4");
  });
});

describe("uploadRecording", () => {
  const audio = new Blob([new Uint8Array(10)], { type: "audio/webm" });
  const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200 });

  it("asks for a URL, PUTs the audio to it, then confirms", async () => {
    const calls: [string, string][] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([init?.method ?? "GET", url]);
      return url.endsWith("/upload-url")
        ? ok({ upload: { url: "https://s3.example/put", headers: { "Content-Type": "audio/webm" } } })
        : ok();
    });
    expect(await uploadRecording({ sessionId: SID, audio, fetchImpl: fetchImpl as unknown as typeof fetch })).toBe("uploaded");
    expect(calls).toEqual([
      ["POST", `/api/sessions/${SID}/recording/upload-url`],
      ["PUT", "https://s3.example/put"],
      ["POST", `/api/sessions/${SID}/recording/confirm`],
    ]);
  });

  it("skips empty, oversized and unsupported audio without any request", async () => {
    const fetchImpl = vi.fn();
    for (const blob of [new Blob([], { type: "audio/webm" }), new Blob(["x"], { type: "video/mp4" })]) {
      expect(await uploadRecording({ sessionId: SID, audio: blob, fetchImpl: fetchImpl as unknown as typeof fetch })).toBe("skipped");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports failure, never throws, when the upload or network fails", async () => {
    const put500 = vi.fn(async (url: string) =>
      url.endsWith("/upload-url") ? ok({ upload: { url: "https://s3.example/put", headers: {} } }) : new Response("", { status: 500 }),
    );
    expect(await uploadRecording({ sessionId: SID, audio, fetchImpl: put500 as unknown as typeof fetch })).toBe("failed");
    const offline = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await uploadRecording({ sessionId: SID, audio, fetchImpl: offline as unknown as typeof fetch })).toBe("failed");
  });
});
