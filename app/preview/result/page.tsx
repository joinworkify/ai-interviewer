import Link from "next/link";
import {Header} from "@/components/header";

export default function resultPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <Header />
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md space-y-5 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold">Interview complete</h1>
          <p className="text-sm text-slate-600">Your interview was submitted.</p>
          <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 text-sm text-slate-600">
            <p>Status: Submitted</p>
            <p>Summary: Something here</p>
            <p>No scores, no accept or reject idk</p>
          </div>
          <Link
            href="/"
            className="block rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Done
          </Link>
        </div>
      </main>
    </div>
  );
}