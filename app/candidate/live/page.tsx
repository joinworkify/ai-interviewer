import { StepGate } from "@/components/candidate/step-gate";
import { GeminiInterview } from "@/components/candidate/gemini-interview";
import { LiveInterview } from "@/components/candidate/live-interview";
import { readGeminiLiveConfig } from "@/lib/gemini-live/config";

/**
 * Live interview on Gemini Live. The Gemini config is checked here, on the
 * server, so the API key never reaches the client. Without it (local work)
 * the screen runs the scripted stand-in interviewer instead.
 */
export default function LivePage() {
  const gemini = readGeminiLiveConfig(process.env);
  return <StepGate step="interview">{gemini.ok ? <GeminiInterview /> : <LiveInterview />}</StepGate>;
}

export const metadata = { title: "Live interview" };
