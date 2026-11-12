import { Suspense } from "react";
import { CandidateHeader } from "@/components/candidate/candidate-header";

export const metadata = { title: "Candidate Interview | DataSea" };

/** Same top bar and burgundy theme as the candidate pages. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-datasea flex min-h-screen flex-col bg-muted">
      <Suspense fallback={<div className="h-[57px] border-b" />}>
        <CandidateHeader />
      </Suspense>
      <div className="flex-1">
        <Suspense>{children}</Suspense>
      </div>
    </div>
  );
}
