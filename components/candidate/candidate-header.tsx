"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { currentCandidateId, logout } from "@/lib/candidate/api";

export function CandidateHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [candidateId, setCandidateId] = useState<string | null>(null);
  // sessionStorage is client-only, so read it after mount.
  useEffect(() => setCandidateId(currentCandidateId()), [pathname]);

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/candidate/roles" className="flex items-center gap-2 font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">D</span>
          Candidate Interview
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {candidateId && <span className="max-w-[10rem] truncate text-muted-foreground sm:max-w-none">● {candidateId}</span>}
          {/* shortcut: no help page yet, link it when support has one */}
          <span className="text-muted-foreground" title="Help page coming soon">
            Help
          </span>
          {candidateId ? (
            <button
              className="hover:underline"
              onClick={() => {
                logout();
                router.push("/candidate/login");
              }}
            >
              Log out
            </button>
          ) : (
            <Link href="/candidate/login" className="hover:underline">
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
