import { describe, expect, it, vi } from "vitest";

import { applicationStage, notifiableStage } from "@/lib/candidate/stage";
import { createEmailSender } from "@/lib/notifications/email";
import { composeStageEmail, notifyCandidate, type NotifyStore } from "@/lib/notifications/review-notify";

describe("applicationStage", () => {
  it.each([
    ["submitted", null, "applied"],
    ["submitted", "pending", "applied"],
    ["submitted", "in_progress", "in_review"],
    ["submitted", "completed", "in_review"],
    ["submitted", "accepted", "accepted"],
    ["submitted", "rejected", "not_selected"],
    ["processing", null, "processing"],
    ["processing", "in_progress", "processing"],
    ["incomplete", "pending", "incomplete"],
    ["incomplete", "in_progress", "incomplete"],
    // A reviewer's decision always wins, even over an unfinished interview.
    ["incomplete", "accepted", "accepted"],
    ["processing", "rejected", "not_selected"],
  ] as const)("%s interview + review %s -> %s", (progress, review, stage) => {
    expect(applicationStage(progress, review)).toBe(stage);
  });

  it("only emails for stages a candidate cares about", () => {
    expect(notifiableStage("pending")).toBeNull();
    expect(notifiableStage("in_progress")).toBe("in_review");
    expect(notifiableStage("completed")).toBe("in_review");
    expect(notifiableStage("accepted")).toBe("accepted");
    expect(notifiableStage("rejected")).toBe("not_selected");
  });
});

describe("composeStageEmail", () => {
  it("names the candidate and role and links to the status page", () => {
    const m = composeStageEmail("accepted", { name: "Aye", roleTitle: "Data Analyst" }, "https://app.example/candidate/applications");
    expect(m.subject).toMatch(/good news/i);
    expect(m.text).toContain("Hi Aye,");
    expect(m.text).toContain("Data Analyst");
    expect(m.text).toContain("https://app.example/candidate/applications");
  });

  it("copes with no name, role or link, and never mentions scores or notes", () => {
    for (const stage of ["in_review", "accepted", "not_selected"] as const) {
      const m = composeStageEmail(stage, { name: null, roleTitle: null }, null);
      expect(m.text.startsWith("Hello,")).toBe(true);
      expect(m.text).not.toMatch(/score|http/i);
    }
  });

  it("is kind when the answer is no", () => {
    expect(composeStageEmail("not_selected", { name: null, roleTitle: null }, null).text).toMatch(/thank you/i);
  });
});

function fakeStore(over: { target?: { userId: string; email: string; name: string | null; roleTitle: string | null } | null; claimed?: boolean } = {}) {
  const claim = vi.fn(async () => over.claimed ?? true);
  const release = vi.fn(async () => {});
  const store: NotifyStore = {
    load: async () => (over.target === undefined ? { userId: "u", email: "a@example.com", name: "Aye", roleTitle: "Analyst" } : over.target),
    claim,
    release,
  };
  return { store, claim, release };
}

describe("notifyCandidate", () => {
  const base = { sessionId: "s", link: null } as const;

  it("claims the stage, then sends once", async () => {
    const { store, claim } = fakeStore();
    const send = vi.fn(async () => true);
    expect(await notifyCandidate({ ...base, store, send, status: "accepted" })).toBe("sent");
    expect(claim).toHaveBeenCalledWith("s", "accepted");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "a@example.com" }));
  });

  it("does not send twice for the same stage", async () => {
    const { store } = fakeStore({ claimed: false });
    const send = vi.fn(async () => true);
    expect(await notifyCandidate({ ...base, store, send, status: "in_progress" })).toBe("already_sent");
    expect(send).not.toHaveBeenCalled();
  });

  it("releases the claim when sending fails, so it can be retried", async () => {
    const { store, release } = fakeStore();
    expect(await notifyCandidate({ ...base, store, send: async () => false, status: "rejected" })).toBe("failed");
    expect(release).toHaveBeenCalledWith("s", "not_selected");
  });

  it.each([
    ["a status with no email", "pending", {}, true],
    ["no email provider configured", "accepted", {}, false],
    ["a candidate with no address", "accepted", { target: null }, true],
  ] as const)("skips for %s", async (_label, status, over, hasSender) => {
    const { store, claim } = fakeStore(over);
    const send = hasSender ? vi.fn(async () => true) : null;
    expect(await notifyCandidate({ ...base, store, send, status })).toBe("skipped");
    expect(claim).not.toHaveBeenCalled();
  });
});

describe("createEmailSender", () => {
  it("is off without an API key and a sender address", () => {
    expect(createEmailSender({})).toBeNull();
    expect(createEmailSender({ RESEND_API_KEY: "k" })).toBeNull();
    expect(createEmailSender({ EMAIL_FROM: "x@y.z" })).toBeNull();
  });

  it("posts to Resend with the key and reports success or failure", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const send = createEmailSender({ RESEND_API_KEY: "key", EMAIL_FROM: "DataSea <hi@datasea.test>" }, fetchImpl as unknown as typeof fetch)!;
    expect(await send({ to: "a@example.com", subject: "S", text: "T" })).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer key");
    expect(JSON.parse(String(init.body))).toMatchObject({ from: "DataSea <hi@datasea.test>", to: ["a@example.com"], subject: "S", text: "T" });

    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = createEmailSender({ RESEND_API_KEY: "k", EMAIL_FROM: "f" }, (async () => new Response("", { status: 422 })) as unknown as typeof fetch)!;
    expect(await bad({ to: "a@example.com", subject: "S", text: "T" })).toBe(false);
    const down = createEmailSender({ RESEND_API_KEY: "k", EMAIL_FROM: "f" }, (async () => { throw new Error("net"); }) as unknown as typeof fetch)!;
    expect(await down({ to: "a@example.com", subject: "S", text: "T" })).toBe(false);
  });
});
