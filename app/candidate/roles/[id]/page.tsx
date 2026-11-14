"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getRole, isValidEmail, type Role } from "@/lib/candidate/api";
import { createClient } from "@/lib/supabase/client";

export default function RoleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [role, setRole] = useState<Role | null>(null);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRole(id).then(setRole, (e: Error) => setError(e.message));
    // Prefill with the signed-in candidate's email.
    createClient()
      .auth.getUser()
      .then(({ data }) =>
        setEmail((current) => current || data.user?.email || ""),
      );
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
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <article className="flex flex-col gap-5">
        <Link
          href="/candidate/roles"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All roles
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{role.title}</h1>
          <p className="text-sm text-muted-foreground">
            Pay rate: {role.payRate}
          </p>
          {role.jobType && (
            <p className="text-sm text-muted-foreground">
              Job type: {role.jobType}
            </p>
          )}
        </div>
        {role.skills.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {role.skills.map((s) => (
              <Badge key={s} variant="outline">
                {s}
              </Badge>
            ))}
          </div>
        )}
        {role.about && (
          <section>
            <h2 className="mb-2 font-semibold">About the role</h2>
            <p className="text-sm">{role.about}</p>
          </section>
        )}
        <Section title="Key Responsibilities" items={role.responsibilities} />
        <Section
          title="Required Skills & Qualifications"
          items={role.requirements}
        />
      </article>

      <aside className="h-fit rounded-xl border bg-card p-5 shadow-sm lg:sticky lg:top-6">
        <h2 className="mb-3 font-semibold">Apply now</h2>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="apply-email">Email</Label>
            <Input
              id="apply-email"
              type="email"
              autoComplete="email"
              placeholder="Enter your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
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
        </div>
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
      <h2 className="mb-2 font-semibold">{title}</h2>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
        {items.map((i) => (
          <li key={i.title}>
            <span className="font-medium">{i.title}:</span> {i.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
