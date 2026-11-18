"use client";

import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  return (
    <button
      className="font-medium text-primary hover:underline"
      onClick={async () => {
        await createClient().auth.signOut();
        // Full reload: Cache Components preserves client state across
        // router.push, so a client navigation would restore the previous
        // session's login form.
        window.location.href = "/auth/login";
      }}
    >
      Log out
    </button>
  );
}
