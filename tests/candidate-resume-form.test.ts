import { describe, expect, it } from "vitest";
import {
  COUNTRY_PHONE_CONFIGS,
  MAX_RESUME_BYTES,
  formatFileSize,
  linkError,
  phoneError,
  phoneInputFromProfile,
  resumeFileError,
  validatePhoneNumber,
} from "@/lib/candidate/resume-form";

describe("resumeFileError", () => {
  it("accepts a PDF or DOCX up to 5 MB", () => {
    expect(resumeFileError({ name: "cv.pdf", size: 1000 })).toBeNull();
    expect(resumeFileError({ name: "CV.DOCX", size: MAX_RESUME_BYTES })).toBeNull();
  });

  it("rejects other types, empty files and files over 5 MB", () => {
    expect(resumeFileError({ name: "cv.png", size: 1000 })).toMatch(/PDF or DOCX/);
    expect(resumeFileError({ name: "cv.pdf", size: 0 })).toMatch(/empty/);
    expect(resumeFileError({ name: "cv.pdf", size: MAX_RESUME_BYTES + 1 })).toMatch(/5 MB/);
  });
});

describe("optional fields", () => {
  it("allow empty values", () => {
    expect(phoneError("")).toBeNull();
    expect(linkError("")).toBeNull();
  });

  it("validate phone numbers", () => {
    expect(phoneError("9 123 456 78")).toBeNull();
    expect(phoneError("abc")).not.toBeNull();
    expect(phoneError("123")).not.toBeNull();
  });

  it("validate links", () => {
    expect(linkError("https://linkedin.com/in/someone")).toBeNull();
    expect(linkError("linkedin.com/in/someone")).not.toBeNull();
    expect(linkError("javascript:alert(1)")).not.toBeNull();
  });
});

describe("phoneInputFromProfile", () => {
  it("splits a saved international number into country code and national number", () => {
    expect(phoneInputFromProfile("+95 9-123-456-78")).toEqual({
      iso: "MM",
      dialCode: "+95",
      phone: "912345678",
    });
  });

  it("uses the default country for a saved national number or an empty value", () => {
    expect(phoneInputFromProfile("2015550123")).toEqual({
      iso: "US",
      dialCode: "+1",
      phone: "2015550123",
    });
    expect(phoneInputFromProfile(null)).toEqual({ iso: "US", dialCode: "+1", phone: "" });
  });
});

describe("formatFileSize", () => {
  it("uses KB below 1 MB and MB above", () => {
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});

describe("country list", () => {
  it("covers every country, with unique ISO codes and Myanmar first", () => {
    const isos = COUNTRY_PHONE_CONFIGS.map((c) => c.iso);
    expect(new Set(isos).size).toBe(isos.length);
    expect(isos.length).toBeGreaterThan(200);
    expect(isos[0]).toBe("MM");
    for (const iso of ["CA", "DE", "BR", "PH", "ZA"]) expect(isos).toContain(iso);
  });

  it("lists countries that share a dial code separately", () => {
    const plusOne = COUNTRY_PHONE_CONFIGS.filter((c) => c.dialCode === "+1").map((c) => c.iso);
    expect(plusOne).toEqual(expect.arrayContaining(["US", "CA"]));
  });

  it("validates per country", () => {
    expect(validatePhoneNumber("", "MM").valid).toBe(true);
    expect(validatePhoneNumber("912345678", "MM").valid).toBe(true);
    expect(validatePhoneNumber("123", "DE").valid).toBe(false);
    expect(validatePhoneNumber("15123456789", "DE").valid).toBe(true);
  });
});
