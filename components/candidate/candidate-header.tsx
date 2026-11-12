"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Top bar from the wireframe: "Candidate Interview" left, Help | Log in/out right. */
export function CandidateHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setEmail(session?.user.email ?? null));
    return () => data.subscription.unsubscribe();
  }, [pathname]);

  async function logOut() {
    await createClient().auth.signOut();
    router.push("/auth/login");
  }

  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/candidate/roles" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            D
          </span>
          Candidate Interview
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          {email && <span className="hidden text-muted-foreground sm:inline">{email}</span>}
          {/* shortcut: no help page yet, link it when support has one */}
          <span className="text-muted-foreground" title="Help page coming soon">
            Help
          </span>
          <span className="text-border">|</span>
          {email ? (
            <button className="font-medium text-primary hover:underline" onClick={logOut}>
              Log out
            </button>
          ) : (
            <Link href="/auth/login" className="font-medium text-primary hover:underline">
              Log in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
