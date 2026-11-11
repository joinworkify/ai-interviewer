import { redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { readGeminiLiveConfig } from "@/lib/gemini-live/config";
import { GeminiLiveInterview } from "@/components/interview/gemini-live-interview";

function SetupIncomplete({ items, title }: { items: string[]; title: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-4 text-sm flex flex-col gap-2"
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

async function GeminiContent() {
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
  return (
    <>
      {!config.ok && (
        <SetupIncomplete
          title="Setup incomplete: Gemini Live is not configured"
          items={[...config.missing, ...config.invalid]}
        />
      )}
      <GeminiLiveInterview configured={config.ok} />
    </>
  );
}

export default function GeminiInterviewPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <Link href="/protected" className="hover:underline">
            ← Back to dashboard
          </Link>
          <Link href="/protected/interview" className="hover:underline">
            Vapi interview generator
          </Link>
        </div>
        <h1 className="font-bold text-2xl">Practice voice interview (Gemini Live)</h1>
        <p className="text-sm text-muted-foreground">
          Enter the role, level and tech stack, then press Start. A Gemini Live
          interviewer asks one question at a time by voice for up to 5 minutes.
          Say &quot;stop&quot; or &quot;bye&quot;, or press End, to finish.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <GeminiContent />
      </Suspense>
    </div>
  );
}



// app/protected/interview/gemini/page.tsx
// import { Suspense } from "react";
// import { readGeminiLiveConfig } from "@/lib/gemini-live/config";
// import { GeminiLiveInterview } from "@/components/interview/gemini-live-interview";

// function SetupIncomplete({ items, title }: { items: string[]; title: string }) {
//   return (
//     <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-4 text-sm flex flex-col gap-2">
//       <p className="font-semibold">{title}</p>
//       <p>Set these server environment variables:</p>
//       <ul className="list-disc pl-5 font-mono text-xs">
//         {items.map((name) => (
//           <li key={name}>{name}</li>
//         ))}
//       </ul>
//     </div>
//   );
// }

// async function GeminiContent() {
//   // ⛔️ Supabase စစ်ဆေးတာ အကုန်ဖျက်ပြီး အောက်ပါအတိုင်း ပြင်ပါ
//   const config = readGeminiLiveConfig(process.env);
//   return (
//     <>
//       {!config.ok && (
//         <SetupIncomplete
//           title="Setup incomplete: Gemini Live is not configured"
//           items={[...config.missing, ...config.invalid]}
//         />
//       )}
//       <GeminiLiveInterview configured={config.ok} />
//     </>
//   );
// }

// export default function GeminiInterviewPage() {
//   return (
//     <div className="flex-1 w-full flex flex-col gap-8">
//       <div className="flex flex-col gap-2">
//         <h1 className="font-bold text-2xl">Practice voice interview (Gemini Live)</h1>
//         <p className="text-sm text-muted-foreground">
//           Enter the role, level and tech stack, then press Start.
//         </p>
//       </div>
//       <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
//         <GeminiContent />
//       </Suspense>
//     </div>
//   );
// }