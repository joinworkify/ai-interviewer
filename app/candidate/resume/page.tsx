"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useState } from "react";
import { CountrySelect } from "@/components/candidate/country-select";
import { StepGate } from "@/components/candidate/step-gate";
import { createClient } from "@/lib/supabase/client";
import { setupPath } from "@/lib/candidate/steps";
import {
  DEFAULT_DIAL_CODE,
  formatFileSize,
  getCountryConfig,
  linkError,
  phoneInputFromProfile,
  resumeFileError,
  validatePhoneNumber,
} from "@/lib/candidate/resume-form";
import { ProfileSaveError, saveProfile, type ProfileUpdate } from "@/lib/candidate/profile-client";
import {
  deleteResume,
  fetchSavedResumes,
  ResumeUploadError,
  selectResume,
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
  const [resumeOption, setResumeOption] = useState<"upload" | "saved">("upload");
  // Every resume the candidate has saved; the chosen one is used for this application.
  const [resumes, setResumes] = useState<SavedResume[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const edited = React.useRef({ name: false, phone: false, country: false, link: false });
  // Errors show once a field was visited (or Continue was tried), not while the form is still empty.
  const [touched, setTouched] = useState({ name: false, phone: false, link: false });
  const touch = (field: keyof typeof touched) => setTouched((t) => ({ ...t, [field]: true }));

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const supabase = createClient();
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) throw new Error("Not signed in");

        const metadataName = [
          user.user_metadata?.name,
          user.user_metadata?.full_name,
          user.user_metadata?.display_name,
        ].find((value): value is string => typeof value === "string" && value.trim().length > 0);
        if (!edited.current.name && metadataName) {
          setFullName(metadataName.trim());
        }

        const { data: profile, error } = await supabase
          .from("profiles")
          .select("name, phone, linkedin_url, portfolio_url")
          .eq("id", user.id)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;

        if (!edited.current.name) {
          setFullName(profile?.name?.trim() || metadataName?.trim() || "");
        }
        if (!edited.current.phone && !edited.current.country) {
          const savedPhone = phoneInputFromProfile(profile?.phone);
          setDialCode(savedPhone.dialCode);
          setPhone(savedPhone.phone);
        }
        if (!edited.current.link) {
          setPortfolioUrl(profile?.linkedin_url?.trim() || profile?.portfolio_url?.trim() || "");
        }
      } catch {
        if (!cancelled) {
          setProfileLoadError(
            "We couldn't load your saved profile details. You can enter them manually.",
          );
        }
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  // Resumes uploaded earlier can be reused; the one in use comes first and is picked by default.
  useEffect(() => {
    let cancelled = false;
    void fetchSavedResumes().then((saved) => {
      if (cancelled || saved.length === 0) return;
      setResumes(saved);
      setSelectedId(saved[0].id);
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
    const digitsOnly = e.target.value.replace(/[^\d]/g, "").slice(0, currentCountry.maxDigits);
    edited.current.phone = true;
    setPhone(digitsOnly);
  };

  // Checks the PDF/DOCX and 5 MB rules, then uploads straight away: the new
  // resume joins the saved list and is selected. Used by the picker and by drop.
  const acceptFile = async (candidate: File | null | undefined) => {
    if (!candidate || uploading) return;
    const problem = resumeFileError(candidate);
    setFileError(problem);
    if (problem) return;
    setUploading(true);
    try {
      const saved = await uploadResume(candidate);
      setResumes((list) => [saved, ...list.filter((r) => r.id !== saved.id)]);
      setSelectedId(saved.id);
      setResumeOption("saved");
    } catch (err) {
      setFileError(
        err instanceof ResumeUploadError
          ? err.message
          : "Could not upload the resume. Please try again.",
      );
    } finally {
      setUploading(false);
    }
  };

  const removeResume = async (resume: SavedResume) => {
    if (!window.confirm(`Delete "${resume.fileName}"? This cannot be undone.`)) return;
    setDeletingId(resume.id);
    setFileError(null);
    try {
      await deleteResume(resume.id);
      const rest = resumes.filter((r) => r.id !== resume.id);
      setResumes(rest);
      if (selectedId === resume.id) setSelectedId(rest[0]?.id ?? null);
      if (rest.length === 0) setResumeOption("upload");
    } catch (err) {
      setFileError(
        err instanceof ResumeUploadError
          ? err.message
          : "Could not delete the resume. Please try again.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  const portfolioProblem = linkError(portfolioUrl);

  // The resume is optional: an upload with no file chosen just skips it.
  const nameProblem = fullName.trim().length === 0 ? "Enter your full name." : null;
  const fieldClass = (invalid: boolean) =>
    `w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none ${
      invalid
        ? "border-destructive focus:border-destructive"
        : "border-input focus:border-ring focus:ring-2 focus:ring-ring/20"
    }`;
  const canContinue =
    !submitting &&
    !uploading &&
    !profileLoading &&
    !nameProblem &&
    phoneValidation.valid &&
    !portfolioProblem;

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-8 shadow-sm">
      <h1 className="mb-6 text-center text-3xl font-bold text-foreground">Add your resume</h1>
      <p className="-mt-3 mb-6 text-center text-sm text-muted-foreground">
        This step is optional. You can skip it and continue to consent.
      </p>
      {profileLoading && (
        <p role="status" className="-mt-3 text-center text-sm text-slate-500">
          Loading your saved details...
        </p>
      )}
      {profileLoadError && (
        <p role="alert" className="-mt-3 text-center text-sm text-red-600">
          {profileLoadError}
        </p>
      )}

      <form
        aria-busy={profileLoading}
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
            if (portfolioUrl.trim()) {
              const hostname = new URL(portfolioUrl).hostname.toLowerCase();
              if (hostname === "linkedin.com" || hostname.endsWith(".linkedin.com")) {
                details.linkedinUrl = portfolioUrl;
              } else {
                details.portfolioUrl = portfolioUrl;
              }
            }
            await saveProfile(details);
            // The chosen saved resume is the one this application uses.
            if (resumeOption === "saved" && selectedId) await selectResume(selectedId);
          } catch (err) {
            setSubmitError(
              err instanceof ProfileSaveError || err instanceof ResumeUploadError
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
          <label className="mb-2 block text-sm font-medium text-foreground">Full name *</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => {
              edited.current.name = true;
              setFullName(e.target.value);
            }}
            onBlur={() => touch("name")}
            aria-invalid={touched.name && !!nameProblem}
            placeholder="Full name"
            className={fieldClass(touched.name && !!nameProblem)}
          />
          {touched.name && nameProblem && (
            <p role="alert" className="mt-1.5 text-xs text-destructive">
              {nameProblem}
            </p>
          )}
        </div>

        {/* Phone (optional) with Flag + Dial Code Selector */}
        <div>
          <label className="mb-2 block text-sm font-medium text-foreground">Phone (optional)</label>
          <div className="flex items-center gap-2">
            <CountrySelect
              value={dialCode}
              onChange={(nextDial) => {
                edited.current.country = true;
                edited.current.phone = true;
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
            <p role="alert" className="mt-1.5 text-xs text-destructive">
              {phoneValidation.error}
            </p>
          )}
        </div>

        {/* Resume (optional) */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-foreground">Resume (optional)</label>

          {/* Saved resumes: one row each, pick one or delete it */}
          {resumes.length === 0 ? (
            <div className="cursor-not-allowed rounded-2xl border border-border p-4 opacity-60">
              <label className="flex items-center gap-3 text-sm font-medium text-foreground">
                <input
                  type="radio"
                  name="resumeOption"
                  disabled
                  className="h-4 w-4 accent-primary"
                />
                <span>Use saved resume (none saved yet)</span>
              </label>
            </div>
          ) : (
            resumes.map((resume) => {
              const chosen = resumeOption === "saved" && selectedId === resume.id;
              return (
                <div
                  key={resume.id}
                  onClick={() => {
                    setSelectedId(resume.id);
                    setResumeOption("saved");
                  }}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-2xl border p-4 transition ${
                    chosen ? "border-primary" : "border-border"
                  }`}
                >
                  <label className="flex min-w-0 cursor-pointer items-center gap-3 text-sm font-medium text-foreground">
                    <input
                      type="radio"
                      name="resumeOption"
                      checked={chosen}
                      onChange={() => {
                        setSelectedId(resume.id);
                        setResumeOption("saved");
                      }}
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                    <span className="truncate">Use saved resume ({resume.fileName})</span>
                    <span className="shrink-0 text-xs font-normal text-muted-foreground">
                      {formatFileSize(resume.size)}
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={deletingId !== null}
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeResume(resume);
                    }}
                    aria-label={`Delete ${resume.fileName}`}
                    className="shrink-0 rounded-lg border border-destructive/30 bg-background px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    {deletingId === resume.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              );
            })
          )}

          {/* Upload Resume Option */}
          <div
            onClick={() => setResumeOption("upload")}
            className={`rounded-2xl border p-5 transition ${
              resumeOption === "upload" ? "border-primary" : "border-border"
            }`}
          >
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="resumeOption"
                checked={resumeOption === "upload"}
                onChange={() => setResumeOption("upload")}
                className="mt-1 h-4 w-4 accent-primary"
              />
              <div>
                <div className="text-sm font-medium text-foreground">Upload a resume</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  PDF or DOCX, one file, max 5 MB. It is saved to your profile as soon as it
                  uploads.
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
                    void acceptFile(e.dataTransfer.files?.[0]);
                  }}
                  aria-busy={uploading}
                  className={`flex flex-col items-center justify-center rounded-xl border border-dashed py-8 text-center ${
                    uploading ? "cursor-wait opacity-70" : "cursor-pointer hover:bg-muted/50"
                  } ${dragging ? "border-primary bg-primary/5" : "border-input"}`}
                >
                  <span className="rounded-lg bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
                    {uploading ? "Uploading..." : "Upload file"}
                  </span>
                  <span className="mt-2 text-xs text-muted-foreground">
                    or drag and drop a file here
                  </span>
                  <span className="mt-1 text-xs text-muted-foreground">
                    PDF or DOCX, one file, max 5 MB
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.docx"
                    disabled={uploading}
                    className="hidden"
                    onChange={(e) => {
                      void acceptFile(e.target.files?.[0]);
                      // Allow choosing the same file again after an error.
                      e.target.value = "";
                    }}
                  />
                </label>
                {fileError && <p className="mt-2 text-xs text-destructive">{fileError}</p>}

                <p className="mt-4 text-xs text-muted-foreground">
                  Your resume is kept on your profile and can be reused for future applications.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* LinkedIn or portfolio link */}
        <div>
          <label className="mb-2 block text-sm font-medium text-foreground">
            LinkedIn or portfolio link (optional)
          </label>
          <input
            type="url"
            value={portfolioUrl}
            onChange={(e) => {
              edited.current.link = true;
              setPortfolioUrl(e.target.value);
            }}
            onBlur={() => touch("link")}
            aria-invalid={touched.link && !!portfolioProblem}
            placeholder="https://"
            className={fieldClass(touched.link && !!portfolioProblem)}
          />
          {touched.link && portfolioProblem && (
            <p role="alert" className="mt-1.5 text-xs text-destructive">
              {portfolioProblem}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col items-center gap-3 pt-2">
          <button
            type="submit"
            // Not disabled for invalid input: clicking it reveals what to fix.
            disabled={submitting || profileLoading || !roleId}
            className="rounded-xl bg-primary px-10 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? "Uploading..." : "Continue"}
          </button>
          <button
            type="button"
            disabled={submitting || !roleId}
            onClick={() => router.push(nextStep())}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
          >
            Skip this step
          </button>
          {submitError && (
            <p role="alert" className="text-xs text-destructive">
              {submitError}
            </p>
          )}
          <Link
            href={roleId ? `/candidate/roles/${encodeURIComponent(roleId)}` : "/candidate/roles"}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Back to role
          </Link>
          <p className="text-[11px] text-muted-foreground">
            Fields marked * are required to save your details.
          </p>
        </div>
      </form>
    </div>
  );
}
