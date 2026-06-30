/* QA harness — Library page visual capture
   Logs in with real credentials, navigates to /app/library, captures:
   - desktop 1440×900: dark + light, viewport + full-page + scrolled-mid
   - mobile Pixel5 ~390px: dark + light, viewport + full-page
   Also logs compositing-relevant CSS on any card/button elements found.
*/
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

const BASE = "http://localhost:3000";
const EMAIL = "workspace.toolss@gmail.com";
const PW = process.env.QA_PASSWORD || "Brandosse2026!";
const ROUTE = "/app/library";
const OUT = path.join(process.cwd(), "qa-shots");
fs.mkdirSync(OUT, { recursive: true });

async function login(page) {
  console.log("  Navigating to login…");
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);

  // Fill email
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", PW);
  await page.click(".auth-submit");

  console.log("  Waiting for redirect after login…");
  // Wait for navigation away from login
  try {
    await page.waitForURL((url) => !url.includes("/login"), { timeout: 30000 });
  } catch (e) {
    console.log("  Login redirect timeout — checking page state");
    const url = page.url();
    console.log("  Current URL:", url);
    // Check if there's an error on the page
    const errorText = await page.locator(".auth-error").textContent().catch(() => "");
    if (errorText) console.log("  Auth error:", errorText);
  }
  await page.waitForTimeout(2500);
  console.log("  Post-login URL:", page.url());
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    try {
      localStorage.setItem("theme", t);
      localStorage.setItem("brandosse-theme", t);
      localStorage.setItem("color-theme", t);
    } catch (e) {}
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.className = document.documentElement.className
      .replace(/\b(dark|light)\b/g, "")
      .trim();
    document.documentElement.classList.add(t);
  }, theme);
  await page.waitForTimeout(900);
}

async function extractCompositingCSS(page) {
  return await page.evaluate(() => {
    const selectors = [
      '[class*="card"]', '[class*="Card"]',
      '[class*="button"]', '[class*="btn"]', '[class*="action"]',
      '[class*="library"]', '[class*="content"]',
      '[class*="grid"]', '[class*="tile"]',
    ];

    const props = [
      "backdropFilter", "WebkitBackdropFilter",
      "filter", "transform", "willChange",
      "opacity", "position", "overflow",
      "isolation", "mixBlendMode",
      "zIndex", "background",
    ];

    const results = [];
    const seen = new Set();

    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const id = el.tagName + "." + el.className.slice(0, 60);
        if (seen.has(id)) continue;
        seen.add(id);
        const cs = window.getComputedStyle(el);
        const entry = { selector: id, props: {} };
        let interesting = false;
        for (const p of props) {
          const val = cs[p];
          entry.props[p] = val;
          if (
            (p === "backdropFilter" || p === "WebkitBackdropFilter") && val && val !== "none" ||
            (p === "filter") && val && val !== "none" ||
            (p === "transform") && val && val !== "none" ||
            (p === "willChange") && val && val !== "auto" ||
            (p === "opacity") && val && val !== "1" ||
            (p === "isolation") && val && val !== "auto" ||
            (p === "mixBlendMode") && val && val !== "normal"
          ) {
            interesting = true;
          }
        }
        if (interesting) results.push(entry);
      }
    }
    return results;
  });
}

async function shoot(browser, tag, viewportOpts, themesToShoot = ["dark", "light"]) {
  const context = await browser.newContext(viewportOpts);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await login(page);

  // Navigate to library
  console.log(`  [${tag}] Navigating to ${ROUTE}…`);
  await page.goto(BASE + ROUTE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  const finalUrl = page.url();
  console.log(`  [${tag}] Final URL: ${finalUrl}`);

  const compositingData = {};

  for (const theme of themesToShoot) {
    console.log(`  [${tag}] Shooting ${theme}…`);
    await setTheme(page, theme);

    // Viewport screenshot
    await page.screenshot({
      path: path.join(OUT, `library-${tag}-${theme}-viewport.png`),
    });

    // Full-page screenshot
    await page.screenshot({
      path: path.join(OUT, `library-${tag}-${theme}-full.png`),
      fullPage: true,
    });

    // Scrolled-mid screenshot (scroll 50% of page height)
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    if (pageHeight > 900) {
      await page.evaluate((h) => window.scrollTo(0, Math.floor(h * 0.35)), pageHeight);
      await page.waitForTimeout(600);
      await page.screenshot({
        path: path.join(OUT, `library-${tag}-${theme}-scrolled.png`),
      });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
    }

    // Extract compositing CSS (once, in dark mode)
    if (theme === "dark") {
      compositingData[tag] = await extractCompositingCSS(page);
    }
  }

  await page.close();
  await context.close();
  return { errors, finalUrl, compositingData };
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  console.log("\n=== Desktop 1440×900 ===");
  const { errors: dErr, finalUrl, compositingData: dComp } = await shoot(
    browser, "desktop",
    { viewport: { width: 1440, height: 900 } }
  );

  console.log("\n=== Mobile Pixel 5 ===");
  const { errors: mErr, compositingData: mComp } = await shoot(
    browser, "mobile",
    { ...devices["Pixel 5"] }
  );

  await browser.close();

  console.log("\n=== Screenshots written to qa-shots/ ===");
  console.log("Final URL reached:", finalUrl);

  if (dComp.desktop && dComp.desktop.length > 0) {
    console.log("\n=== Compositing-relevant CSS (desktop dark) ===");
    for (const entry of dComp.desktop) {
      console.log("\n" + entry.selector);
      for (const [k, v] of Object.entries(entry.props)) {
        console.log(`  ${k}: ${v}`);
      }
    }
  } else {
    console.log("\n=== No compositing-suspicious CSS found on card/button elements ===");
  }

  if (dErr.length) console.log("\nDesktop console errors:\n" + dErr.slice(0, 15).join("\n"));
  if (mErr.length) console.log("\nMobile console errors:\n" + mErr.slice(0, 15).join("\n"));
})();
