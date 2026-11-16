"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SocialAuthButtons } from "@/components/social-auth-buttons";
import { getRole, isValidEmail, type Role } from "@/lib/candidate/api";
import { APPLICATION_STEPS } from "@/lib/candidate/steps";
import { createClient } from "@/lib/supabase/client";

export default function RoleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [role, setRole] = useState<Role | null>(null);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  // null until we know; avoids flashing the sign-in form at signed-in users.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRole(id).then(setRole, (e: Error) => setError(e.message));
    // Prefill with the signed-in candidate's email.
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        setSignedIn(Boolean(data.user));
        setEmail((current) => current || data.user?.email || "");
      });
  }, [id]);

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 text-sm">
        <p className="text-destructive">{error}</p>
        <Link href="/candidate/roles" className="underline">
          Back to roles
        </Link>
      </div>
    );
  }
  if (!role)
    return (
      <div
        className="h-64 animate-pulse rounded-lg bg-muted"
        aria-busy="true"
      />
    );

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_340px] lg:gap-14">
      <article className="flex flex-col gap-8">
        <Link
          href="/candidate/roles"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All roles
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{role.title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Pay rate: {role.payRate}
          </p>
          {role.jobType && (
            <p className="text-sm text-muted-foreground">
              Job type: {role.jobType}
            </p>
          )}
        </div>
        {role.skills.length > 0 && (
          <div className="flex flex-wrap gap-2.5">
            {role.skills.map((s) => (
              <Badge key={s} variant="outline">
                {s}
              </Badge>
            ))}
          </div>
        )}
        {role.about && (
          <section>
            <h2 className="mb-3 text-lg font-semibold">About the role</h2>
            <p className="text-[15px] leading-7">{role.about}</p>
          </section>
        )}
        <Section title="Key Responsibilities" items={role.responsibilities} />
        <Section
          title="Required Skills & Qualifications"
          items={role.requirements}
        />
      </article>

      <aside className="h-fit rounded-xl border bg-card p-6 shadow-sm lg:sticky lg:top-6">
        <section aria-labelledby="how-it-works" className="mb-6 border-b pb-6">
          <h2 id="how-it-works" className="mb-4 font-semibold">
            How applying works
          </h2>
          <ol className="flex flex-col gap-5">
            {APPLICATION_STEPS.map((step, i) => (
              <li key={step.id} className="flex gap-3.5 text-sm">
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary text-xs font-semibold text-primary"
                >
                  {i + 1}
                </span>
                <span>
                  <span className="font-medium">{step.label}</span>
                  <span className="mt-0.5 block leading-6 text-muted-foreground">{step.description}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <h2 className="mb-4 font-semibold">Apply now</h2>
        {signedIn === null ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" aria-busy="true" />
        ) : signedIn ? (
          <div className="flex flex-col gap-4">
            {email && (
              <p className="text-sm text-muted-foreground">
                Applying as <span className="font-medium text-foreground">{email}</span>
              </p>
            )}
            <Button
              className="w-full"
              onClick={() => router.push(`/candidate/resume?role=${role.id}`)}
            >
              Continue
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="apply-email">Email</Label>
              <Input
                id="apply-email"
                type="email"
                autoComplete="email"
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                aria-invalid={emailTouched && !isValidEmail(email)}
                aria-describedby={emailTouched && !isValidEmail(email) ? "apply-email-error" : undefined}
                className={emailTouched && !isValidEmail(email) ? "border-destructive focus-visible:ring-destructive" : undefined}
              />
              {emailTouched && !isValidEmail(email) && (
                <p id="apply-email-error" role="alert" className="text-xs text-destructive">
                  {email.trim() ? "Enter a valid email address." : "Enter your email address."}
                </p>
              )}
              <p className="text-xs leading-5 text-muted-foreground">
                By clicking any of the &quot;Confirm&quot; buttons below, you
                acknowledge and agree to our Terms and Privacy Policy for
                candidates.
              </p>
            </div>
            <Button
              className="w-full"
              disabled={!isValidEmail(email)}
              onClick={() => router.push(`/candidate/resume?role=${role.id}`)}
            >
              Confirm
            </Button>
            <p className="text-center text-xs text-muted-foreground">Or</p>
            <SocialAuthButtons
              next={`/candidate/resume?role=${encodeURIComponent(role.id)}`}
            />
          </div>
        )}
      </aside>
    </div>
  );
}

function Section({
  title,
  items,
}: {
  title: string;
  items: { title: string; text: string }[];
}) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      <ul className="flex list-disc flex-col gap-4 pl-5 text-[15px] leading-7 marker:text-muted-foreground">
        {items.map((i) => (
          <li key={i.title} className="pl-1">
            <span className="font-medium">{i.title}:</span>{" "}
            <span className="text-foreground/80">{i.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
