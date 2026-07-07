/* QA-only extended breakpoint screenshot harness.
   Usage: node scripts/qa-screenshot-extended.cjs
   Env: E2E_BASE_URL, QA_EMAIL, QA_PASSWORD */
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

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1050, height: 850 },
  narrowTablet: { width: 780, height: 900 },
  mobile: { width: 390, height: 844 },
};

async function login(page) {
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", PW);
  await page.click(".auth-submit");
  await page.waitForURL("**/app/**", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

// App uses two independent theme systems depending on page:
// - legacy ThemeContext (old pages) via localStorage "theme"/data-theme attr
// - ui-v2 ThemeProvider (Studio/GeneratePageV2, Dashboard) via localStorage
//   "uiv2-theme", read ONLY on mount, real toggle button has
//   title="Switch to light/dark mode". So the only reliable way to get real
// light mode is to click the live toggle button (or set localStorage BEFORE
// the page mounts, i.e. before goto).
async function clickThemeToggle(page) {
  const selectors = [
    'button[title*="Switch to" i]',
    'button[aria-label*="theme" i]',
    'button[title*="theme" i]',
    '[data-testid*="theme-toggle" i]',
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) {
      await el.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(600);
      return true;
    }
  }
  return false;
}

async function run() {
  const browser = await chromium.launch();
  const errors = {};

  async function forRoute(route, tag, opts = {}) {
    for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      const errs = [];
      page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
      await login(page);
      await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      if (opts.waitForSelector) {
        await page.waitForSelector(opts.waitForSelector, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1200);
      }

      // App defaults to dark theme on first mount (defaultTheme="dark" in
      // UiV2ThemeProvider). Screenshot dark first.
      await page.screenshot({ path: path.join(OUT, `${tag}-${vpName}-dark-viewport.png`) });
      await page.screenshot({ path: path.join(OUT, `${tag}-${vpName}-dark-full.png`), fullPage: true });

      if (opts.sessionHistory && vpName === "desktop") {
        const opened = await opts.sessionHistory(page);
        if (opened) {
          await page.screenshot({ path: path.join(OUT, `${tag}-${vpName}-dark-sessionhistory.png`) });
        }
        // close it again so it doesn't cover content in the light screenshots
        await page.keyboard.press("Escape").catch(() => {});
      }

      // Click the REAL theme toggle button to switch to light mode live.
      const clicked = await clickThemeToggle(page);
      errors[`${tag}-${vpName}-toggle-clicked`] = clicked;
      await page.screenshot({ path: path.join(OUT, `${tag}-${vpName}-light-viewport.png`) });
      await page.screenshot({ path: path.join(OUT, `${tag}-${vpName}-light-full.png`), fullPage: true });

      if (opts.sessionHistory && vpName === "desktop") {
        const opened = await opts.sessionHistory(page);
        if (opened) {
          await page.screenshot({ path: path.join(OUT, `${tag}-${vpName}-light-sessionhistory.png`) });
        }
      }

      await ctx.close();
      errors[`${tag}-${vpName}`] = errs;
    }
  }

  if (!process.env.QA_ONLY_DASHBOARD) await forRoute("/app/generate", "studio", {
    sessionHistory: async (page) => {
      const selectors = [
        'button:has-text("Session history")',
        '[aria-label*="session history" i]',
        'button:has-text("History")',
        '[data-testid*="session-history" i]',
      ];
      for (const sel of selectors) {
        const el = page.locator(sel).first();
        if (await el.count().catch(() => 0)) {
          await el.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(800);
          return true;
        }
      }
      return false;
    },
  });

  await forRoute("/app/dashboard", "dashboard", {
    waitForSelector: 'text=free credits',
  });

  await browser.close();
  console.log("Done. Errors/log:", JSON.stringify(errors, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
