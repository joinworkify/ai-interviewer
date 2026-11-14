"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useState } from "react";
import {
  COUNTRY_PHONE_CONFIGS,
  formatFileSize,
  getCountryConfig,
  linkError,
  resumeFileError,
  validatePhoneNumber,
} from "@/lib/candidate/resume";

export default function CandidateResumePage() {
  const router = useRouter();
  const roleId = useSearchParams().get("role") ?? "";
  const [fullName, setFullName] = useState("");
  const [dialCode, setDialCode] = useState("+95");
  const [phone, setPhone] = useState("");
  const [resumeOption, setResumeOption] = useState<"upload" | "saved">("upload");
  const [savedResumeName] = useState<string | null>(null); // null when no saved resume exists
  const [file, setFile] = useState<File | null>(null);
  const [saveForFuture, setSaveForFuture] = useState(false);
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const currentCountry = getCountryConfig(dialCode);
  const phoneValidation = validatePhoneNumber(phone, dialCode);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow digits and spaces only, capped at the selected country's maxDigits
    const digitsOnly = e.target.value.replace(/[^\d]/g, "").slice(0, currentCountry.maxDigits);
    setPhone(digitsOnly);
  };

  // One place for the PDF/DOCX and 5 MB rules, used by the picker and by drop.
  // One place for the file rules, used by the picker and by drop.
  const acceptFile = (candidate: File | null | undefined) => {
    if (!candidate) return;
    const problem = resumeFileError(candidate);
    setFile(problem ? null : candidate);
    setFileError(problem);
  };

  const portfolioProblem = linkError(portfolioUrl);

  const canContinue =
    fullName.trim().length > 0 &&
    phoneValidation.valid &&
    !portfolioProblem &&
    ((resumeOption === "upload" && file !== null) ||
      (resumeOption === "saved" && Boolean(savedResumeName)));

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="mb-6 text-center text-3xl font-bold text-slate-900">
        Add your resume
      </h1>

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canContinue || !roleId) return;
          // Next: consent, which creates the interview attempt for this role.
          router.push(`/candidate/consent?role=${encodeURIComponent(roleId)}`);
        }}
      >
        {/* Full Name */}
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-900">
            Full name *
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full name"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#7a1c2e] focus:outline-none"
          />
        </div>

        {/* Phone (optional) with Flag + Dial Code Selector */}
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-900">
            Phone (optional)
          </label>
          <div className="flex items-center gap-2">
            <select
              aria-label="Country calling code"
              value={dialCode}
              onChange={(e) => {
                const nextDial = e.target.value;
                const nextConfig = getCountryConfig(nextDial);
                setDialCode(nextDial);
                setPhone((prev) => prev.slice(0, nextConfig.maxDigits));
              }}
              className="min-w-[150px] max-w-[50%] shrink-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-[#7a1c2e] focus:outline-none"
            >
              {COUNTRY_PHONE_CONFIGS.map((country) => (
                <option key={country.iso} value={country.dialCode}>
                  {country.name} ({country.dialCode})
                </option>
              ))}
            </select>

            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={handlePhoneChange}
              placeholder={`${currentCountry.example} (${currentCountry.minDigits === currentCountry.maxDigits ? `${currentCountry.minDigits}` : `${currentCountry.minDigits}-${currentCountry.maxDigits}`} digits)`}
              className="w-full flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#7a1c2e] focus:outline-none"
            />
          </div>

          {!phoneValidation.valid && (
            <p className="mt-1.5 text-xs text-red-600">{phoneValidation.error}</p>
          )}
        </div>

        {/* Resume * */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-slate-900">
            Resume *
          </label>

          {/* Saved Resume Option - stays rendered even if placeholder/saved resume is removed */}
          {savedResumeName !== undefined && (
            <div
              onClick={() => savedResumeName && setResumeOption("saved")}
              className={`rounded-2xl border p-4 transition ${
                resumeOption === "saved"
                  ? "border-[#7a1c2e]"
                  : "border-slate-200"
              } ${!savedResumeName ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            >
              <label className="flex items-center gap-3 text-sm font-medium text-slate-900">
                <input
                  type="radio"
                  name="resumeOption"
                  checked={resumeOption === "saved"}
                  disabled={!savedResumeName}
                  onChange={() => setResumeOption("saved")}
                  className="h-4 w-4 accent-[#7a1c2e]"
                />
                <span>
                  {savedResumeName
                    ? `Use saved resume (${savedResumeName})`
                    : "Use saved resume (none saved yet)"}
                </span>
              </label>
            </div>
          )}

          {/* Upload Resume Option */}
          <div
            onClick={() => setResumeOption("upload")}
            className={`rounded-2xl border p-5 transition ${
              resumeOption === "upload"
                ? "border-[#7a1c2e]"
                : "border-slate-200"
            }`}
          >
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="resumeOption"
                checked={resumeOption === "upload"}
                onChange={() => setResumeOption("upload")}
                className="mt-1 h-4 w-4 accent-[#7a1c2e]"
              />
              <div>
                <div className="text-sm font-medium text-slate-900">
                  Upload a resume
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  PDF or DOCX, one file, max 5 MB. The drop box opens when this is selected.
                </p>
              </div>
            </label>

            {resumeOption === "upload" && (
              <div className="mt-4">
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    acceptFile(e.dataTransfer.files?.[0]);
                  }}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed py-8 text-center hover:bg-slate-50 ${
                    dragging ? "border-[#7a1c2e] bg-rose-50" : "border-slate-300"
                  }`}
                >
                  <span className="rounded-lg bg-rose-100 px-4 py-2 text-sm font-semibold text-[#7a1c2e]">
                    Upload file
                  </span>
                  <span className="mt-2 text-xs text-slate-600">
                    {file ? `${file.name} (${formatFileSize(file.size)})` : "or drag and drop a file here"}
                  </span>
                  <span className="mt-1 text-xs text-slate-500">
                    PDF or DOCX, one file, max 5 MB
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.docx"
                    className="hidden"
                    onChange={(e) => {
                      acceptFile(e.target.files?.[0]);
                      // Allow choosing the same file again after an error.
                      e.target.value = "";
                    }}
                  />
                </label>
                {fileError && <p className="mt-2 text-xs text-red-600">{fileError}</p>}

                <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={saveForFuture}
                    onChange={(e) => setSaveForFuture(e.target.checked)}
                    className="h-4 w-4 rounded-full accent-[#7a1c2e]"
                  />
                  <span>Save this resume for future applications.</span>
                </label>
              </div>
            )}
          </div>
        </div>

        {/* LinkedIn or portfolio link */}
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-900">
            LinkedIn or portfolio link (optional)
          </label>
          <input
            type="url"
            value={portfolioUrl}
            onChange={(e) => setPortfolioUrl(e.target.value)}
            placeholder="https://"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#7a1c2e] focus:outline-none"
          />
          {portfolioProblem && <p className="mt-1.5 text-xs text-red-600">{portfolioProblem}</p>}
        </div>

        {/* Actions */}
        <div className="flex flex-col items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={!canContinue || !roleId}
            className="rounded-xl bg-[#7a1c2e] px-10 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Continue
          </button>
          <Link
            href={roleId ? `/candidate/roles/${encodeURIComponent(roleId)}` : "/candidate/roles"}
            className="text-xs text-slate-600 hover:underline"
          >
            Back to role
          </Link>
          <p className="text-[11px] text-slate-500">Fields marked * are required.</p>
        </div>
      </form>
    </div>
  );
} 