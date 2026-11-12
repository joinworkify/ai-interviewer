import { redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { readGeminiLiveConfig } from "@/lib/gemini-live/config";
import { GeminiLiveInterview } from "@/components/interview/gemini-live-interview";
import { isUuid } from "@/lib/sessions/validation";

function SetupIncomplete({ items, title }: { items: string[]; title: string }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-2xl border border-yellow-500/30 bg-yellow-500/[0.07] p-5 text-sm"
    >
      <p className="font-semibold">{title}</p>
      <p>
        Set these server environment variables (see <code>.env.example</code>{" "}
        and <code>GEMINI_LIVE_SETUP.md</code>), then restart the dev server or
        redeploy:
      </p>
      <ul className="list-disc pl-5 font-mono text-xs">
        {items.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  );
}

async function GeminiContent({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string | string[] }>;
}) {
  // Check before createClient(): the Supabase client throws without these.
  const missingSupabase = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    [
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name as string);
  if (missingSupabase.length > 0) {
    return (
      <SetupIncomplete
        title="Setup incomplete: Supabase is not configured"
        items={missingSupabase}
      />
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  // Read at request time; only variable names / a boolean reach the client.
  const config = readGeminiLiveConfig(process.env);
  // `?sessionId=` links the run to an interview session; ownership is checked
  // server side when the token and the transcript are requested.
  const { sessionId } = await searchParams;
  const linkedSessionId = isUuid(sessionId) ? sessionId : null;
  return (
    <div className="flex flex-col gap-6">
      {!config.ok && (
        <SetupIncomplete
          title="Setup incomplete: Gemini Live is not configured"
          items={[...config.missing, ...config.invalid]}
        />
      )}
      <GeminiLiveInterview configured={config.ok} sessionId={linkedSessionId} />
    </>
  );
}

export default function GeminiInterviewPage({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string | string[] }>;
}) {
  return (
    <div className="flex w-full flex-1 flex-col gap-8">
      <header className="relative flex flex-col gap-5 overflow-hidden rounded-3xl border border-foreground/10 bg-foreground/[0.03] p-6 sm:p-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-violet-500/20 blur-3xl"
        />
        <nav className="relative flex flex-wrap gap-3 text-sm">
          <Link
            href="/protected"
            className="rounded-full border border-foreground/10 bg-background/60 px-4 py-1.5 text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
          >
            ← Back to dashboard
          </Link>
          <Link
            href="/protected/interview"
            className="rounded-full border border-foreground/10 bg-background/60 px-4 py-1.5 text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
          >
            Vapi interview generator
          </Link>
        </nav>
        <h1 className="relative text-3xl font-bold tracking-tight sm:text-4xl">
          Practice voice interview (Gemini Live)
        </h1>
        <p className="relative max-w-2xl text-base leading-relaxed text-muted-foreground">
          Enter the role, level and tech stack, then press Start. A Gemini Live
          interviewer asks one question at a time by voice for up to 5 minutes.
          Say &quot;stop&quot; or &quot;bye&quot;, or press End, to finish.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <GeminiContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}