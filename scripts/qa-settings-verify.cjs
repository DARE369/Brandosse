/* QA-only one-off: verify the ui-v2 Settings rebuild (Phase 1e).
   Usage: node scripts/qa-settings-verify.cjs */
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
const OUT = path.join(process.cwd(), "qa-shots", "settings-phase1e");
fs.mkdirSync(OUT, { recursive: true });

async function login(page) {
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", PW);
  await page.click(".auth-submit");
  await page.waitForURL("**/app/**", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`[${page.url()}] ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`[pageerror ${page.url()}] ${e.message}`));

  await login(page);
  await page.goto(BASE + "/app/settings", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const results = {};
  results.hasTitle = /Settings/.test(await page.textContent("body"));
  await page.screenshot({ path: path.join(OUT, "settings-profile.png"), fullPage: true });

  const tabs = ["Content defaults", "Connected accounts", "Security", "Data & privacy"];
  for (const tab of tabs) {
    try {
      await page.getByText(tab, { exact: true }).click();
      await page.waitForTimeout(1500);
      const body = await page.textContent("body");
      results[tab] = { clicked: true, bodyLen: body.length };
      await page.screenshot({ path: path.join(OUT, `settings-${tab.toLowerCase().replace(/[^a-z]+/g, "-")}.png`), fullPage: true });
    } catch (e) {
      results[tab] = { error: String(e).slice(0, 200) };
    }
  }

  fs.writeFileSync(path.join(OUT, "RESULTS.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, "CONSOLE-ERRORS.txt"), consoleErrors.join("\n"));
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
  if (consoleErrors.length) console.log("\nConsole errors:\n" + consoleErrors.slice(0, 40).join("\n"));
})();
