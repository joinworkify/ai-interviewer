
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function CandidateHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });

    const { data } = supabase.auth.onAuthStateChange(
      (_event, session) => setEmail(session?.user.email ?? null)
    );

    return () => data.subscription.unsubscribe();
  }, [pathname]);

  async function logOut() {
    await createClient().auth.signOut();
    router.push("/auth/login");
  }

  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/candidate/roles" className="font-semibold tracking-tight">
          Candidate Interview
        </Link>

        <nav className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Help</span>

          {email && (
            <button
              className="font-medium text-primary hover:underline"
              onClick={logOut}
            >
              Log out
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
