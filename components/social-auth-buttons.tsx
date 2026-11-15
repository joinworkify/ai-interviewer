"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoogleLogo } from "@/components/google-logo";
import { DEFAULT_NEXT, safeNext } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/client";

type OAuthProvider = "google";

/** `next` is the same-origin path to open after sign-in. */
export function SocialAuthButtons({ next = DEFAULT_NEXT }: { next?: string }) {
  const [loadingProvider, setLoadingProvider] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pressing Back from Google can restore this page from the browser cache with
  // the button still disabled, so clear the loading state when that happens.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setLoadingProvider(null);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  async function startOAuth(provider: OAuthProvider) {
    setLoadingProvider(provider);
    setError(null);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      });
      if (oauthError) throw oauthError;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start social sign in. Please try again.");
      setLoadingProvider(null);
    }
  }

  return (
    <div className="space-y-3">
      {/* Follows Google's button guidelines: white fill, 1px #747775 border,
          #1F1F1F text, 20px logo, 10px gap, light-gray hover. */}
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full justify-center gap-2.5 border-[#747775] bg-white text-[#1F1F1F] shadow-none hover:bg-[#EEEEEE] hover:text-[#1F1F1F] [&_svg]:size-5"
        disabled={loadingProvider !== null}
        onClick={() => void startOAuth("google")}
      >
        {loadingProvider === "google" ? <Loader2 className="animate-spin" /> : <GoogleLogo />}
        Continue with Google
      </Button>
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
