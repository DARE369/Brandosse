/* Use Supabase admin API to generate a magic-link / OTP for workspace.toolss@gmail.com,
   then intercept the session token and inject it into the browser storage directly.
   Falls back to admin-generated link if available.
*/
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

// Load env
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = "workspace.toolss@gmail.com";
const BASE = "http://localhost:3000";

// Use Supabase admin to generate a session link
async function getAdminToken() {
  const url = `${SUPABASE_URL}/auth/v1/admin/users`;
  console.log("Fetching user list from Supabase admin API…");

  // First find the user ID
  const usersRes = await fetch(url, {
    headers: {
      "apikey": SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });

  if (!usersRes.ok) {
    const text = await usersRes.text();
    console.error("Failed to list users:", usersRes.status, text);
    return null;
  }

  const usersData = await usersRes.json();
  const users = usersData.users || [];
  console.log(`Found ${users.length} users`);

  const user = users.find(u => u.email === EMAIL);
  if (!user) {
    console.error(`User ${EMAIL} not found in Supabase`);
    console.log("Available emails:", users.slice(0, 10).map(u => u.email));
    return null;
  }

  console.log(`Found user: ${user.email} (id: ${user.id})`);

  // Generate a magic link for this user
  const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}/generate-link`, {
    method: "POST",
    headers: {
      "apikey": SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink" }),
  });

  if (!linkRes.ok) {
    const text = await linkRes.text();
    console.error("Failed to generate magic link:", linkRes.status, text);
    return null;
  }

  const linkData = await linkRes.json();
  console.log("Magic link generated:", JSON.stringify(linkData, null, 2));
  return linkData;
}

async function main() {
  const tokenData = await getAdminToken();
  if (!tokenData) {
    console.error("Could not get admin token. Aborting.");
    process.exit(1);
  }

  const actionLink = tokenData.action_link || tokenData.link;
  if (!actionLink) {
    console.error("No action_link in response:", JSON.stringify(tokenData));
    process.exit(1);
  }

  console.log("\nAction link:", actionLink.substring(0, 100) + "…");

  const OUT = path.join(process.cwd(), "qa-shots");
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log("\nNavigating to magic link…");
  await page.goto(actionLink, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);

  let finalUrl = page.url();
  console.log("After magic link:", finalUrl);

  // If we landed on auth callback, wait for it to resolve
  if (finalUrl.includes("token") || finalUrl.includes("callback") || finalUrl.includes("auth")) {
    await page.waitForTimeout(3000);
    finalUrl = page.url();
    console.log("After callback wait:", finalUrl);
  }

  // Navigate to library
  console.log("\nNavigating to /app/library…");
  await page.goto(BASE + "/app/library", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  finalUrl = page.url();
  console.log("Library URL:", finalUrl);

  // Take screenshot to see what's there
  await page.screenshot({ path: path.join(OUT, "library-magic-link-test.png") });
  console.log("Screenshot saved: qa-shots/library-magic-link-test.png");

  await browser.close();
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
