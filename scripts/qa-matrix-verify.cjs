/* QA-only one-off: overflow matrix check across many widths for Studio + Dashboard,
   light+dark, plus session-history drawer and schedule dialog overflow checks.
   Usage: node scripts/qa-matrix-verify.cjs */
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
const OUT = path.join(process.cwd(), "qa-shots", "matrix-verify");
fs.mkdirSync(OUT, { recursive: true });

const WIDTHS = [320, 360, 375, 414, 768, 900, 1000, 1100, 1280, 1440, 1920];
const THEME_SUBSET = [320, 375, 900, 1440];

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

async function runPage(page, routeLabel, route, widths, themes) {
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    for (const theme of themes) {
      await setTheme(page, theme);
      const r = await checkOverflow(page);
      results.push({ page: routeLabel, width: w, theme, ...r });
      const tag = `${routeLabel}-${w}-${theme}`;
      await page.screenshot({ path: path.join(OUT, `${tag}-viewport.png`) });
      if (w <= 414) {
        // header close-up for narrow widths
        await page.screenshot({ path: path.join(OUT, `${tag}-header.png`), clip: { x: 0, y: 0, width: w, height: 90 } }).catch(() => {});
      }
    }
  }
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  await login(page);

  // STUDIO: all widths in dark (default), theme subset in light
  await runPage(page, "studio", "/app/generate", WIDTHS, ["dark"]);
  await runPage(page, "studio", "/app/generate", THEME_SUBSET, ["light"]);

  // DASHBOARD: all widths in dark, theme subset in light
  await runPage(page, "dashboard", "/app/dashboard", WIDTHS, ["dark"]);
  await runPage(page, "dashboard", "/app/dashboard", THEME_SUBSET, ["light"]);

  // SESSION HISTORY DRAWER + SCHEDULE DIALOG at 320 and 375
  for (const w of [320, 375]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(BASE + "/app/generate", { waitUntil: "domcontentloaded" });
    await setTheme(page, "dark");
    await page.waitForTimeout(1500);

    const historyBtn = page.getByRole("button", { name: /session history/i });
    try {
      await historyBtn.click({ timeout: 5000 });
      await page.waitForTimeout(1200);
      const r = await checkOverflow(page);
      results.push({ page: "studio-drawer", width: w, theme: "dark", ...r });
      await page.screenshot({ path: path.join(OUT, `studio-drawer-${w}.png`), fullPage: true });

      // try to open a completed generation + Schedule dialog
      const pastRows = page.locator('[class*="pastRow"]');
      const count = await pastRows.count().catch(() => 0);
      let scheduled = false;
      for (let i = 0; i < Math.min(3, count) && !scheduled; i++) {
        try {
          await pastRows.nth(i).locator('[class*="pastAvatar"]').click({ timeout: 5000 });
          await page.waitForTimeout(2000);
          const scheduleBtn = page.getByRole("button", { name: /schedule/i }).first();
          if (await scheduleBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await scheduleBtn.click({ timeout: 5000 });
            await page.waitForTimeout(1000);
            const r2 = await checkOverflow(page);
            results.push({ page: "studio-schedule-dialog", width: w, theme: "dark", ...r2 });
            await page.screenshot({ path: path.join(OUT, `studio-schedule-dialog-${w}.png`), fullPage: true });
            scheduled = true;
          }
        } catch (e) {
          // try next row
        }
      }
      if (!scheduled) {
        results.push({ page: "studio-schedule-dialog", width: w, theme: "dark", scrollWidth: "N/A", clientWidth: "N/A", overflow: "no-completed-gen-found" });
      }
    } catch (e) {
      results.push({ page: "studio-drawer", width: w, theme: "dark", scrollWidth: "N/A", clientWidth: "N/A", overflow: "button-not-found: " + String(e).slice(0, 100) });
    }
  }

  await browser.close();

  fs.writeFileSync(path.join(OUT, "RESULTS.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  if (consoleErrors.length) console.log("Console errors:\n" + consoleErrors.slice(0, 20).join("\n"));
})();
