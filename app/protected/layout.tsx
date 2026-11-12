import { Suspense } from "react";
import { CandidateHeader } from "@/components/candidate/candidate-header";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-datasea flex min-h-screen flex-col bg-background">
      <Suspense fallback={<div className="h-[57px] border-b" />}>
        <CandidateHeader />
      </Suspense>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 p-5">{children}</main>
    </div>
  );
}
