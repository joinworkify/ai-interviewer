"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/brand/logo-mark";
import { PROFILE_UPDATED_EVENT } from "@/lib/candidate/profile-client";
import { createClient } from "@/lib/supabase/client";

export function CandidateHeader() {
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setEmail(user?.email ?? null);

      if (!user) {
        setName(null);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", user.id)
        .maybeSingle();

      setName(
        profile?.name?.trim() || user.user_metadata?.name?.trim() || null,
      );
    }

    void loadProfile();

    // The profile form saves without changing the page, so it tells the header
    // to show the new name instead of waiting for the next navigation.
    window.addEventListener(PROFILE_UPDATED_EVENT, loadProfile);

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);

      if (!session) {
        setName(null);
      }
    });

    return () => {
      window.removeEventListener(PROFILE_UPDATED_EVENT, loadProfile);
      data.subscription.unsubscribe();
    };
  }, [pathname]);

  async function logOut() {
    await createClient().auth.signOut();
    // Full reload: Cache Components preserves client state across router.push,
    // so the login page would otherwise restore the previous session's form.
    window.location.href = "/auth/login";
  }

  return (
    <header className="border-b bg-white">
      <div className="mx-auto grid max-w-6xl grid-cols-3 items-center gap-2 px-4 py-3">
        {/* Left: Logo */}
        <Link
          href="/candidate/roles"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <LogoMark size={32} />
          <span className="hidden sm:inline">Candidate Interview</span>
        </Link>

        {/* Center: Application Status */}
        <div className="flex justify-center">
          {email && (
            <Link
              href="/candidate/applications"
              className={`whitespace-nowrap text-sm font-semibold hover:underline ${
                pathname.startsWith("/candidate/applications")
                  ? "text-primary"
                  : "text-muted-foreground hover:text-primary"
              }`}
            >
              My Applications
            </Link>
          )}
        </div>

        {/* Right: Profile and Logout */}
        <div className="flex items-center justify-end gap-2 sm:gap-4">
          {email ? (
            <>
              <Link
                href="/candidate/profile"
                className={`max-w-24 truncate text-sm font-medium hover:underline sm:max-w-none ${
                  pathname.startsWith("/candidate/profile")
                    ? "text-primary"
                    : "text-muted-foreground hover:text-primary"
                }`}
              >
                {name || "My Profile"}
              </Link>

              <button
                className="whitespace-nowrap text-sm font-medium text-primary hover:underline"
                onClick={logOut}
              >
                Log out
              </button>
            </>
          ) : (
            <Link
              href="/auth/login"
              className="text-sm font-medium text-primary hover:underline"
            >
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
