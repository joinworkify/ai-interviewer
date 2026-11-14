import { describe, expect, it } from "vitest";
import {
  MAX_RESUME_BYTES,
  formatFileSize,
  linkError,
  phoneError,
  resumeFileError,
} from "@/lib/candidate/resume";

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

describe("formatFileSize", () => {
  it("uses KB below 1 MB and MB above", () => {
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});
