import { connection } from "next/server";
import { redirect } from "next/navigation";
import { ResumeProfileForm } from "@/components/candidate/resume-profile-form";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Profile Detail | DataSea",
};

export const instant = false;

export default async function CandidateResumePage() {
  await connection();

  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/auth/login");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("name, email, phone, linkedin_url, portfolio_url")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load candidate profile: ${error.message}`);
  }

  return (
    <ResumeProfileForm
      userId={user.id}
      initialProfile={{
        name: profile?.name ?? user.user_metadata?.name ?? "",
        email: user.email ?? profile?.email ?? "",
        phone: profile?.phone ?? "",
        linkedinUrl: profile?.linkedin_url ?? "",
        portfolioUrl: profile?.portfolio_url ?? "",
      }}
    />
  );
}