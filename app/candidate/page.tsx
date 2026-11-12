import { redirect } from "next/navigation";

// Not signed in? The proxy sends /candidate/roles to /auth/login first.
export default function CandidateIndex() {
  redirect("/candidate/roles");
}
