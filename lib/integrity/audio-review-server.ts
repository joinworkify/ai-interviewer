import "server-only";

import { GoogleGenAI } from "@google/genai";

import { createS3Client, downloadResumeFile, readResumeS3Config } from "@/lib/candidate/resume-s3";
import { createSupabaseEvaluationStore } from "@/lib/evaluation/store";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

import { runAudioReview, type AudioReviewDeps } from "./audio-review";

/** Runs the audio review with the real database, S3 and Gemini. Never throws. */
export async function reviewSessionAudio(sessionId: string): ReturnType<typeof runAudioReview> {
  try {
    const db = createAdminClient();
    const s3 = readResumeS3Config(process.env);
    if (!s3.ok) return { kind: "failed", code: "no_recording" };
    const client = createS3Client(s3.config);
    const evaluation = createSupabaseEvaluationStore(db);
    const deps: AudioReviewDeps = {
      env: process.env,
      store: {
        async load(id) {
          const base = await evaluation.load(id);
          if (!base) return null;
          const rec = await db
            .from("interview_recordings")
            .select("s3_key, content_type, size_bytes")
            .eq("session_id", id)
            .eq("status", "uploaded")
            .maybeSingle();
          if (rec.error) throw new Error("load recording failed");
          return {
            sessionId: id,
            roleTitle: base.roleTitle,
            rubric: base.rubric,
            recording: rec.data ? { key: rec.data.s3_key, contentType: rec.data.content_type, size: rec.data.size_bytes } : null,
          };
        },
        async saveCompleted(id, review, model) {
          const { error } = await db.from("interview_audio_reviews").upsert({
            session_id: id,
            status: "completed",
            second_voice: review.secondVoice,
            reading_aloud: review.readingAloud,
            notes: review.notes,
            audio_criteria: review.criteria as unknown as Json,
            audio_overall: review.overall,
            model,
            error_code: null,
            updated_at: new Date().toISOString(),
          });
          if (error) throw new Error("save audio review failed");
        },
        async saveFailed(id, code) {
          const { error } = await db.from("interview_audio_reviews").upsert({
            session_id: id,
            status: "failed",
            error_code: code,
            audio_criteria: [],
            updated_at: new Date().toISOString(),
          });
          if (error) throw new Error("save audio failure failed");
        },
      },
      downloadAudio: (key) => downloadResumeFile(client, s3.config.bucket, key),
      async generate({ apiKey, model, mimeType, base64, system, user }) {
        const ai = new GoogleGenAI({ apiKey });
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: base64 } }, { text: user }] }],
          config: { systemInstruction: system, responseMimeType: "application/json" },
        });
        return res.text ?? "";
      },
    };
    return await runAudioReview(deps, sessionId);
  } catch {
    console.error("[audio-review] unexpected error");
    return { kind: "failed", code: "audio_failed" };
  }
}
