
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { LogoMark } from "@/components/brand/logo-mark";
import { LogoutButton } from "@/components/admin/logout-button";
import { InterviewsSkeleton } from "@/components/admin/skeletons";
import { requireAdmin } from "@/lib/admin/server";

export const instant = false;

export const metadata: Metadata = {
  title: { default: "Admin | DataSea", template: "%s | Admin | DataSea" },
  robots: { index: false, follow: false },
};

async function AdminShell({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <>
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/admin" className="flex items-center gap-2 font-heading font-semibold tracking-tight">
            <LogoMark size={32} />
            Admin dashboard
          </Link>

          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/admin"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Interviews
            </Link>
            <Link
              href="/admin/roles"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Roles
            </Link>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-5">{children}</main>
      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground">
          <span>© DataSea. All rights reserved.</span>
          <span>Admin dashboard</span>
        </div>
      </footer>
    </>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="theme-datasea flex min-h-screen flex-col bg-background">
      <Suspense
        fallback={
          <>
            <header className="border-b bg-background">
              <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 font-heading font-semibold tracking-tight">
                <LogoMark size={32} />
                Admin dashboard
              </div>
            </header>
            <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-5">
              <InterviewsSkeleton />
            </main>
          </>
        }
      >
        <AdminShell>{children}</AdminShell>
      </Suspense>
    </div>
  );
}
