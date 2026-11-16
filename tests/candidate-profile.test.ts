import { describe, expect, it, vi } from "vitest";
import {
  handleSaveProfile,
  validateProfileRequest,
  type ProfileHandlerDeps,
} from "@/lib/candidate/profile";
import { ProfileSaveError, saveProfile } from "@/lib/candidate/profile-client";

const USER = "11111111-1111-4111-8111-111111111111";

function deps(overrides: Partial<ProfileHandlerDeps> = {}) {
  const update = vi.fn().mockResolvedValue(true);
  const value: ProfileHandlerDeps = {
    getUserId: async () => USER,
    store: { update },
    ...overrides,
  };
  return { deps: value, update };
}

function post(
  body: unknown,
  headers: Record<string, string> = { "content-type": "application/json" },
) {
  return new Request("http://localhost/api/candidate/profile", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("validateProfileRequest", () => {
  it("normalises name and phone and keeps only the fields sent", () => {
    expect(
      validateProfileRequest({
        name: "  Ada   Lovelace ",
        phone: "+95 9 123-456 (78)",
      }),
    ).toEqual({
      ok: true,
      fields: { name: "Ada Lovelace", phone: "+95912345678" },
    });
  });

  it("clears optional fields with null or an empty string", () => {
    expect(
      validateProfileRequest({
        phone: "",
        linkedinUrl: null,
        portfolioUrl: "  ",
      }),
    ).toEqual({
      ok: true,
      fields: { phone: null, linkedinUrl: null, portfolioUrl: null },
    });
  });

  it.each([
    ["no known field", {}],
    ["an array", []],
    ["a string body", "x"],
    ["an empty name", { name: "  " }],
    ["a non-string name", { name: 5 }],
    ["a long name", { name: "a".repeat(101) }],
    ["a name with control characters", { name: "Ada\u0000" }],
    ["letters in the phone", { phone: "abc1234567" }],
    ["a short phone", { phone: "12345" }],
    ["a long phone", { phone: "1".repeat(16) }],
    ["a javascript: link", { portfolioUrl: "javascript:alert(1)" }],
    ["a data: link", { linkedinUrl: "data:text/html,x" }],
    ["a link with no scheme", { portfolioUrl: "linkedin.com/in/ada" }],
    ["a non-string link", { portfolioUrl: 5 }],
    [
      "a very long link",
      { portfolioUrl: `https://a.test/${"x".repeat(2100)}` },
    ],
  ])("rejects %s", (_label, body) => {
    expect(validateProfileRequest(body).ok).toBe(false);
  });

  it("accepts http and https links", () => {
    expect(
      validateProfileRequest({
        linkedinUrl: "https://linkedin.com/in/ada",
        portfolioUrl: "http://ada.test",
      }).ok,
    ).toBe(true);
  });
});

describe("handleSaveProfile", () => {
  it("saves for the verified user and returns only what was saved", async () => {
    const { deps: d, update } = deps();
    const res = await handleSaveProfile(
      post({ name: "Ada", userId: "someone-else" }),
      d,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      profile: { name: "Ada" },
    });
    expect(update).toHaveBeenCalledWith(USER, { name: "Ada" });
  });

  it("answers 401 without a session and does not touch the store", async () => {
    const { deps: d, update } = deps({ getUserId: async () => null });
    const res = await handleSaveProfile(post({ name: "Ada" }), d);
    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("answers 415 for a non-JSON body and 400 for invalid fields", async () => {
    const { deps: d, update } = deps();
    expect(
      (
        await handleSaveProfile(
          post("name=Ada", { "content-type": "text/plain" }),
          d,
        )
      ).status,
    ).toBe(415);
    const bad = await handleSaveProfile(
      post({ portfolioUrl: "javascript:alert(1)" }),
      d,
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_request");
    expect(update).not.toHaveBeenCalled();
  });

  it("answers 413 for an oversized body", async () => {
    const { deps: d } = deps();
    expect(
      (await handleSaveProfile(post({ name: "a".repeat(5000) }), d)).status,
    ).toBe(413);
  });

  it("answers 404 when there is no profile and 500 without leaking the cause", async () => {
    expect(
      (
        await handleSaveProfile(
          post({ name: "Ada" }),
          deps({ store: { update: async () => false } }).deps,
        )
      ).status,
    ).toBe(404);
    const res = await handleSaveProfile(
      post({ name: "Ada" }),
      deps({
        store: {
          update: async () => {
            throw new Error("db password is hunter2");
          },
        },
      }).deps,
    );
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
  });
});

describe("saveProfile (browser helper)", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status });

  it("posts the fields as JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { success: true }));
    await saveProfile(
      { name: "Ada", phone: null },
      fetchImpl as unknown as typeof fetch,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/candidate/profile");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ name: "Ada", phone: null });
  });

  it("throws the server's message, a fallback, or a connection message", async () => {
    await expect(
      saveProfile(
        { name: "" },
        vi
          .fn()
          .mockResolvedValue(
            json(400, { message: "name must be 1 to 100 characters." }),
          ) as unknown as typeof fetch,
      ),
    ).rejects.toThrow("name must be 1 to 100 characters.");
    await expect(
      saveProfile(
        { name: "A" },
        vi
          .fn()
          .mockResolvedValue(
            new Response("oops", { status: 500 }),
          ) as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(ProfileSaveError);
    await expect(
      saveProfile(
        { name: "A" },
        vi
          .fn()
          .mockRejectedValue(
            new TypeError("Failed to fetch"),
          ) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/connection/);
  });
});
