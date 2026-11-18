
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ProfileSaveError, saveProfile } from "@/lib/candidate/profile-client";

type Props = {
  initialProfile: {
    name: string;
    email: string;
    phone: string;
    linkedinUrl: string;
    portfolioUrl: string;
  };
};

export function ResumeProfileForm({ initialProfile }: Props) {
  const [name, setName] = useState(initialProfile.name);
  const [phone, setPhone] = useState(initialProfile.phone);
  const [linkedinUrl, setLinkedinUrl] = useState(initialProfile.linkedinUrl);
  const [portfolioUrl, setPortfolioUrl] = useState(initialProfile.portfolioUrl);

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  useEffect(() => {
    if (!message) return;

    const timeout = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(timeout);
  }, [message]);

  function handlePhotoChange(file: File | undefined) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setErrorMessage("Please select an image file.");
      return;
    }

    setErrorMessage("");
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSaving(true);
    setMessage("");
    setErrorMessage("");

    try {
      await saveProfile({
        name,
        phone,
        linkedinUrl,
        portfolioUrl,
      });
    } catch (err) {
      setIsSaving(false);
      setErrorMessage(
        err instanceof ProfileSaveError
          ? err.message
          : "Could not save your profile.",
      );
      return;
    }

    setIsSaving(false);
    setMessage("Profile saved successfully.");
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <Link
          href="/candidate/roles"
          className="text-sm font-medium text-primary hover:text-primary/80"
        >
          ← Back to Roles
        </Link>

        <h1 className="mt-4 text-2xl font-bold text-foreground">
          Profile Detail
        </h1>

        <p className="mt-1 text-sm text-muted-foreground">
          Manage your personal information.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">
            Profile Photo
          </h2>

          <div className="mt-5 flex items-center gap-5">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-muted">
              {photoPreview ? (
                <img
                  src={photoPreview}
                  alt="Profile preview"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-2xl font-semibold text-muted-foreground">
                  {name.charAt(0).toUpperCase() || "?"}
                </span>
              )}
            </div>

            <div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) =>
                  handlePhotoChange(event.target.files?.[0])
                }
              />

              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
              >
                Choose Photo
              </button>

              <p className="mt-2 text-xs text-muted-foreground">
                Image preview only. Photo is not uploaded or stored yet.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">
            Personal Information
          </h2>

          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="name"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Full Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Enter your full name"
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
            </div>

            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={initialProfile.email}
                disabled
                className="w-full rounded-lg border border-input bg-muted px-3 py-2.5 text-sm text-muted-foreground"
              />
            </div>

            <div>
              <label
                htmlFor="phone"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Phone Number
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Enter your phone number"
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
            </div>

            <div>
              <label
                htmlFor="linkedin"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                LinkedIn URL
              </label>
              <input
                id="linkedin"
                type="url"
                value={linkedinUrl}
                onChange={(event) => setLinkedinUrl(event.target.value)}
                placeholder="https://linkedin.com/in/yourname"
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="portfolio"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Portfolio URL
              </label>
              <input
                id="portfolio"
                type="url"
                value={portfolioUrl}
                onChange={(event) => setPortfolioUrl(event.target.value)}
                placeholder="https://yourportfolio.com"
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
            </div>
          </div>
        </section>

        {message && (
          <p role="status" className="text-sm text-green-600">
            {message}
          </p>
        )}

        {errorMessage && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </form>
    </div>
  );
}
