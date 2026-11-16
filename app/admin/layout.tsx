import Link from "next/link";
import { Suspense } from "react";

import { LogoutButton } from "@/components/admin/logout-button";
import { requireAdmin } from "@/lib/admin/server";

/**
 * Admins only. Signed-out visitors are sent to the login page by the proxy;
 * signed-in non-admins get a plain 404, so the dashboard's existence is not
 * revealed (the header is inside the check too). Every admin page and route
 * checks again on the server.
 */
async function AdminShell({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/admin" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              D
            </span>
            Admin dashboard
          </Link>
          <nav className="text-sm">
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-5">{children}</main>
    </>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-datasea flex min-h-screen flex-col bg-background">
      <Suspense fallback={<p className="p-5 text-sm text-muted-foreground">Loading…</p>}>
        <AdminShell>{children}</AdminShell>
      </Suspense>
    </div>
  );
}
