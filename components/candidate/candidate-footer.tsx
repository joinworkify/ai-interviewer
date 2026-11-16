import Link from "next/link";

import { LogoMark } from "@/components/brand/logo-mark";

/** Footer for every candidate page. Kept static (no year lookup) so it works with Cache Components. */
export function CandidateFooter() {
  return (
    <footer className="border-t bg-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <LogoMark size={24} />
          <span>&copy; DataSea. All rights reserved.</span>
        </div>
        <nav aria-label="Footer" className="flex items-center gap-5">
          <Link href="/candidate/roles" className="hover:text-foreground hover:underline">
            Open roles
          </Link>
          <Link href="/candidate/applications" className="hover:text-foreground hover:underline">
            Application status
          </Link>
          <a
            href="https://joindatasea.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground hover:underline"
          >
            joindatasea.com
          </a>
        </nav>
      </div>
    </footer>
  );
}
