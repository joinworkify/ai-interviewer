"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getRole, isValidEmail, type Role } from "@/lib/candidate/api";

export default function RoleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [role, setRole] = useState<Role | null>(null);
  const [applied, setApplied] = useState(false);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRole(id).then(setRole, (e: Error) => setError(e.message));
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
  if (!role) return <div className="h-64 animate-pulse rounded-lg bg-muted" aria-busy="true" />;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <article className="flex flex-col gap-5">
        <Link href="/candidate/roles" className="text-sm text-muted-foreground hover:underline">
          ← All roles
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">{role.title}</h1>
          <p className="text-sm text-muted-foreground">Pay rate: {role.payRate}</p>
          <p className="text-sm text-muted-foreground">Job type: {role.jobType}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {role.skills.map((s) => (
            <Badge key={s} variant="outline">
              {s}
            </Badge>
          ))}
        </div>
        <section>
          <h2 className="mb-2 font-semibold">About the role</h2>
          <p className="text-sm">{role.about}</p>
        </section>
        <Section title="Key Responsibilities" items={role.responsibilities} />
        <Section title="Required Skills & Qualifications" items={role.requirements} />
      </article>

      <aside className="h-fit rounded-lg border p-5 lg:sticky lg:top-6">
        <h2 className="mb-3 font-semibold">Apply now</h2>
        {applied ? (
          <p role="status" className="rounded-md bg-muted p-3 text-sm">
            Application received. We&apos;ll guide you to the next step.
          </p>
        ) : (
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
                By clicking any of the &quot;Confirm&quot; buttons below, you acknowledge and agree to our Terms
                and Privacy Policy for candidates.
              </p>
            </div>
            {/* shortcut: the consent screen is a teammate's part, link it here once it exists */}
            <Button
              className="w-full bg-green-600 text-white hover:bg-green-700"
              disabled={!isValidEmail(email)}
              onClick={() => setApplied(true)}
            >
              Confirm
            </Button>
            <p className="text-center text-xs text-muted-foreground">Or</p>
            {/* shortcut: social sign-in is UI only, wire it to the real auth provider later */}
            <Button variant="outline" className="w-full" onClick={() => setNotice("Coming soon")}>
              Continue with Google
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setNotice("Coming soon")}>
              Continue with LinkedIn
            </Button>
            {notice && (
              <p role="status" className="text-center text-xs text-muted-foreground">
                {notice}
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function Section({ title, items }: { title: string; items: { title: string; text: string }[] }) {
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
