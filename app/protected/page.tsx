import { redirect } from "next/navigation";

// The old starter dashboard is gone; candidates start at the roles list.
export default function ProtectedHome() {
  redirect("/candidate/roles");
}
