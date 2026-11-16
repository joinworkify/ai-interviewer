"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="font-medium text-primary hover:underline"
      onClick={async () => {
        await createClient().auth.signOut();
        router.push("/auth/login");
      }}
    >
      Log out
    </button>
  );
}
