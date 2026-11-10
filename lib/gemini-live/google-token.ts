import { GoogleGenAI, type CreateAuthTokenConfig } from "@google/genai";

/**
 * Server-only: mints a Gemini Live ephemeral token with the permanent API
 * key. Uses API version v1beta, matching the browser `live.connect` client
 * (see https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens).
 */
export async function createGeminiAuthToken(
  apiKey: string,
  config: CreateAuthTokenConfig,
): Promise<{ name?: string }> {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1beta" } });
  const token = await ai.authTokens.create({ config });
  return { name: token.name };
}
