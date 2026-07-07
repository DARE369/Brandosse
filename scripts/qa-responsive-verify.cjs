/* QA-only one-off: verify Studio (/app/generate) and Dashboard (/app/dashboard)
   responsive breakpoints + loading states at custom viewport widths, light+dark.
   Usage: node scripts/qa-responsive-verify.cjs */
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
const OUT = path.join(process.cwd(), "qa-shots", "responsive-verify");
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
  // Pages under test (Studio, Dashboard) use the v2 theme system
  // (src/ui-v2/ThemeProvider.jsx), which reads localStorage["uiv2-theme"]
  // ONLY at mount time (useState initializer) and stamps data-uiv2-theme on
  // a wrapper div (not documentElement). Poking the DOM attribute directly
  // after mount does not affect the v2 CSS token scope, and the legacy
  // ThemeContext keys ("app-theme-preference") do not apply to v2 screens.
  // So: set localStorage, then hard-reload so the provider re-initializes.
  await page.evaluate((t) => {
    try {
      localStorage.setItem("uiv2-theme", t);
      localStorage.setItem("app-theme-preference", t); // legacy, harmless if unused
    } catch (e) {}
  }, theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  await login(page);

  // ---------- DASHBOARD ----------
  const dashboardWidths = [1440, 1150, 1000, 375];
  for (const w of dashboardWidths) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(BASE + "/app/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    for (const theme of ["light", "dark"]) {
      await setTheme(page, theme);
      await page.screenshot({ path: path.join(OUT, `dashboard-${w}-${theme}-viewport.png`) });
      await page.screenshot({ path: path.join(OUT, `dashboard-${w}-${theme}-full.png`), fullPage: true });
    }
  }

  // ---------- STUDIO ----------
  const studioWidths = [1440, 1100, 800, 390];
  for (const w of studioWidths) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(BASE + "/app/generate", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    for (const theme of ["light", "dark"]) {
      await setTheme(page, theme);
      await page.screenshot({ path: path.join(OUT, `studio-${w}-${theme}-viewport.png`) });
      await page.screenshot({ path: path.join(OUT, `studio-${w}-${theme}-full.png`), fullPage: true });
    }
  }

  // ---------- SESSION HISTORY DRAWER ----------
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + "/app/generate", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await setTheme(page, "dark");

  // Try to catch the loading skeleton right after click, before data loads.
  const historyBtn = page.getByRole("button", { name: /session history/i });
  let openedDrawer = false;
  try {
    await historyBtn.click({ timeout: 5000 });
    openedDrawer = true;
    await page.screenshot({ path: path.join(OUT, "studio-drawer-immediately-after-click.png") });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, "studio-drawer-loaded.png") });
  } catch (e) {
    fs.writeFileSync(path.join(OUT, "NOTE-drawer-button-not-found.txt"), String(e));
  }

  let sessionOutcome = "could-not-reach";
  let lastErr = null;
  if (openedDrawer) {
    // Try clicking on up to 3 past session rows (pastAvatar / pastRow) to resume.
    const pastRows = page.locator('[class*="pastRow"]');
    const count = await pastRows.count().catch(() => 0);
    if (count > 0) {
      for (let i = 0; i < Math.min(3, count); i++) {
        try {
          await pastRows.nth(i).locator('[class*="pastAvatar"]').click({ timeout: 5000 });
          await page.waitForTimeout(2500);
          await page.screenshot({ path: path.join(OUT, `studio-resumed-session-${i}.png`), fullPage: true });
          const bodyText = await page.textContent("body").catch(() => "");
          if (bodyText && /caption|hashtag|discovery|score/i.test(bodyText)) {
            sessionOutcome = `resumed-existing-session-index-${i}`;
            // Capture post-production panel at all studio widths + themes.
            for (const w of [1440, 1100, 800, 390]) {
              await page.setViewportSize({ width: w, height: 900 });
              await page.waitForTimeout(400);
              for (const theme of ["light", "dark"]) {
                await setTheme(page, theme);
                await page.screenshot({ path: path.join(OUT, `studio-postprod-${w}-${theme}.png`), fullPage: true });
              }
            }
            break;
          }
          // reopen drawer for next attempt
          await page.setViewportSize({ width: 1440, height: 900 });
          await historyBtn.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(800);
        } catch (e) {
          lastErr = e;
          // continue to next row
        }
      }
    } else {
      sessionOutcome = "no-past-sessions-found";
    }
  }
  fs.writeFileSync(path.join(OUT, "SESSION-OUTCOME.txt"), sessionOutcome + (lastErr ? ("\n\n" + String(lastErr)) : ""));

  await browser.close();
  console.log("Done. Outcome:", sessionOutcome);
  if (consoleErrors.length) console.log("Console errors:\n" + consoleErrors.slice(0, 20).join("\n"));
})();
