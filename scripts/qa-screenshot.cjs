/* QA-only: log in with the test account and screenshot the app at desktop + mobile,
   in light + dark, so we can verify the REAL rendered UI.
   Usage: node scripts/qa-screenshot.cjs [route]
   Env: E2E_BASE_URL (default http://localhost:3000), QA_EMAIL, QA_PASSWORD, QA_ROUTE */
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("@playwright/test");

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
const ROUTE = process.argv[2] || process.env.QA_ROUTE || "/app/dashboard";
const OUT = path.join(process.cwd(), "qa-shots");
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
    try {
      localStorage.setItem("theme", t);
      localStorage.setItem("brandosse-theme", t);
      localStorage.setItem("color-theme", t);
    } catch (e) {}
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
  await page.waitForTimeout(700);
}

async function shoot(context, tag) {
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await login(page);
  await page.goto(BASE + ROUTE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  for (const theme of ["dark", "light"]) {
    await setTheme(page, theme);
    await page.screenshot({ path: path.join(OUT, `${tag}-${theme}-viewport.png`) });
    await page.screenshot({ path: path.join(OUT, `${tag}-${theme}-full.png`), fullPage: true });
  }
  await page.close();
  return errors;
}

(async () => {
  const browser = await chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dErr = await shoot(desktop, "desktop");
  await desktop.close();

  const mobile = await browser.newContext({ ...devices["Pixel 5"] });
  const mErr = await shoot(mobile, "mobile");
  await mobile.close();

  await browser.close();
  console.log("Screenshots written to qa-shots/");
  if (dErr.length) console.log("Desktop console errors:\n" + dErr.slice(0, 10).join("\n"));
  if (mErr.length) console.log("Mobile console errors:\n" + mErr.slice(0, 10).join("\n"));
})();
