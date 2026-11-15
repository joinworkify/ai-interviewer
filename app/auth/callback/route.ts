import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/server";

/** Exchanges the OAuth authorization code for a Supabase session. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }

  // Fixed codes, not provider text, so the login page never echoes URL input.
  const reason = searchParams.get("error") === "access_denied" ? "oauth_cancelled" : "oauth_failed";
  return NextResponse.redirect(new URL(`/auth/login?error=${reason}`, origin));
}
