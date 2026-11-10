# Gemini Live voice interviewer (prototype)

A browser voice **interviewer** that talks to Google Gemini Live directly.
It does **not** use Vapi or Dograh. The existing Vapi interview generator
(`/protected/interview`, `VAPI_SETUP.md`) is unchanged and independent.

- Page: **`/protected/interview/gemini`** (signed-in users only; linked from
  `/protected` and `/protected/interview`)
- Token API: **`POST /api/gemini-live/token`**

Official references:
[Live API](https://ai.google.dev/gemini-api/docs/live-api) ·
[Ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens) ·
[Capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities) ·
[Session management](https://ai.google.dev/gemini-api/docs/live-api/session-management)

## 1. Environment setup

Add these to your existing server env file (`.env.local` locally, or your
hosting provider's settings). Placeholders are in `.env.example`.

| Variable | Value | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | Your Google AI Studio key from <https://aistudio.google.com/apikey> | **Server-only.** Never prefix with `NEXT_PUBLIC_`. Used only to mint ephemeral tokens. |
| `GEMINI_LIVE_MODEL` | A Live API native-audio model id, e.g. `gemini-3.8-live` | Required, no default. Check the current id on the Live API page. Text models such as `gemini-2.5-flash` are rejected with a setup error. A leading `models/` is accepted. |
| `GEMINI_LIVE_APP_ORIGIN` | Optional. The public origin users load the app from, e.g. `https://interviews.example.com` | **Server-only.** Format is `scheme://host[:port]` with no path. Set it behind a reverse proxy, CDN or container where the app server sees an internal Host (e.g. `10.0.0.5:3000`). An invalid value fails closed: the token API returns 403 and the page lists it as invalid. |

Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`)
must already be set for sign-in. No Supabase secret/service-role key, Vapi
key, database table or migration is needed for this feature.

Restart `npm run dev` (or redeploy) after changing env vars. If something is
missing, the page shows a "Setup incomplete" panel that lists the variable
**names** (never values) and disables Start, and the token API returns a
structured `503 { error: "gemini_not_configured", missing, invalid }`.

## 2. Architecture

```
Browser (signed in)                 Next.js server                     Google
───────────────────                 ──────────────                     ──────
form: role / level / stack
Start ─► mic permission (getUserMedia)
      ─► POST /api/gemini-live/token ─► same-origin check
                                       Supabase getClaims() (identity)
                                       GEMINI_* config check
                                       strict field validation
                                       per-user throttle
                                       authTokens.create (v1beta) ──────► one-use token
      ◄──── { token, model, … } ◄─────
      ─► native WebSocket (v1beta, BidiGenerateContentConstrained) ─────► Gemini Live
mic ─► AudioWorklet ─► resample 16 kHz PCM16 ─► base64 ─► sendRealtimeInput
speaker ◄─ gapless queue ◄─ PCM16 24 kHz ◄─ every modelTurn audio part
```

**Token (server, `lib/gemini-live/token-handler.ts`, `prompt.ts`)**

- `uses: 1` — one session per token.
- `newSessionExpireTime`: now + 60 s (the browser must connect within 1 min).
- `expireTime`: now + 60 s + 5 min + 30 s grace.
- `liveConnectConstraints` lock the model, `responseModalities: [AUDIO]`,
  the interviewer system instruction (built from the validated
  role/level/stack), the `end_interview` function tool, and input/output
  audio transcription. `lockAdditionalFields` is deliberately omitted so
  the whole constrained config is locked; the browser cannot change the
  prompt, model or tools. The real SDK request shape is checked in
  `tests/gemini-live-google-token.test.ts`.
- Check order: Origin → Supabase claims → Gemini config → body/fields →
  throttle → Google. Responses are `cache-control: no-store`.
- **Origin check (CSRF protection, not identity)**, in
  `lib/gemini-live/origin.ts`. The browser's `Origin` must match the expected
  origin exactly, and `Sec-Fetch-Site`, when present, must be `same-origin`.
  The expected origin is:
  1. `GEMINI_LIVE_APP_ORIGIN` when it is set; or
  2. the scheme from `request.url` plus the authority from a strictly
     validated `Host` header. The `request.url` authority is used only when
     there is no Host header.

  Option 2 exists because `next dev` can report `request.url` as
  `http://localhost:PORT` while the browser is actually on
  `http://127.0.0.1:PORT`. `X-Forwarded-Host` / `X-Forwarded-Proto` are
  **not** trusted. Behind a TLS-terminating proxy, the server sees `http:`
  and/or an internal Host, so set `GEMINI_LIVE_APP_ORIGIN` to the public
  origin.
- The exact path `/api/gemini-live/token` is exempt from the login redirect
  in `lib/supabase/proxy.ts`. The proxy still refreshes the session cookie,
  and the route checks Supabase claims itself, so signed-out callers get a
  JSON `401 { error: "unauthorized" }` instead of an HTML redirect. No other
  path is exempted.
- Identity and throttling use only the verified session user (`sub`). The
  body accepts only `role`, `level`, `techstack`; any other key (e.g.
  `userId`) is a `400`.
- Google failures are logged as a status code only and returned as generic
  messages (`502 provider_auth_failed` / `503 provider_rate_limited` /
  `502 provider_error` / `504 provider_timeout`). The permanent key never
  leaves the server.

**Browser (`lib/gemini-live/controller.ts`, `browser.ts`, `audio.ts`, `player.ts`)**

- **Live transport** (`lib/gemini-live/live-transport.ts`). The browser
  uses a small native `WebSocket` client rather than `ai.live.connect`.
  `@google/genai` is used only on the server, to mint tokens. The SDK's
  `connect()` gives back no handle to the socket until `setupComplete`, so a
  stalled setup could not be cancelled. This transport:
  - connects to
    `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=<encodeURIComponent(token)>`,
    refusing anything that is not an `auth_tokens/…` value;
  - sends the same wire messages as `@google/genai` 3.0.0 (checked against
    its `dist/web/index.mjs`): `{"setup":{"model":"models/…","generationConfig":{"responseModalities":["AUDIO"]},"inputAudioTranscription":{},"outputAudioTranscription":{}}}`,
    `{"realtimeInput":{audio|audioStreamEnd|text}}` and
    `{"toolResponse":{"functionResponses":[{id,name,response}]}}`. The token
    still locks the real prompt, tools and model on Google's side;
  - takes an `AbortSignal` (End, unmount, failure) and has a **15 s setup
    timeout**. Either one closes the real socket immediately, even before it
    opens or while waiting for `setupComplete`, and rejects. An already-aborted
    signal never creates a socket. Cleanup is idempotent, and later socket
    events are ignored;
  - decodes string, `Blob` and `ArrayBuffer` frames one after another, so
    messages stay in order, and forwards the parsed JSON unchanged. All
    `modelTurn` parts are handled by the controller.
- **API version:** v1beta is used for both token minting and the WebSocket,
  as the official Live API / ephemeral-token docs recommend. This choice
  follows the docs. **It has not been tested against Google's live service
  from this repo.** All automated tests use fakes or stubbed network, so
  acceptance by Google is still to be confirmed in a manual browser run.
- Microphone: `getUserMedia` (echo cancellation/noise suppression) →
  `public/worklets/pcm-capture-processor.js` → main-thread streaming
  resampler (device rate, e.g. 48/44.1 kHz → 16 kHz, box-filtered) →
  16-bit little-endian PCM → base64 100 ms chunks with
  `audio/pcm;rate=16000`.
- Output: every `inlineData` audio part of every `modelTurn` is decoded
  (PCM16, 24 kHz unless the mime type says otherwise) and scheduled
  back-to-back with Web Audio.
- Barge-in: on `serverContent.interrupted` all scheduled audio is stopped
  and cleared immediately, and the interviewer transcript line is marked
  "(interrupted)".
- Transcripts: incremental `inputTranscription`/`outputTranscription`
  fragments are merged into partial (italic) lines that finalize on
  `turnComplete`, `interrupted` or `finished`. Late candidate fragments stay
  above the interviewer's reply.
- `end_interview` tool: the client sends a `sendToolResponse` with the
  matching call `id`, enters "closing", releases the mic, lets the closing
  sentence finish playing (up to 10 s), then closes the session.
- Lifecycle: phases `microphone → authorizing → connecting → active →
  (closing) → ended | error`. End works in every phase. Each Start is an
  attempt. End, unmount, errors and retries invalidate it, so late
  microphone streams are stopped and late sessions are closed, never adopted.
  The mic is requested before the token, so a denied permission spends no
  token or quota.
- The interview is started by a short text kickoff. Setup is never done by
  voice.

## 3. Browser requirements

- `getUserMedia` and AudioWorklet need a **secure context**: HTTPS, or
  `http://localhost` / `http://127.0.0.1` in development. On a LAN IP over
  plain HTTP the page shows "Microphone access requires a secure page".
- Recent Chrome, Edge, Firefox or Safari. Headphones are recommended because
  speaker echo can trigger false barge-in.
- Allow microphone permission when prompted. If you denied it, re-enable it
  in the site settings and press Start again.

## 4. Session length and reconnection

- **Prototype cap: 5 minutes per session.** 30 s before the cap the model is
  told to wrap up and call `end_interview`; at 5:00 the client hard-stops.
- Live WebSocket connections are limited to roughly 10 minutes and need
  session resumption to go longer (see Session management docs). **Session
  resumption, context-window compression and seamless reconnect are not
  implemented.** If Google sends `goAway` or drops the connection, the page
  shows a notice/error and the session ends. Press Start again for a new
  session, which has no memory of the previous one.

## 5. Costs, quotas and privacy

- Audio goes **directly from the browser to Google** and is billed to the
  project that owns `GEMINI_API_KEY`. Live audio pricing applies per session.
  Set budgets/quotas in Google Cloud / AI Studio.
- App-side throttle: **5 tokens per user per 10 minutes, per server
  instance, in memory** (`lib/gemini-live/rate-limit.ts`). It resets on
  restart and is not shared across instances or serverless workers. It is a
  brake, not a quota. Use a shared store plus Google-side quotas for
  production.
- Nothing is recorded or stored by this app: no audio, no transcript in the
  database. The transcript lives only in the open tab and can optionally be
  downloaded as JSON by the user. Google's data-use terms for the Gemini API
  apply to audio sent to Google.
- Transcripts are machine-generated, may be wrong, and are **not
  authoritative hiring evidence**. No scoring or feedback is produced.

## 6. Run and verify locally

```bash
npm install            # includes @google/genai (server-side token minting)
# add GEMINI_API_KEY and GEMINI_LIVE_MODEL to .env.local
npm run dev            # http://localhost:3000
```

1. Sign in, open `/protected`, click **Practice interview (Gemini Live)**.
2. Without the Gemini vars you should see the setup panel and a disabled
   Start button.
3. With them set: enter a role, level and stack, then press **Start
   interview**, allow the mic. The status goes Waiting for microphone →
   Preparing → Connecting → Interview in progress, and the interviewer greets
   you and asks one question.
4. Answer; talk over the interviewer to check that audio stops immediately
   (barge-in). Say "that's all, bye" and the interviewer should close
   politely and the session ends. Or press **End interview** at any point,
   including while connecting.
5. Check DevTools: the request to `/api/gemini-live/token` returns
   `auth_tokens/…`, never your API key, with `Cache-Control: no-store`.

Automated checks (no live Google calls; Google and Supabase are mocked):

```bash
npm run test && npm run typecheck && npm run lint && npm run build
```

`npm run lint` has one pre-existing error in `tailwind.config.ts:62`
(`require()` import), which is unrelated to this feature.

## 7. Current limitations

- No session resumption or reconnect; 5-minute cap (see §4).
- In-memory, per-instance throttle only (see §5).
- Behind a proxy that changes the scheme or Host, you must set
  `GEMINI_LIVE_APP_ORIGIN`. Without it, requests are rejected with
  `403 forbidden_origin`. Forwarded headers are intentionally not trusted.
  Only one public origin is supported.
- The browser transport mirrors the SDK 3.0.0 wire format. Google protocol
  changes would need manual updates (see `lib/gemini-live/live-transport.ts`).
- English-only prompt. One fixed interviewer voice (the model default).
- The `GEMINI_LIVE_MODEL` check is a naming heuristic (`live` /
  `native-audio`). An unavailable model id fails at connect time with a
  connection error.
- Lifecycle logic is covered through the framework-agnostic controller with
  injected fakes. `tests/gemini-live-component.test.ts` mounts the real
  component in jsdom under StrictMode. It covers the Start/End form wiring,
  including emulating the browser's microtask checkpoint before a click's
  default action. The WebSocket transport is tested against a fake socket
  (`tests/gemini-live-transport.test.ts`), including with the real
  controller. The Web Audio/AudioWorklet adapters (`lib/gemini-live/browser.ts`,
  the worklet) are verified only in a real browser.
- Not verified against a live Gemini endpoint by the automated tests.
- No persistence, scoring, feedback or recordings.
