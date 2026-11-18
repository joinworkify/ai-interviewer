import { expect, it } from "vitest";
import { validatePayFilter, validatePayRate } from "@/lib/candidate/pay";
it("rejects non-finite pay inputs rather than saving invalid numeric values", () => {
  for (const value of [Infinity, -Infinity, NaN]) {
    expect(validatePayRate({ min: value, max: 20, type: "hour" }).min).toBeDefined();
    expect(validatePayRate({ min: 1, max: value, type: "hour" }).max).toBeDefined();
    expect(validatePayFilter({ min: String(value), max: "", type: "" }).min).toBeDefined();
    expect(validatePayFilter({ min: "", max: String(value), type: "" }).max).toBeDefined();
  }
});
