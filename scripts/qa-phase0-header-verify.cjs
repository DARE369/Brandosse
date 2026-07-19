/* QA-only one-off: verify the new NotificationBell + AvatarMenu render and
   open correctly on Studio/Dashboard/Library/Calendar, light + dark.
   Usage: node scripts/qa-phase0-header-verify.cjs */
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
const OUT = path.join(process.cwd(), "qa-shots", "phase0-header");
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
      localStorage.setItem("uiv2-theme", t);
    } catch (e) {}
  }, theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
}

const PAGES = [
  { key: "dashboard", path: "/app/dashboard" },
  { key: "library", path: "/app/library" },
  { key: "calendar", path: "/app/calendar" },
  { key: "studio", path: "/app/generate" },
];

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`[${page.url()}] ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`[pageerror ${page.url()}] ${e.message}`));

  await login(page);

  const results = [];

  for (const { key, path: p } of PAGES) {
    for (const theme of ["dark", "light"]) {
      await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      await setTheme(page, theme);

      const rec = { key, theme, bell: "not-found", avatar: "not-found" };

      // Bell
      try {
        const bell = page.getByRole("button", { name: /notifications/i }).first();
        await bell.waitFor({ state: "visible", timeout: 5000 });
        await bell.click();
        await page.waitForTimeout(500);
        const bodyText = await page.textContent("body");
        rec.bell = /Notifications/.test(bodyText) && (/Mark all read/.test(bodyText)) ? "ok" : "opened-but-missing-copy";
        await page.screenshot({ path: path.join(OUT, `${key}-${theme}-bell.png`) });
        await bell.click(); // close
        await page.waitForTimeout(300);
      } catch (e) {
        rec.bellError = String(e).slice(0, 300);
      }

      // Avatar menu
      try {
        const avatarBtns = page.locator("button").filter({ hasText: /^[A-Z]{1,2}$/ });
        const count = await avatarBtns.count();
        let clicked = false;
        for (let i = count - 1; i >= 0 && !clicked; i--) {
          const btn = avatarBtns.nth(i);
          const box = await btn.boundingBox().catch(() => null);
          if (box && box.width < 40 && box.height < 40) {
            await btn.click();
            clicked = true;
          }
        }
        await page.waitForTimeout(500);
        const bodyText = await page.textContent("body");
        rec.avatar = clicked && /Sign out/.test(bodyText) && /Billing & credits/.test(bodyText) ? "ok" : (clicked ? "opened-but-missing-copy" : "trigger-not-found");
        await page.screenshot({ path: path.join(OUT, `${key}-${theme}-avatar.png`) });
      } catch (e) {
        rec.avatarError = String(e).slice(0, 300);
      }

      results.push(rec);
    }
  }

  fs.writeFileSync(path.join(OUT, "RESULTS.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, "CONSOLE-ERRORS.txt"), consoleErrors.join("\n"));

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
  if (consoleErrors.length) console.log("\nConsole errors:\n" + consoleErrors.slice(0, 30).join("\n"));
})();
