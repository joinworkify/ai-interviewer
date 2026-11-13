"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type OAuthProvider = "google" | "linkedin_oidc";

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.47-4.74 7.16l7.72 5.99c4.51-4.16 7.06-10.28 7.06-17.62Z" />
      <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.83l-7.72-5.99c-2.14 1.45-4.88 2.32-8.19 2.32-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
    </svg>
  );
}

function LinkedInMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="#0A66C2">
      <path d="M20.45 2H3.55C2.69 2 2 2.68 2 3.52v16.96c0 .84.69 1.52 1.55 1.52h16.9c.86 0 1.55-.68 1.55-1.52V3.52c0-.84-.69-1.52-1.55-1.52ZM8.02 18.34H5.06V9.02h2.96v9.32ZM6.54 7.75a1.72 1.72 0 1 1 .02-3.44 1.72 1.72 0 0 1-.02 3.44Zm12.5 10.59h-2.95v-4.53c0-1.08-.02-2.47-1.5-2.47-1.5 0-1.73 1.17-1.73 2.39v4.61H9.91V9.02h2.83v1.27h.04c.39-.73 1.36-1.5 2.8-1.5 3 0 3.56 1.97 3.56 4.54v5.01Z" />
    </svg>
  );
}

export function SocialAuthButtons() {
  const [loadingProvider, setLoadingProvider] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startOAuth(provider: OAuthProvider) {
    setLoadingProvider(provider);
    setError(null);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/candidate/roles")}`;
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
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full justify-center gap-3 border-border bg-white text-foreground hover:bg-muted"
        disabled={loadingProvider !== null}
        onClick={() => void startOAuth("google")}
      >
        {loadingProvider === "google" ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleMark />}
        Continue with Google
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full justify-center gap-3 border-border bg-white text-foreground hover:bg-muted"
        disabled={loadingProvider !== null}
        onClick={() => void startOAuth("linkedin_oidc")}
      >
        {loadingProvider === "linkedin_oidc" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkedInMark />}
        Continue with LinkedIn
      </Button>
      {error && <p role="alert" className="text-center text-sm text-destructive">{error}</p>}
    </div>
  );
}
