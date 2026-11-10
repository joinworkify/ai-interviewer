import { redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { InterviewGeneratorCall } from "@/components/interview/interview-generator-call";
import { MIN_SIGNING_SECRET_LENGTH } from "@/lib/interviews/capability";

interface SavedInterview {
  id: string;
  questions: string[];
  duration_minutes: number | null;
  created_at: string;
}

function SupabaseSetupIncomplete({ missing }: { missing: string[] }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-4 text-sm flex flex-col gap-2"
    >
      <p className="font-semibold">Setup incomplete: Supabase is not configured</p>
      <p>
        Sign-in and saved interviews need these environment variables. Add them
        to your existing env file (see <code>.env.example</code> and{" "}
        <code>VAPI_SETUP.md</code>), then restart the dev server or rebuild:
      </p>
      <ul className="list-disc pl-5 font-mono text-xs">
        {missing.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      <p className="text-muted-foreground">
        After Supabase is configured, this page will list any remaining Vapi,
        LLM and server-secret variables.
      </p>
    </div>
  );
}

async function InterviewContent() {
  // Check before createClient(): the Supabase client throws without these.
  // Literal access matches what createClient() sees (inlined at build time).
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
    return <SupabaseSetupIncomplete missing={missingSupabase} />;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  // Read at request time (after cookies()), never sent to the client except
  // the two public values and booleans.
  const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY?.trim() ?? "";
  const assistantId =
    process.env.NEXT_PUBLIC_VAPI_GENERATOR_ASSISTANT_ID?.trim() ?? "";
  const checks = [
    { name: "NEXT_PUBLIC_VAPI_PUBLIC_KEY", ok: publicKey.length > 0 },
    { name: "NEXT_PUBLIC_VAPI_GENERATOR_ASSISTANT_ID", ok: assistantId.length > 0 },
    {
      name: `VAPI_TOOL_SIGNING_SECRET (≥ ${MIN_SIGNING_SECRET_LENGTH} chars)`,
      ok:
        (process.env.VAPI_TOOL_SIGNING_SECRET?.length ?? 0) >=
        MIN_SIGNING_SECRET_LENGTH,
    },
    { name: "SUPABASE_SECRET_KEY", ok: !!process.env.SUPABASE_SECRET_KEY?.trim() },
    { name: "LLM_API_KEY", ok: !!process.env.LLM_API_KEY?.trim() },
    { name: "LLM_MODEL", ok: !!process.env.LLM_MODEL?.trim() },
  ];
  const missing = checks.filter((c) => !c.ok);
  const canCall = publicKey.length > 0 && assistantId.length > 0;

  const { data: interviews, error: listError } = await supabase
    .from("interviews")
    .select("id, questions, duration_minutes, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <>
      {missing.length > 0 && (
        <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-4 text-sm flex flex-col gap-2">
          <p className="font-semibold">Setup incomplete</p>
          <p>
            Set these environment variables (see <code>.env.example</code> and{" "}
            <code>VAPI_SETUP.md</code>), then restart the dev server:
          </p>
          <ul className="list-disc pl-5 font-mono text-xs">
            {missing.map((c) => (
              <li key={c.name}>{c.name}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Vapi must also be able to reach{" "}
            <code>/api/vapi/generate-interview</code> over public HTTPS —
            <code> localhost</code> is not reachable from Vapi.
          </p>
        </div>
      )}

      {canCall ? (
        <InterviewGeneratorCall publicKey={publicKey} assistantId={assistantId} />
      ) : (
        <p className="text-sm text-muted-foreground">
          The voice call is disabled until the Vapi public key and Generator
          Assistant ID are configured.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-bold text-xl">Your generated interviews</h2>
        {listError ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load interviews: {listError.message}
            {(listError.code === "PGRST205" || listError.code === "42P01") &&
              " — the interviews table is missing. Run the SQL migration in supabase/migrations (see VAPI_SETUP.md)."}
          </p>
        ) : !interviews || interviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No interviews yet. Start a call and tell the assistant what role
            you are preparing for.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {(interviews satisfies SavedInterview[]).map((iv) => (
              <li key={iv.id} className="rounded-md border p-4 text-sm">
                <p className="font-semibold">
                  {iv.questions.length} questions
                  {iv.duration_minutes ? ` · ${iv.duration_minutes} min` : ""}
                </p>
                <p className="text-muted-foreground text-xs mb-2">
                  {new Date(iv.created_at).toLocaleString()}
                </p>
                <ol className="list-decimal pl-5 flex flex-col gap-1">
                  {iv.questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function InterviewPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <Link href="/protected" className="hover:underline">
            ← Back to dashboard
          </Link>
          <Link href="/protected/interview/gemini" className="hover:underline">
            Practice a live interview with Gemini →
          </Link>
        </div>
        <h1 className="font-bold text-2xl">Create an interview by voice</h1>
        <p className="text-sm text-muted-foreground">
          The assistant will ask for the role, level, interview type, tech
          stack and number of questions, then generate and save the questions
          to your account.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <InterviewContent />
      </Suspense>
    </div>
  );
}
