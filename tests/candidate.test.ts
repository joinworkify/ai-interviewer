import { describe, expect, it } from "vitest";
import { FIXTURE_ROLES, filterRoles, getRole, isValidEmail, login } from "@/lib/candidate/api";

describe("candidate fixture API", () => {
  it("filters roles by title or skill, case-insensitively", () => {
    expect(filterRoles(FIXTURE_ROLES, "")).toHaveLength(FIXTURE_ROLES.length);
    expect(filterRoles(FIXTURE_ROLES, "  SEMICONDUCTOR ").map((r) => r.id)).toEqual([
      "semiconductor-engineering-expert",
    ]);
    expect(filterRoles(FIXTURE_ROLES, "typescript").length).toBeGreaterThan(0);
    expect(filterRoles(FIXTURE_ROLES, "no such role")).toEqual([]);
  });

  it("rejects emails that are not invited", async () => {
    await expect(login("someone@else.com", "x")).rejects.toMatchObject({ code: "AUTH_INVALID" });
    await expect(login("cand_test_01@datasea.test", "")).rejects.toMatchObject({ code: "AUTH_INVALID" });
  });

  it("accepts only email-shaped input", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("  cand@datasea.test ")).toBe(true);
    for (const bad of ["", "abc", "a@b", "a b@c.d", "@b.co", "a@.co "]) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });

  it("finds a role by id and rejects unknown ids", async () => {
    expect((await getRole("software-engineer")).title).toBe("Software Engineer");
    await expect(getRole("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
