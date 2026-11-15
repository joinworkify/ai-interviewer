"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Props = {
  userId: string;
  initialProfile: {
    name: string;
    email: string;
    phone: string;
    linkedinUrl: string;
    portfolioUrl: string;
  };
};

export function ResumeProfileForm({ userId, initialProfile }: Props) {
  const supabase = createClient();

  const [name, setName] = useState(initialProfile.name);
  const [phone, setPhone] = useState(initialProfile.phone);
  const [linkedinUrl, setLinkedinUrl] = useState(initialProfile.linkedinUrl);
  const [portfolioUrl, setPortfolioUrl] = useState(initialProfile.portfolioUrl);

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [resumeFileName, setResumeFileName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const photoInputRef = useRef<HTMLInputElement>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  function handlePhotoChange(file: File | undefined) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setErrorMessage("Please select an image file.");
      return;
    }

    setErrorMessage("");
    setPhotoPreview(URL.createObjectURL(file));
  }

  function handleResumeChange(file: File | undefined) {
    if (!file) return;

    const allowedExtensions = [".pdf", ".doc", ".docx"];
    const extension = file.name.toLowerCase().slice(file.name.lastIndexOf("."));

    if (!allowedExtensions.includes(extension)) {
      setErrorMessage("Please select a PDF, DOC, or DOCX file.");
      return;
    }

    setErrorMessage("");
    setResumeFileName(file.name);
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSaving(true);
    setMessage("");
    setErrorMessage("");

    const { error } = await supabase
      .from("profiles")
      .update({
        name: name.trim(),
        phone: phone.trim() || null,
        linkedin_url: linkedinUrl.trim() || null,
        portfolio_url: portfolioUrl.trim() || null,
      })
      .eq("id", userId);

    setIsSaving(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMessage("Profile saved successfully.");
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <Link
          href="/candidate/roles"
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          ← Back to Dashboard
        </Link>

        <h1 className="mt-4 text-2xl font-bold text-gray-900">
          Profile Detail
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your personal information and resume.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">
            Profile Information
          </h2>

          <div className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-gray-100">
              {photoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoPreview}
                  alt="Profile preview"
                  className="h-full w-full object-cover"
                />
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-12 w-12 text-gray-400"
                >
                  <path
                    fillRule="evenodd"
                    d="M12 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM4 21a8 8 0 1 1 16 0H4Z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>

            <div>
              <p className="font-medium text-gray-900">Profile Picture</p>
              <p className="mt-1 text-sm text-gray-500">
                Choose an image from your device.
              </p>

              <input
                ref={photoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) =>
                  handlePhotoChange(event.target.files?.[0])
                }
              />

              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="mt-3 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Choose Picture
              </button>
            </div>
          </div>

          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="name"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Full Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={initialProfile.email}
                readOnly
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500"
              />
            </div>

            <div>
              <label
                htmlFor="phone"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Phone Number
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Enter your phone number"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label
                htmlFor="linkedin"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                LinkedIn URL
              </label>
              <input
                id="linkedin"
                type="url"
                value={linkedinUrl}
                onChange={(event) => setLinkedinUrl(event.target.value)}
                placeholder="https://linkedin.com/in/yourname"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="portfolio"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Portfolio URL
              </label>
              <input
                id="portfolio"
                type="url"
                value={portfolioUrl}
                onChange={(event) => setPortfolioUrl(event.target.value)}
                placeholder="https://yourportfolio.com"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">My Resume</h2>
          <p className="mt-1 text-sm text-gray-500">
            Select your resume in PDF, DOC, or DOCX format.
          </p>

          <div className="mt-5 rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
            <input
              ref={resumeInputRef}
              type="file"
              accept=".pdf,.doc,.docx"
              className="hidden"
              onChange={(event) =>
                handleResumeChange(event.target.files?.[0])
              }
            />

            <p className="font-medium text-gray-800">
              {resumeFileName || "Choose your resume file"}
            </p>

            <button
              type="button"
              onClick={() => resumeInputRef.current?.click()}
              className="mt-4 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Upload File
            </button>

            <p className="mt-3 text-xs text-gray-500">
              PDF, DOC, or DOCX files
            </p>
          </div>

          <p className="mt-3 text-xs text-gray-500">
            File selection only. The picture and resume are not uploaded or
            stored yet.
          </p>
        </section>

        {message && (
          <p role="status" className="text-sm text-green-600">
            {message}
          </p>
        )}

        {errorMessage && (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </form>
    </div>
  );
}