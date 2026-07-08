/* QA script: compare rebuilt Library + Calendar pages against their ui-v2 mockups.
   Usage: node scripts/qa-library-calendar.cjs */
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
const EMAIL = "ojomodare369@gmail.com";
const PW = "Jrtmz1'8";
const OUT = path.join(process.cwd(), "qa-shots");
fs.mkdirSync(OUT, { recursive: true });

const MOCKUP_LIB = "file:///" + path
  .resolve("docs/calendar-library-rebuild/ui-v2-migration/library-mockup.html")
  .replace(/\\/g, "/");
const MOCKUP_CAL = "file:///" + path
  .resolve("docs/calendar-library-rebuild/ui-v2-migration/calendar-mockup.html")
  .replace(/\\/g, "/");

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

function collectErrors(page, bucket) {
  page.on("console", (m) => {
    if (m.type() === "error") bucket.push(m.text());
  });
  page.on("pageerror", (e) => bucket.push("pageerror: " + e.message));
}

async function shootMockup(browser, url, tag, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${tag}.png`), fullPage: true });
  await context.close();
}

async function main() {
  const browser = await chromium.launch();
  const allErrors = {};

  // ---- Mockups ----
  await shootMockup(browser, MOCKUP_LIB, "library-mockup-desktop", { width: 1440, height: 900 });
  await shootMockup(browser, MOCKUP_LIB, "library-mockup-mobile", { width: 390, height: 844 });
  await shootMockup(browser, MOCKUP_CAL, "calendar-mockup-desktop", { width: 1440, height: 900 });
  await shootMockup(browser, MOCKUP_CAL, "calendar-mockup-mobile", { width: 390, height: 844 });

  // ---- Desktop context ----
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errs = [];
    collectErrors(page, errs);
    await login(page);

    // Library
    await page.goto(BASE + "/app/library", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    for (const theme of ["dark", "light"]) {
      await setTheme(page, theme);
      await page.screenshot({ path: path.join(OUT, `library-desktop-${theme}-full.png`), fullPage: true });
    }
    // open drawer on dark
    await setTheme(page, "dark");
    try {
      const card = page.locator('[class*="card" i], [class*="Card" i], [class*="item" i]').first();
      await card.click({ timeout: 5000 });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(OUT, "library-desktop-dark-drawer.png"), fullPage: true });
    } catch (e) {
      errs.push("library drawer open failed: " + e.message);
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);

    // Calendar
    await page.goto(BASE + "/app/calendar", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    for (const theme of ["dark", "light"]) {
      await setTheme(page, theme);
      await page.screenshot({ path: path.join(OUT, `calendar-desktop-${theme}-full.png`), fullPage: true });
    }
    await setTheme(page, "dark");
    // open post detail drawer
    try {
      const post = page.locator('[class*="postCard" i], [class*="PostCard" i], [class*="post-card" i]').first();
      await post.click({ timeout: 5000 });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(OUT, "calendar-desktop-dark-drawer.png"), fullPage: true });
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(500);
    } catch (e) {
      errs.push("calendar drawer open failed: " + e.message);
    }
    // toggle list view
    try {
      const listBtn = page.getByRole("button", { name: /list/i }).first();
      await listBtn.click({ timeout: 5000 });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(OUT, "calendar-desktop-listview.png"), fullPage: true });
    } catch (e) {
      errs.push("calendar list view toggle failed: " + e.message);
    }

    allErrors.desktop = errs;
    await context.close();
  }

  // ---- Mobile context ----
  {
    const context = await browser.newContext({ ...devices["Pixel 5"] });
    const page = await context.newPage();
    const errs = [];
    collectErrors(page, errs);
    await login(page);

    // Library
    await page.goto(BASE + "/app/library", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    for (const theme of ["dark", "light"]) {
      await setTheme(page, theme);
      await page.screenshot({ path: path.join(OUT, `library-mobile-${theme}-full.png`), fullPage: true });
    }
    await setTheme(page, "light");
    try {
      const card = page.locator('[class*="card" i], [class*="Card" i], [class*="item" i]').first();
      await card.click({ timeout: 5000 });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(OUT, "library-mobile-light-drawer.png"), fullPage: true });
      await page.keyboard.press("Escape").catch(() => {});
    } catch (e) {
      errs.push("mobile library drawer open failed: " + e.message);
    }

    // Calendar
    await page.goto(BASE + "/app/calendar", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    for (const theme of ["dark", "light"]) {
      await setTheme(page, theme);
      await page.screenshot({ path: path.join(OUT, `calendar-mobile-${theme}-full.png`), fullPage: true });
    }

    allErrors.mobile = errs;
    await context.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, "console-errors.json"), JSON.stringify(allErrors, null, 2));
  console.log("Done. Screenshots in qa-shots/");
  console.log(JSON.stringify(allErrors, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
