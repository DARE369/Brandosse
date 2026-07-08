/* QA verify script for /app/calendar claimed fix: right-docked drafts sidebar + always-visible Ask AI bar + Cmd+K.
   Usage: node scripts/qa-calendar-verify.cjs */
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
const EMAIL = process.env.QA_EMAIL;
const PW = process.env.QA_PASSWORD;
const ROUTE = "/app/calendar";
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
  // Calendar page uses an isolated UiV2ThemeProvider (localStorage key
  // "uiv2-theme", React state, data-uiv2-theme attr on a wrapper div) —
  // NOT the generic "theme"/data-theme keys. Set storage directly for the
  // FIRST navigation (read on mount), and click the real header toggle
  // button for in-session switches so React state actually updates.
  const current = await page.evaluate(() => document.querySelector('[data-uiv2-theme]')?.getAttribute('data-uiv2-theme')).catch(() => null);
  if (current && current !== theme) {
    const toggle = await page.$('button[title*="Switch to"]');
    if (toggle) {
      await toggle.click();
      await page.waitForTimeout(500);
    }
  } else if (!current) {
    await page.evaluate((t) => { try { localStorage.setItem('uiv2-theme', t); } catch (e) {} }, theme);
  }
  await page.waitForTimeout(500);
}

(async () => {
  const browser = await chromium.launch();
  const allErrors = [];

  // ---------- DESKTOP ----------
  const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dpage = await desktopCtx.newPage();
  dpage.on("console", (m) => { if (m.type() === "error") allErrors.push(`[desktop] ${m.text()}`); });
  await login(dpage);
  await dpage.goto(BASE + ROUTE, { waitUntil: "domcontentloaded" });
  await dpage.waitForTimeout(2500);

  for (const theme of ["dark", "light"]) {
    await setTheme(dpage, theme);
    await dpage.screenshot({ path: path.join(OUT, `desktop-drafts-sidebar-${theme}.png`), fullPage: true });
  }

  // Ask AI bar visibility check (dark theme, no interaction)
  await setTheme(dpage, "dark");
  const askAiBar = await dpage.$(".cal3-cmdbar-inline");
  const askAiVisible = askAiBar ? await askAiBar.isVisible() : false;
  await dpage.screenshot({ path: path.join(OUT, "ask-ai-bar-visible-dark.png") });
  await setTheme(dpage, "light");
  await dpage.screenshot({ path: path.join(OUT, "ask-ai-bar-visible-light.png") });

  // Click a quick-action chip
  await setTheme(dpage, "dark");
  const chip = await dpage.$(".cal3-cmdbar-inline__chip");
  let overlayOpenedFromChip = false;
  if (chip) {
    await chip.click();
    await dpage.waitForTimeout(800);
    overlayOpenedFromChip = await dpage.$(".cal3-cmdbar-overlay") !== null;
    await dpage.screenshot({ path: path.join(OUT, "askai-chip-clicked.png") });
  }

  // Reload, then Control+K
  await dpage.reload({ waitUntil: "domcontentloaded" });
  await dpage.waitForTimeout(2000);
  await setTheme(dpage, "dark");
  await dpage.keyboard.press("Control+K");
  await dpage.waitForTimeout(800);
  const cmdkOpened = await dpage.$(".cal3-cmdbar-overlay") !== null;
  await dpage.screenshot({ path: path.join(OUT, "cmdk-opened.png") });
  await dpage.keyboard.press("Escape");
  await dpage.waitForTimeout(300);

  // Drafts rail structural check
  const railBox = await dpage.$eval(".cal3-rail", (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }).catch(() => null);
  const bodyGridCols = await dpage.$eval(".cal3-body", (el) => getComputedStyle(el).gridTemplateColumns).catch(() => null);
  const draftCardHeight = await dpage.$eval(".draft-card", (el) => el.getBoundingClientRect().height).catch(() => null);

  await desktopCtx.close();

  // ---------- MOBILE ----------
  const mobileCtx = await browser.newContext({ ...devices["Pixel 5"] });
  const mpage = await mobileCtx.newPage();
  mpage.on("console", (m) => { if (m.type() === "error") allErrors.push(`[mobile] ${m.text()}`); });
  await login(mpage);
  await mpage.goto(BASE + ROUTE, { waitUntil: "domcontentloaded" });
  await mpage.waitForTimeout(2500);

  for (const theme of ["dark", "light"]) {
    await setTheme(mpage, theme);
    await mpage.screenshot({ path: path.join(OUT, `mobile-drafts-strip-${theme}.png`), fullPage: true });
  }

  const mobileRailFlexDir = await mpage.$eval(".cal3-rail__scroll", (el) => getComputedStyle(el).flexDirection).catch(() => null);
  const mobileRailOrder = await mpage.$eval(".cal3-rail", (el) => getComputedStyle(el).order).catch(() => null);

  await mobileCtx.close();
  await browser.close();

  console.log(JSON.stringify({
    askAiVisible,
    overlayOpenedFromChip,
    cmdkOpened,
    railBox,
    bodyGridCols,
    draftCardHeight,
    mobileRailFlexDir,
    mobileRailOrder,
    consoleErrors: allErrors,
  }, null, 2));
})();
