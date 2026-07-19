/* QA-only one-off: verify the ui-v2 Analytics rebuild (Phase 1d).
   Usage: node scripts/qa-analytics-verify.cjs */
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
const EMAIL = process.env.QA_EMAIL || "ojomodare369@gmail.com";
const PW = process.env.QA_PASSWORD || "Jrtmz1'8";
const OUT = path.join(process.cwd(), "qa-shots", "analytics-phase1d");
fs.mkdirSync(OUT, { recursive: true });

async function login(page) {
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", PW);
  await page.click(".auth-submit");
  await page.waitForURL("**/app/**", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    try { localStorage.setItem("uiv2-theme", t); } catch (e) {}
  }, theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`[${page.url()}] ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`[pageerror ${page.url()}] ${e.message}`));

  await login(page);

  const results = [];
  for (const theme of ["dark", "light"]) {
    await page.goto(BASE + "/app/analytics", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await setTheme(page, theme);

    const rec = { theme };
    const bodyText = await page.textContent("body");
    rec.hasTitle = /Analytics/.test(bodyText);
    rec.hasRangeToggle = /Last 30 days/.test(bodyText) && /Last 90 days/.test(bodyText);
    rec.hasStatCards = /Published/.test(bodyText) && /Scheduled/.test(bodyText) && /Failed/.test(bodyText) && /Avg account health/.test(bodyText);
    rec.hasChart = /Posts published per week/.test(bodyText);
    rec.hasPlatformTable = /By platform/.test(bodyText);
    rec.hasFailedSection = /Failed posts in this period/.test(bodyText);
    rec.hasDisclaimer = /simulated/i.test(bodyText);
    await page.screenshot({ path: path.join(OUT, `analytics-${theme}-30d.png`), fullPage: true });

    // Toggle to 90-day range
    try {
      await page.getByText("Last 90 days", { exact: true }).click();
      await page.waitForTimeout(1500);
      const bodyText90 = await page.textContent("body");
      rec.range90Works = /Last 12 weeks/.test(bodyText90);
      await page.screenshot({ path: path.join(OUT, `analytics-${theme}-90d.png`), fullPage: true });
    } catch (e) {
      rec.range90Error = String(e).slice(0, 300);
    }

    // Bell + avatar sanity (Phase 0 shell reused here)
    try {
      const bell = page.getByRole("button", { name: /notifications/i }).first();
      await bell.waitFor({ state: "visible", timeout: 5000 });
      await bell.click();
      await page.waitForTimeout(400);
      rec.bell = /Notifications/.test(await page.textContent("body")) ? "ok" : "missing-copy";
      await bell.click();
    } catch (e) {
      rec.bellError = String(e).slice(0, 200);
    }

    results.push(rec);
  }

  fs.writeFileSync(path.join(OUT, "RESULTS.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, "CONSOLE-ERRORS.txt"), consoleErrors.join("\n"));

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
  if (consoleErrors.length) console.log("\nConsole errors:\n" + consoleErrors.slice(0, 30).join("\n"));
})();
