/* QA-only one-off: focused overflow re-check at 320/360/375/414/480 for
   /app/generate and /app/dashboard, dark+light, after header/schedule-dialog fixes.
   Usage: node scripts/qa-matrix-verify-narrow.cjs */
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
const EMAIL = "ojomodare369@gmail.com";
const PW = "Jrtmz1'8";
const OUT = path.join(process.cwd(), "qa-shots", "matrix-verify-narrow");
fs.mkdirSync(OUT, { recursive: true });

const WIDTHS = [320, 360, 375, 414, 480];
const THEMES = ["dark", "light"];
const PAGES = [
  { label: "generate", route: "/app/generate" },
  { label: "dashboard", route: "/app/dashboard" },
];

const results = [];

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
    try {
      localStorage.setItem("uiv2-theme", t);
      localStorage.setItem("app-theme-preference", t);
    } catch (e) {}
  }, theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
}

async function checkOverflow(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await login(page);

  for (const { label, route } of PAGES) {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      for (const theme of THEMES) {
        await setTheme(page, theme);
        const r = await checkOverflow(page);
        results.push({ page: label, width: w, theme, ...r });
        if (w === 320 && theme === "dark") {
          await page.screenshot({ path: path.join(OUT, `${label}-320-dark-viewport.png`) });
          await page.screenshot({ path: path.join(OUT, `${label}-320-dark-header.png`), clip: { x: 0, y: 0, width: w, height: 90 } }).catch(() => {});
        }
      }
    }
  }

  await browser.close();

  fs.writeFileSync(path.join(OUT, "RESULTS.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
})();
