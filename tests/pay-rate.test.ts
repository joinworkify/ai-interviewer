import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import rawRoles from "@/lib/candidate/roles.json";
import {
  EMPTY_PAY_FILTER,
  filterRolesByPay,
  formatPayRate,
  validatePayFilter,
  validatePayRate,
  type PayType,
} from "@/lib/candidate/pay";

// JSON imports type payType as string, so narrow it here.
const roles = rawRoles.map((r) => ({ ...r, payType: r.payType as PayType }));

describe("formatPayRate", () => {
  it("formats per hour and per task", () => {
    expect(formatPayRate({ payMin: 10, payMax: 15, payType: "hour" })).toBe("$10~$15/Hour");
    expect(formatPayRate({ payMin: 2, payMax: 5, payType: "task" })).toBe("$2~$5/Task");
  });

  it("keeps cents but drops trailing zeros", () => {
    expect(formatPayRate({ payMin: 7.5, payMax: 12.25, payType: "hour" })).toBe("$7.5~$12.25/Hour");
  });
});

describe("validatePayRate", () => {
  it("accepts a valid range", () => {
    expect(validatePayRate({ min: "0", max: "10", type: "hour" })).toEqual({});
    expect(validatePayRate({ min: 10, max: 15, type: "task" })).toEqual({});
  });

  it("requires max to be greater than min", () => {
    expect(validatePayRate({ min: "10", max: "10", type: "hour" }).max).toBeDefined();
    expect(validatePayRate({ min: "15", max: "10", type: "hour" }).max).toBeDefined();
  });

  it("rejects empty, negative and missing values", () => {
    expect(validatePayRate({ min: "", max: "10", type: "hour" }).min).toBeDefined();
    expect(validatePayRate({ min: "-1", max: "10", type: "hour" }).min).toBeDefined();
    expect(validatePayRate({ min: "1", max: "", type: "hour" }).max).toBeDefined();
    expect(validatePayRate({ min: "1", max: "2", type: "" }).type).toBeDefined();
  });
});

describe("pay filter", () => {
  const ids = (f: Partial<typeof EMPTY_PAY_FILTER>) =>
    filterRolesByPay(roles, { ...EMPTY_PAY_FILTER, ...f }).map((r) => r.id);

  it("shows everything when empty", () => {
    expect(ids({})).toHaveLength(roles.length);
  });

  it("keeps roles whose range overlaps min and max", () => {
    expect(ids({ min: "0", max: "10" })).toEqual(["software-engineer"]);
    expect(ids({ min: "100" })).toContain("senior-software-engineer");
    expect(ids({ min: "100" })).not.toContain("software-engineer");
  });

  it("filters by type", () => {
    expect(ids({ type: "hour" })).toHaveLength(roles.length);
    expect(ids({ type: "task" })).toEqual([]);
  });

  it("does not apply an invalid range, and reports it", () => {
    expect(validatePayFilter({ min: "10", max: "10", type: "" }).max).toBeDefined();
    expect(validatePayFilter({ min: "20", max: "5", type: "" }).max).toBeDefined();
    expect(ids({ min: "20", max: "5" })).toHaveLength(roles.length);
  });

  it("accepts partial filters", () => {
    expect(validatePayFilter({ min: "5", max: "", type: "" })).toEqual({});
    expect(validatePayFilter({ min: "", max: "50", type: "task" })).toEqual({});
  });
});

describe("roles seed data", () => {
  it("has a valid pay rate for every role", () => {
    for (const r of roles) {
      expect(validatePayRate({ min: r.payMin, max: r.payMax, type: r.payType }), r.id).toEqual({});
    }
  });
});

describe("structured pay migration", () => {
  const sql = readFileSync(
    fileURLToPath(new URL("../supabase/migrations/20261117000000_roles_structured_pay_rate.sql", import.meta.url)),
    "utf8",
  ).toLowerCase();

  it("enforces max > min and the two types in the database", () => {
    expect(sql).toMatch(/pay_max > pay_min/);
    expect(sql).toMatch(/pay_type in \('hour', 'task'\)/);
  });

  it("is additive: no dropped tables or columns", () => {
    expect(sql).not.toMatch(/drop (table|column)\b/);
  });
});
