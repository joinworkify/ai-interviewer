import type { Metadata } from "next";

import { RolesManager } from "@/components/admin/roles-manager";
import { requireAdmin } from "@/lib/admin/server";

export const instant = false;

export const metadata: Metadata = {
  title: "Roles Management",
};

export default async function RolesPage() {
  await requireAdmin();

  return <RolesManager />;
}
