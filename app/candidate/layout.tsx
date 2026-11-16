import { Suspense } from "react";
import { CandidateHeader } from "@/components/candidate/candidate-header";

export const metadata = { title: "Candidate Interview | DataSea" };

export default function CandidateLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-datasea flex min-h-screen flex-col bg-background [color-scheme:light]">
      {/* Header and pages read the URL; Next needs Suspense boundaries above them. */}
      <Suspense fallback={<div className="h-[57px] border-b" />}>
        <CandidateHeader />
      </Suspense>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <Suspense>{children}</Suspense>
      </main>
    </div>
  );
}
