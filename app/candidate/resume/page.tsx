"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useState } from "react";
import { CountrySelect } from "@/components/candidate/country-select";
import { StepGate } from "@/components/candidate/step-gate";
import { setupPath } from "@/lib/candidate/steps";
import {
  DEFAULT_DIAL_CODE,
  formatFileSize,
  getCountryConfig,
  linkError,
  resumeFileError,
  validatePhoneNumber,
} from "@/lib/candidate/resume-form";
import {
  ProfileSaveError,
  saveProfile,
  type ProfileUpdate,
} from "@/lib/candidate/profile-client";
import {
  fetchSavedResume,
  ResumeUploadError,
  uploadResume,
  type SavedResume,
} from "@/lib/candidate/resume-client";

export default function CandidateResumePage() {
  return (
    <StepGate step="resume">
      <ResumeStep />
    </StepGate>
  );
}

function ResumeStep() {
  const router = useRouter();
  const params = useSearchParams();
  const roleId = params.get("role") ?? "";
  // Set when the candidate came back after consenting: carry on with that
  // attempt instead of going through consent (which would start another).
  const openAttempt = params.get("attempt");
  const nextStep = () =>
    openAttempt
      ? setupPath(openAttempt, roleId)
      : `/candidate/consent?role=${encodeURIComponent(roleId)}`;
  const [fullName, setFullName] = useState("");
  const [dialCode, setDialCode] = useState(DEFAULT_DIAL_CODE);
  const [phone, setPhone] = useState("");
  const [resumeOption, setResumeOption] = useState<"upload" | "saved">(
    "upload",
  );
  const [savedResume, setSavedResume] = useState<SavedResume | null>(null);
  const savedResumeName = savedResume?.fileName ?? null;
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  // Errors show once a field was visited (or Continue was tried), not while the form is still empty.
  const [touched, setTouched] = useState({ name: false, phone: false, link: false });
  const touch = (field: keyof typeof touched) =>
    setTouched((t) => ({ ...t, [field]: true }));

  // A resume uploaded earlier can be reused; pick it by default when there is one.
  useEffect(() => {
    let cancelled = false;
    void fetchSavedResume().then((resume) => {
      if (cancelled || !resume) return;
      setSavedResume(resume);
      setResumeOption("saved");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentCountry = getCountryConfig(dialCode);
  const phoneValidation = validatePhoneNumber(phone, dialCode);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow digits and spaces only, capped at the selected country's maxDigits
    const digitsOnly = e.target.value
      .replace(/[^\d]/g, "")
      .slice(0, currentCountry.maxDigits);
    setPhone(digitsOnly);
  };

  // One place for the PDF/DOCX and 5 MB rules, used by the picker and by drop.
  const acceptFile = (candidate: File | null | undefined) => {
    if (!candidate) return;
    const problem = resumeFileError(candidate);
    setFile(problem ? null : candidate);
    setFileError(problem);
  };

  const portfolioProblem = linkError(portfolioUrl);

  // The resume is optional: an upload with no file chosen just skips it.
  const nameProblem = fullName.trim().length === 0 ? "Enter your full name." : null;
  const fieldClass = (invalid: boolean) =>
    `w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none ${
      invalid
        ? "border-red-500 focus:border-red-500"
        : "border-slate-300 focus:border-[#7a1c2e]"
    }`;
  const canContinue =
    !submitting &&
    !nameProblem &&
    phoneValidation.valid &&
    !portfolioProblem;

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="mb-6 text-center text-3xl font-bold text-slate-900">
        Add your resume
      </h1>
      <p className="-mt-3 mb-6 text-center text-sm text-slate-600">
        This step is optional. You can skip it and continue to consent.
      </p>

      <form
        className="space-y-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setTouched({ name: true, phone: true, link: true });
          if (!canContinue || !roleId) return;
          setSubmitError(null);
          setSubmitting(true);
          try {
            // Only what was filled in: this page never clears details that are
            // already on the profile (the profile page does that).
            const details: ProfileUpdate = { name: fullName };
            if (phone) details.phone = `${dialCode}${phone}`;
            if (portfolioUrl.trim()) details.portfolioUrl = portfolioUrl;
            await saveProfile(details);
            if (resumeOption === "upload" && file) await uploadResume(file);
          } catch (err) {
            setSubmitError(
              err instanceof ProfileSaveError ||
                err instanceof ResumeUploadError
                ? err.message
                : "Something went wrong. Please try again.",
            );
            setSubmitting(false);
            return;
          }
          // Next: consent, which creates the interview attempt for this role
          // (or straight back to the mic check when one is already open).
          router.push(nextStep());
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
            onBlur={() => touch("name")}
            aria-invalid={touched.name && !!nameProblem}
            placeholder="Full name"
            className={fieldClass(touched.name && !!nameProblem)}
          />
          {touched.name && nameProblem && (
            <p role="alert" className="mt-1.5 text-xs text-red-600">
              {nameProblem}
            </p>
          )}
        </div>

        {/* Phone (optional) with Flag + Dial Code Selector */}
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-900">
            Phone (optional)
          </label>
          <div className="flex items-center gap-2">
            <CountrySelect
              value={dialCode}
              onChange={(nextDial) => {
                const nextConfig = getCountryConfig(nextDial);
                setDialCode(nextDial);
                setPhone((prev) => prev.slice(0, nextConfig.maxDigits));
              }}
            />

            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={handlePhoneChange}
              onBlur={() => touch("phone")}
              aria-invalid={touched.phone && !phoneValidation.valid}
              placeholder={`${currentCountry.example} (${currentCountry.minDigits === currentCountry.maxDigits ? `${currentCountry.minDigits}` : `${currentCountry.minDigits}-${currentCountry.maxDigits}`} digits)`}
              className={`${fieldClass(touched.phone && !phoneValidation.valid)} flex-1`}
            />
          </div>

          {touched.phone && !phoneValidation.valid && (
            <p role="alert" className="mt-1.5 text-xs text-red-600">
              {phoneValidation.error}
            </p>
          )}
        </div>

        {/* Resume (optional) */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-slate-900">
            Resume (optional)
          </label>

          {/* Saved resume option: always shown, disabled until one exists */}
          <div
            onClick={() => savedResumeName && setResumeOption("saved")}
            className={`rounded-2xl border p-4 transition ${
              resumeOption === "saved" ? "border-[#7a1c2e]" : "border-slate-200"
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
                  PDF or DOCX, one file, max 5 MB. The drop box opens when this
                  is selected.
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
                    dragging
                      ? "border-[#7a1c2e] bg-rose-50"
                      : "border-slate-300"
                  }`}
                >
                  <span className="rounded-lg bg-rose-100 px-4 py-2 text-sm font-semibold text-[#7a1c2e]">
                    Upload file
                  </span>
                  <span className="mt-2 text-xs text-slate-600">
                    {file
                      ? `${file.name} (${formatFileSize(file.size)})`
                      : "or drag and drop a file here"}
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
                {fileError && (
                  <p className="mt-2 text-xs text-red-600">{fileError}</p>
                )}

                <p className="mt-4 text-xs text-slate-600">
                  Your resume is kept on your profile and can be reused for
                  future applications.
                </p>
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
            onBlur={() => touch("link")}
            aria-invalid={touched.link && !!portfolioProblem}
            placeholder="https://"
            className={fieldClass(touched.link && !!portfolioProblem)}
          />
          {touched.link && portfolioProblem && (
            <p role="alert" className="mt-1.5 text-xs text-red-600">{portfolioProblem}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col items-center gap-3 pt-2">
          <button
            type="submit"
            // Not disabled for invalid input: clicking it reveals what to fix.
            disabled={submitting || !roleId}
            className="rounded-xl bg-[#7a1c2e] px-10 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Uploading..." : "Continue"}
          </button>
          <button
            type="button"
            disabled={submitting || !roleId}
            onClick={() => router.push(nextStep())}
            className="text-xs text-slate-500 hover:text-slate-700 hover:underline disabled:opacity-50"
          >
            Skip this step
          </button>
          {submitError && (
            <p role="alert" className="text-xs text-red-600">
              {submitError}
            </p>
          )}
          <Link
            href={
              roleId
                ? `/candidate/roles/${encodeURIComponent(roleId)}`
                : "/candidate/roles"
            }
            className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
          >
            Back to role
          </Link>
          <p className="text-[11px] text-slate-500">
            Fields marked * are required to save your details.
          </p>
        </div>
      </form>
    </div>
  );
}
