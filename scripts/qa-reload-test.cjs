/* QA-only: verify the refresh-while-logged-in path (AuthContext.checkSession).
   Logs in once, persists the session (storageState), then opens a FRESH context
   WITH that session and navigates directly to /app/dashboard — exercising the
   optimistic-session paint and measuring time-to-content.
   Usage: node scripts/qa-reload-test.cjs */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

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

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
const EMAIL = process.env.QA_EMAIL || "brandosse.qa@brandosse.test";
const PW = process.env.QA_PASSWORD || "Brandosse-QA-2026!";
const OUT = path.join(process.cwd(), "qa-shots");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();

  // 1) Log in once to obtain a real session in storage.
  const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p1 = await ctx1.newPage();
  await p1.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await p1.fill("#login-email", EMAIL);
  await p1.fill("#login-password", PW);
  await p1.click(".auth-submit");
  await p1.waitForURL("**/app/**", { timeout: 30000 }).catch(() => {});
  await p1.waitForTimeout(2500);
  const storageState = await ctx1.storageState();
  await ctx1.close();

  // 2) Fresh context WITH the session — direct nav to the dashboard (the refresh path).
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  const p2 = await ctx2.newPage();
  const errors = [];
  p2.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  const t0 = Date.now();
  await p2.goto(BASE + "/app/dashboard", { waitUntil: "commit" });
  let contentMs = null;
  try {
    await p2.waitForSelector(".bd-greeting-title, .bd-canvas", { timeout: 20000 });
    contentMs = Date.now() - t0;
  } catch (e) {}
  await p2.waitForTimeout(1500);
  await p2.screenshot({ path: path.join(OUT, "reload-session-dashboard.png") });

  console.log("Direct-nav-with-session → time to dashboard content (ms):", contentMs);
  if (errors.length) console.log("console errors:", errors.slice(0, 8).join(" | "));

  await ctx2.close();
  await browser.close();
})();
