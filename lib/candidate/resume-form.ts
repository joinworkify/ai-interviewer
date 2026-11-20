import {
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import examples from "libphonenumber-js/mobile/examples";

export interface CountryPhoneConfig {
  /** ISO 3166-1 alpha-2 code. Unique, unlike the dial code (US and CA share +1). */
  iso: CountryCode;
  name: string;
  flag: string;
  dialCode: string;
  /** Longest national number (E.164 allows 15 digits including the country code). */
  maxDigits: number;
  /** A sample national mobile number, for the placeholder. */
  example: string;
}

/** Countries shown first, in this order; the rest follow alphabetically. */
const PRIORITY_ISOS: CountryCode[] = ["MM", "TH", "SG", "MY", "US", "GB", "IN", "JP", "AU", "NL"];

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function flagEmoji(iso: string): string {
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

function buildConfig(iso: CountryCode): CountryPhoneConfig {
  const callingCode = getCountryCallingCode(iso);
  return {
    iso,
    name: regionNames.of(iso) ?? iso,
    flag: flagEmoji(iso),
    dialCode: `+${callingCode}`,
    maxDigits: 15 - callingCode.length,
    example: getExampleNumber(iso, examples)?.nationalNumber ?? "",
  };
}

/** Every country libphonenumber knows, generated rather than hand-listed. */
export const COUNTRY_PHONE_CONFIGS: CountryPhoneConfig[] = [
  ...PRIORITY_ISOS,
  ...getCountries()
    .filter((iso) => !PRIORITY_ISOS.includes(iso))
    .sort((a, b) => (regionNames.of(a) ?? a).localeCompare(regionNames.of(b) ?? b)),
].map(buildConfig);

/** Country preselected on the resume step. */
export const DEFAULT_COUNTRY_ISO: CountryCode = "US";

export function getCountryConfig(iso: string): CountryPhoneConfig {
  return (
    COUNTRY_PHONE_CONFIGS.find((c) => c.iso === iso) ??
    COUNTRY_PHONE_CONFIGS.find((c) => c.iso === DEFAULT_COUNTRY_ISO) ??
    COUNTRY_PHONE_CONFIGS[0]
  );
}

/** Splits a saved profile phone ("+95 9123...") into country and national digits. */
export function phoneInputFromProfile(phone: string | null | undefined): {
  iso: CountryCode;
  dialCode: string;
  phone: string;
} {
  const normalized = phone?.trim() ?? "";
  const digits = normalized.replace(/\D/g, "");
  if (normalized.startsWith("+")) {
    const parsed = parsePhoneNumberFromString(normalized);
    if (parsed) {
      // Several countries share a calling code; fall back to the first one listed.
      const iso =
        parsed.country ??
        COUNTRY_PHONE_CONFIGS.find((c) => c.dialCode === `+${parsed.countryCallingCode}`)?.iso;
      if (iso) {
        return {
          iso,
          dialCode: `+${parsed.countryCallingCode}`,
          phone: digits.slice(parsed.countryCallingCode.length),
        };
      }
    }
  }
  const fallback = getCountryConfig(DEFAULT_COUNTRY_ISO);
  return { iso: fallback.iso, dialCode: fallback.dialCode, phone: digits };
}

export function validatePhoneNumber(
  rawPhone: string,
  iso: string = DEFAULT_COUNTRY_ISO
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

  const config = getCountryConfig(iso);
  const parsed = parsePhoneNumberFromString(`${config.dialCode}${cleaned}`, config.iso);
  if (!parsed || !parsed.isPossible()) {
    return {
      valid: false,
      error: `Enter a valid ${config.name} (${config.dialCode}) phone number${
        config.example ? `, e.g. ${config.example}` : ""
      }.`,
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
