import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueCapability } from "@/lib/interviews/capability";
import {
  handleGenerateInterview,
  MAX_BODY_BYTES,
} from "@/lib/interviews/generate-handler";
import {
  DuplicateGenerationError,
  StoreError,
  type InterviewStore,
  type NewInterviewRow,
} from "@/lib/interviews/store";

const SECRET = "test-secret-that-is-definitely-longer-than-32-chars";
const USER = "11111111-2222-4333-8444-555555555555";
const NOW = 1_800_000_000_000;
const URL_ = "https://app.example.test/api/vapi/generate-interview";

const fullEnv = {
  VAPI_TOOL_SIGNING_SECRET: SECRET,
  LLM_API_KEY: "llm-key",
  LLM_MODEL: "test-model",
  LLM_BASE_URL: "https://llm.example.test/v1",
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
};

function fields(extra: Record<string, unknown> = {}) {
  return {
    role: "Frontend Developer",
    level: "Junior",
    type: "technical",
    techstack: "React, TypeScript",
    amount: 2,
    ...extra,
  };
}

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function token(opts: Parameters<typeof issueCapability>[2] = {}) {
  return issueCapability(USER, SECRET, { nowMs: NOW, ...opts });
}

class FakeStore implements InterviewStore {
  rows: (NewInterviewRow & { id: string })[] = [];
  existsError = false;
  insertError: Error | null = null;
  async generationExists(id: string) {
    if (this.existsError) throw new StoreError("db down");
    return this.rows.some((r) => r.generation_id === id);
  }
  async insert(row: NewInterviewRow) {
    if (this.insertError) throw this.insertError;
    if (this.rows.some((r) => r.generation_id === row.generation_id)) {
      throw new DuplicateGenerationError("dup");
    }
    const id = `iv-${this.rows.length + 1}`;
    this.rows.push({ ...row, id });
    return { id };
  }
}

function llmOk(questions = ["Q one?", "Q two?"]) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ questions }) } }],
        }),
        { status: 200 },
      ),
  );
}

