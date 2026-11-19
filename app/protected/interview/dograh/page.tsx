import { redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { readDograhWidgetConfig } from "@/lib/dograh/config";
import { DograhInterview } from "@/components/interview/dograh-interview";
import { isUuid } from "@/lib/sessions/validation";

function SetupIncomplete({ items, title }: { items: string[]; title: string }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-2xl border border-yellow-500/30 bg-yellow-500/[0.07] p-5 text-sm"
    >
      <p className="font-semibold">{title}</p>
      <p>
        Set these environment variables (see <code>.env.example</code> and <code>DOGRAH_SETUP.md</code>),
        then restart the dev server or redeploy:
      </p>
      <ul className="list-disc pl-5 font-mono text-xs">
        {items.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  );
}

async function DograhContent({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string | string[] }>;
}) {
  // Check before createClient(): the Supabase client throws without these.
  const missingSupabase = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name as string);
  if (missingSupabase.length > 0) {
    return (
      <SetupIncomplete title="Setup incomplete: Supabase is not configured" items={missingSupabase} />
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  // Read at request time. Only variable names and the public script URL reach the client.
  const widget = readDograhWidgetConfig(process.env);
  // `?sessionId=` ties the call to an interview session. Ownership is checked
  // server side when the call is prepared and when the transcript arrives.
  const { sessionId } = await searchParams;
  const linkedSessionId = isUuid(sessionId) ? sessionId : null;
  return (
    <div className="flex flex-col gap-6">
      {!widget.ok && (
        <SetupIncomplete
          title="Setup incomplete: the Dograh widget is not configured"
          items={[...widget.missing, ...widget.invalid]}
        />
      )}
      <DograhInterview sessionId={linkedSessionId} widgetSrc={widget.ok ? widget.src : null} />
    </div>
  );
}

export default function DograhInterviewPage({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string | string[] }>;
}) {
  return (
    <div className="flex w-full flex-1 flex-col gap-8">
      <header className="flex flex-col gap-4">
        <nav className="flex flex-wrap gap-3 text-sm">
          <Link
            href="/protected"
            className="rounded-full border border-foreground/10 bg-background/60 px-4 py-1.5 text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
          >
            ← Back to dashboard
          </Link>
          <Link
            href="/protected/interview/gemini"
            className="rounded-full border border-foreground/10 bg-background/60 px-4 py-1.5 text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
          >
            Gemini Live interview
          </Link>
        </nav>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Practice voice interview (Dograh)
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
          Enter the role, level and tech stack, then press Start. A Dograh voice agent asks the questions
          stored with your interview. Press End or say goodbye to finish.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <DograhContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
