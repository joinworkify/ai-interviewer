"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getRole, type Role } from "@/lib/candidate/api";
import { formatPayRate } from "@/lib/candidate/pay";
import { APPLICATION_STEPS, applyHref } from "@/lib/candidate/steps";
import { createClient } from "@/lib/supabase/client";

export default function RoleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [role, setRole] = useState<Role | null>(null);
  const router = useRouter();
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState("");

  useEffect(() => {
    getRole(id).then(setRole, (e: Error) => setError(e.message));
  }, [id]);

  // This page is public: signed-out visitors log in first, then land on the resume step.
  const apply = async () => {
    if (!role) return;
    setApplying(true);
    setApplyError(null);
    try {
      const { data } = await createClient().auth.getUser();
      router.push(applyHref(role.id, Boolean(data.user)));
    } catch {
      setApplyError("Unable to open the application. Please try again.");
    } finally {
      setApplying(false);
    }
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareStatus("Link copied!");
    } catch {
      setShareStatus("Unable to copy link.");
    }

    setTimeout(() => {
      setShareStatus("");
    }, 2000);
  };

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
            Pay rate: {formatPayRate(role)}
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

        <div className="flex justify-end border-t pt-4">
          <div className="flex flex-col items-end gap-1">
            <Button variant="outline" onClick={handleShare}>
              <Share2 className="mr-2 h-4 w-4" />
              Share
            </Button>

            {shareStatus && (
              <span role="status" className="text-xs text-muted-foreground">
                {shareStatus}
              </span>
            )}
          </div>
        </div></article>

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
        {applyError && <p role="alert" className="mb-3 text-sm text-destructive">{applyError}</p>}
        <Button className="w-full" size="lg" disabled={applying} onClick={apply}>
          {applying ? "Opening..." : "Apply"}
        </Button>
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
