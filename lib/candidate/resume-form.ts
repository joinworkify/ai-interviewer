export interface CountryPhoneConfig {
  iso: string;
  name: string;
  flag: string;
  dialCode: string;
  minDigits: number;
  maxDigits: number;
  example: string;
}

export const COUNTRY_PHONE_CONFIGS: CountryPhoneConfig[] = [
  { iso: "MM", name: "Myanmar", flag: "🇲🇲", dialCode: "+95", minDigits: 7, maxDigits: 10, example: "912345678" },
  { iso: "TH", name: "Thailand", flag: "🇹🇭", dialCode: "+66", minDigits: 8, maxDigits: 9, example: "812345678" },
  { iso: "SG", name: "Singapore", flag: "🇸🇬", dialCode: "+65", minDigits: 8, maxDigits: 8, example: "81234567" },
  { iso: "MY", name: "Malaysia", flag: "🇲🇾", dialCode: "+60", minDigits: 9, maxDigits: 10, example: "123456789" },
  { iso: "US", name: "United States", flag: "🇺🇸", dialCode: "+1", minDigits: 10, maxDigits: 10, example: "2015550123" },
  { iso: "GB", name: "United Kingdom", flag: "🇬🇧", dialCode: "+44", minDigits: 10, maxDigits: 10, example: "7911123456" },
  { iso: "IN", name: "India", flag: "🇮🇳", dialCode: "+91", minDigits: 10, maxDigits: 10, example: "9876543210" },
  { iso: "JP", name: "Japan", flag: "🇯🇵", dialCode: "+81", minDigits: 9, maxDigits: 10, example: "9012345678" },
  { iso: "AU", name: "Australia", flag: "🇦🇺", dialCode: "+61", minDigits: 9, maxDigits: 9, example: "412345678" },
  { iso: "NL", name: "Netherlands", flag: "🇳🇱", dialCode: "+31", minDigits: 9, maxDigits: 9, example: "612345678" },
];

export function getCountryConfig(dialCode: string): CountryPhoneConfig {
  return (
    COUNTRY_PHONE_CONFIGS.find((c) => c.dialCode === dialCode) ??
    COUNTRY_PHONE_CONFIGS[0]
  );
}

export function validatePhoneNumber(
  rawPhone: string,
  dialCode: string = "+95"
): { valid: boolean; error?: string } {
  const trimmed = rawPhone.trim();
  // Phone is optional: empty input is valid
  if (!trimmed) {
    return { valid: true };
  }

  const cleaned = trimmed.replace(/[\s\-()]/g, "");
  if (!/^\d+$/.test(cleaned)) {
    return { valid: false, error: "Phone number must contain digits only." };
  }

  const config = getCountryConfig(dialCode);
  if (cleaned.length < config.minDigits || cleaned.length > config.maxDigits) {
    const digitRange =
      config.minDigits === config.maxDigits
        ? `${config.minDigits} digits`
        : `${config.minDigits}–${config.maxDigits} digits`;
    return {
      valid: false,
      error: `Enter a valid ${config.name} (${config.dialCode}) phone number (${digitRange}).`,
    };
  }

  return { valid: true };
}

// --- Helpers shared by the resume page and its tests ------------------------

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

/** Null when the file is acceptable, otherwise a message for the candidate. */
export function resumeFileError(file: { name: string; size: number }): string | null {
  if (!/\.(pdf|docx)$/i.test(file.name)) return "Please choose a PDF or DOCX file.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > MAX_RESUME_BYTES) return "That file is larger than 5 MB.";
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** Optional phone number: empty is fine; otherwise 7 to 10 digits. */
export function phoneError(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[\s\-()]/g, "");
  if (!/^\d+$/.test(cleaned)) return "Phone number must contain digits only.";
  if (cleaned.length < 7 || cleaned.length > 10) return "Enter a phone number with 7 to 10 digits.";
  return null;
}

/** Optional LinkedIn or portfolio link: empty is fine; otherwise a full http(s) URL. */
export function linkError(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:" || url.protocol === "http:") return null;
  } catch {
    // fall through
  }
  return "Enter a full link that starts with https://";
}
