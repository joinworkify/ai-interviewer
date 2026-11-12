import { redirect } from "next/navigation";

// Signed out? The proxy sends /candidate/roles on to /auth/login.
export default function Home() {
  redirect("/candidate/roles");
}
