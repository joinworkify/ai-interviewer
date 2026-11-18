import { describe, expect, it } from "vitest";
import {
  APPLICATION_STEPS,
  redirectFor,
  setupPath,
  stepFromPathname,
  stepHref,
  applyHref,
  type Progress,
} from "@/lib/candidate/steps";

const ROLE = "software-engineer";
const OPEN = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const none: Progress = { roleId: ROLE, resume: { uploaded: false }, attempt: null };
const open: Progress = { roleId: ROLE, resume: { uploaded: true }, attempt: { id: OPEN } };

describe("APPLICATION_STEPS", () => {
  it("lists the five steps in order with unique ids", () => {
    expect(APPLICATION_STEPS.map((s) => s.id)).toEqual([
      "role",
      "resume",
      "consent",
      "setup",
      "interview",
    ]);
    expect(new Set(APPLICATION_STEPS.map((s) => s.id)).size).toBe(5);
    for (const s of APPLICATION_STEPS) expect(s.description.length).toBeGreaterThan(0);
  });

  it("says the resume is optional", () => {
    expect(APPLICATION_STEPS.find((s) => s.id === "resume")?.label).toMatch(/optional/i);
  });
});

describe("stepFromPathname", () => {
  it.each([
    ["/candidate/roles/software-engineer", "role"],
    ["/candidate/roles/software-engineer/", "role"],
    ["/candidate/resume", "resume"],
    ["/candidate/consent", "consent"],
    ["/candidate/setup", "setup"],
    ["/candidate/live", "interview"],
    ["/candidate/result", "done"],
    ["/candidate/result/", "done"],
  ])("%s is %s", (path, step) => {
    expect(stepFromPathname(path)).toBe(step);
  });

  it.each([
    "/candidate",
    "/candidate/roles",
    "/candidate/roles/",
    "/candidate/roles/a/b",
    "/candidate/profile",
    "/candidate/resumes",
    "/auth/login",
    "/",
  ])("%s is not part of an application", (path) => {
    expect(stepFromPathname(path)).toBeNull();
  });
});

describe("redirectFor", () => {
  describe("resume and consent", () => {
    it.each(["resume", "consent"] as const)("%s opens when no attempt is open", (step) => {
      expect(redirectFor(step, none, null)).toBeNull();
    });

    it.each(["resume", "consent"] as const)(
      "%s sends the candidate on to setup once an attempt is open",
      (step) => {
        expect(redirectFor(step, open, null)).toBe(setupPath(OPEN, ROLE));
      },
    );

    it.each(["resume", "consent"] as const)(
      "%s opens when the URL has no role (the page explains it)",
      (step) => {
        expect(redirectFor(step, null, null)).toBeNull();
      },
    );

    it.each(["resume", "consent"] as const)(
      "%s opens again on a deliberate go-back with the open attempt",
      (step) => {
        expect(redirectFor(step, open, OPEN)).toBeNull();
      },
    );

    it.each(["resume", "consent"] as const)(
      "%s still skips forward for any other attempt id",
      (step) => {
        expect(redirectFor(step, open, OTHER)).toBe(setupPath(OPEN, ROLE));
      },
    );

    it.each(["resume", "consent"] as const)(
      "%s drops a finished attempt from the URL and opens fresh",
      (step) => {
        expect(redirectFor(step, none, OTHER)).toBe(`/candidate/${step}?role=${ROLE}`);
      },
    );
  });

  describe("setup and interview", () => {
    it.each(["setup", "interview"] as const)("%s opens for the open attempt", (step) => {
      expect(redirectFor(step, open, OPEN)).toBeNull();
    });

    it.each(["setup", "interview"] as const)(
      "%s redirects another attempt id to the open one",
      (step) => {
        expect(redirectFor(step, open, OTHER)).toBe(setupPath(OPEN, ROLE));
        expect(redirectFor(step, open, null)).toBe(setupPath(OPEN, ROLE));
      },
    );

    it.each(["setup", "interview"] as const)(
      "%s sends a closed or unknown attempt to its result",
      (step) => {
        expect(redirectFor(step, none, OTHER)).toBe(`/candidate/result?attempt=${OTHER}`);
      },
    );

    it.each(["setup", "interview"] as const)(
      "%s without an attempt goes back to the role",
      (step) => {
        expect(redirectFor(step, none, null)).toBe(`/candidate/roles/${ROLE}`);
      },
    );

    it.each(["setup", "interview"] as const)("%s without a role goes to the role list", (step) => {
      expect(redirectFor(step, null, OPEN)).toBe("/candidate/roles");
    });
  });

  it("encodes ids placed in redirect URLs", () => {
    expect(redirectFor("setup", none, "a&b=c")).toBe("/candidate/result?attempt=a%26b%3Dc");
  });
});

describe("stepHref", () => {
  it("links back to earlier steps, keeping the open attempt so they do not skip forward", () => {
    expect(stepHref("role", ROLE, OPEN)).toBe(`/candidate/roles/${ROLE}`);
    expect(stepHref("resume", ROLE, OPEN)).toBe(`/candidate/resume?role=${ROLE}&attempt=${OPEN}`);
    expect(stepHref("consent", ROLE, OPEN)).toBe(`/candidate/consent?role=${ROLE}&attempt=${OPEN}`);
    expect(stepHref("setup", ROLE, OPEN)).toBe(setupPath(OPEN, ROLE));
  });

  it("has no link without an attempt for setup, for the interview, or without a role", () => {
    expect(stepHref("resume", ROLE, null)).toBe(`/candidate/resume?role=${ROLE}`);
    expect(stepHref("setup", ROLE, null)).toBeNull();
    expect(stepHref("interview", ROLE, OPEN)).toBeNull();
    expect(stepHref("resume", null, OPEN)).toBeNull();
  });

  it("encodes the ids", () => {
    expect(stepHref("consent", "a&b", "c=d")).toBe("/candidate/consent?role=a%26b&attempt=c%3Dd");
  });
});

describe("applyHref", () => {
  it("goes straight to the resume step when signed in", () => {
    expect(applyHref(ROLE, true)).toBe(`/candidate/resume?role=${ROLE}`);
  });

  it("goes to login first when signed out, coming back to the resume step", () => {
    const href = applyHref(ROLE, false);
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/auth/login");
    expect(url.searchParams.get("next")).toBe(`/candidate/resume?role=${ROLE}`);
  });

  it("encodes the role id", () => {
    expect(applyHref("a&b", true)).toBe("/candidate/resume?role=a%26b");
  });
});
