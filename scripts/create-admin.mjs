// Creates (or updates) an admin account for the /admin dashboard.
//
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... node --env-file=.env.local scripts/create-admin.mjs
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (from .env.local).
// The user gets a confirmed email and app_metadata.role = "admin", which only
// the service role can set. Never commit the password.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (!url || !key || !email || !password) {
  console.error(
    "Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, ADMIN_EMAIL and ADMIN_PASSWORD.",
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
console.log(`Supabase: ${url}`);

async function findUser() {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (found || data.users.length < 1000) return found ?? null;
  }
}

const existing = await findUser();
const attrs = { password, email_confirm: true, app_metadata: { role: "admin" } };
const { data, error } = existing
  ? await supabase.auth.admin.updateUserById(existing.id, attrs)
  : await supabase.auth.admin.createUser({ email, ...attrs });
if (error) {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
}
console.log(`${existing ? "Updated" : "Created"} admin ${data.user.email} (${data.user.id}).`);