let store: FakeStore;
beforeEach(() => {
  store = new FakeStore();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function run(
  request: Request,
  {
    env = fullEnv as Record<string, string | undefined>,
    fetchImpl = llmOk() as unknown as typeof fetch,
  } = {},
) {
  return handleGenerateInterview(request, {
    env,
    fetch: fetchImpl,
    now: () => NOW + 1000,
    createStore: () => store,
  });
}

describe("handleGenerateInterview", () => {
  it("generates and saves questions owned by the token subject", async () => {
    const { token: t, payload } = token();
    const fetchImpl = llmOk();
    const res = await run(req(fields({ capability: t })), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      success: true,
      interviewId: "iv-1",
      questionCount: 2,
      message: "Saved an interview with 2 questions.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.rows[0]).toMatchObject({
      user_id: USER,
      generation_id: payload.jti,
      role: "Frontend Developer",
      type: "technical",
      techstack: ["React", "TypeScript"],
      questions: ["Q one?", "Q two?"],
    });
  });

  it("accepts the capability from the x-interview-capability header", async () => {
    const res = await run(req(fields(), { "x-interview-capability": token().token }));
    expect(res.status).toBe(201);
  });

  it("rejects conflicting body and header capabilities", async () => {
    const res = await run(
      req(fields({ capability: token().token }), {
        "x-interview-capability": token().token,
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 without calling the LLM when the capability is missing/invalid/expired", async () => {
    const cases = [
      fields(),
      fields({ capability: "" }),
      fields({ capability: "garbage" }),
      fields({ capability: issueCapability(USER, `${SECRET}x`, { nowMs: NOW }).token }),
      fields({ capability: token({ nowMs: NOW - 3600_000 }).token }),
    ];
    for (const body of cases) {
      const fetchImpl = llmOk();
      const res = await run(req(body), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(res.status).toBe(401);
      expect((await res.json()).success).toBe(false);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
    expect(store.rows).toHaveLength(0);
  });

  it("does not reveal missing LLM/DB config to unauthenticated callers", async () => {
    const res = await run(req(fields({ capability: "garbage" })), {
      env: { VAPI_TOOL_SIGNING_SECRET: SECRET },
    });
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toMatch(/LLM_API_KEY/);
  });

  it("rejects a client-supplied userid even with a valid capability", async () => {
    const res = await run(
      req(fields({ capability: token().token, userid: "attacker" })),
    );
    expect(res.status).toBe(400);
    expect(store.rows).toHaveLength(0);
  });

  it("returns 400 with details for invalid fields", async () => {
    const res = await run(req(fields({ capability: token().token, amount: 50 })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
    expect(body.details.join(" ")).toMatch(/amount/);
  });

  it.each(["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"])(
    "rejects inherited prototype key %j as type with 400 invalid_request and no LLM call",
    async (type) => {
      const fetchImpl = llmOk();
      const res = await run(req(fields({ capability: token().token, type })), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_request");
      expect(body.details.join(" ")).toMatch(/type must be one of/);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(store.rows).toHaveLength(0);
    },
  );

  it("enforces content type, JSON and body size", async () => {
    const wrongType = new Request(URL_, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect((await run(wrongType)).status).toBe(415);
    expect((await run(req("{not json"))).status).toBe(400);
    expect((await run(req("[]"))).status).toBe(400);
    const big = req(fields({ capability: token().token, role: "a".repeat(MAX_BODY_BYTES) }));
    expect((await run(big)).status).toBe(413);
  });

  it("returns 503 when the signing secret is not configured", async () => {
    const res = await run(req(fields({ capability: "x" })), { env: {} });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_misconfigured");
  });

  it("returns an actionable 503 when LLM or Supabase secret config is missing", async () => {
    const fetchImpl = llmOk();
    const res = await run(req(fields({ capability: token().token })), {
      env: { VAPI_TOOL_SIGNING_SECRET: SECRET },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("server_misconfigured");
    expect(body.missing).toEqual(
      expect.arrayContaining(["LLM_API_KEY", "LLM_MODEL", "SUPABASE_SECRET_KEY"]),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is single-use: a replayed capability returns 409 without a second LLM call", async () => {
    const t = token().token;
    expect((await run(req(fields({ capability: t })))).status).toBe(201);
    const fetchImpl = llmOk();
    const res = await run(req(fields({ capability: t })), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.status).toBe(409);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(1);
  });

  it("maps a unique-violation race on insert to 409", async () => {
    store.insertError = new DuplicateGenerationError("dup");
    const res = await run(req(fields({ capability: token().token })));
    expect(res.status).toBe(409);
  });

  it.each([
    [401, 502, "llm_auth_failed"],
    [429, 503, "llm_rate_limited"],
    [500, 502, "llm_failed"],
  ])("maps LLM HTTP %i to %i %s and saves nothing", async (upstream, status, code) => {
    const fetchImpl = vi.fn(async () => new Response("err", { status: upstream }));
    const res = await run(req(fields({ capability: token().token })), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(code);
    expect(store.rows).toHaveLength(0);
  });

  it("maps unusable LLM output to 502 and saves nothing", async () => {
    const res = await run(req(fields({ capability: token().token })), {
      fetchImpl: llmOk(["only one?"]) as unknown as typeof fetch,
    });
    expect(res.status).toBe(502);
    expect(store.rows).toHaveLength(0);
  });

  it("maps LLM timeouts to 504", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("t", "TimeoutError");
    });
    const res = await run(req(fields({ capability: token().token })), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.status).toBe(504);
  });

  it("returns 500 on storage failures", async () => {
    store.existsError = true;
    expect((await run(req(fields({ capability: token().token })))).status).toBe(500);
    store.existsError = false;
    store.insertError = new StoreError("boom");
    expect((await run(req(fields({ capability: token().token })))).status).toBe(500);
  });
});
