/* QA-only: create (or reset) a Supabase test user for visual testing.
   The user authorized this; delete the user before production deploy.
   Usage: node scripts/qa-create-test-user.cjs
   Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local/.env. */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnv(file) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv(".env.local");
loadEnv(".env");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.QA_EMAIL || "brandosse.qa@brandosse.test";
const password = process.env.QA_PASSWORD || "Brandosse-QA-2026!";

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

(async () => {
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "QA Tester" },
  });

  if (error) {
    // Likely already exists — find and reset the password.
    let page = 1;
    let found = null;
    while (!found && page <= 10) {
      const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      found = (list?.users || []).find((u) => u.email === email);
      if (!list || list.users.length < 200) break;
      page += 1;
    }
    if (found) {
      await admin.auth.admin.updateUserById(found.id, { password, email_confirm: true });
      console.log("RESET existing QA user:", found.id);
    } else {
      console.error("createUser failed and user not found:", error.message);
      process.exit(1);
    }
  } else {
    console.log("CREATED QA user:", data.user.id);
  }

  console.log("QA_EMAIL=" + email);
  console.log("QA_PASSWORD=" + password);
})();
