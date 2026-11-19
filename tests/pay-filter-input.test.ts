import { describe, expect, it } from "vitest";
import { sanitizeMoneyInput } from "@/components/candidate/pay-rate-filter";

describe("sanitizeMoneyInput", () => {
  it("drops letters, signs and exponents", () => {
    expect(sanitizeMoneyInput("abc")).toBe("");
    expect(sanitizeMoneyInput("1e5")).toBe("15");
    expect(sanitizeMoneyInput("-12")).toBe("12");
    expect(sanitizeMoneyInput("$1,200")).toBe("1200");
  });

  it("keeps one decimal point and two decimals", () => {
    expect(sanitizeMoneyInput("12.5")).toBe("12.5");
    expect(sanitizeMoneyInput("1.2.3")).toBe("1.23");
    expect(sanitizeMoneyInput("10.999")).toBe("10.99");
    expect(sanitizeMoneyInput("10.")).toBe("10.");
  });

  it("limits the whole part length", () => {
    expect(sanitizeMoneyInput("123456789")).toBe("1234567");
  });
});
