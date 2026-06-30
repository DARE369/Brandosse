/* Supabase admin: impersonate user by updating their password, logging in, then restoring.
   This is safe for local dev only — we know the service role key.
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = "workspace.toolss@gmail.com";
const TEMP_PW = "QA_TempPass_2026!zX9q";
const BASE = "http://localhost:3000";
const ROUTE = "/app/library";
const OUT = path.join(process.cwd(), "qa-shots");
fs.mkdirSync(OUT, { recursive: true });

const USER_ID = "5a7f3dbd-5496-4bfa-97ed-40df115b1483";

async function adminUpdatePassword(password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${USER_ID}`, {
    method: "PUT",
    headers: {
      "apikey": SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("adminUpdatePassword failed:", res.status, JSON.stringify(data));
    return false;
  }
  console.log("Password updated for", EMAIL);
  return true;
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
      .replace(/\b(dark|light)\b/g, "").trim();
    document.documentElement.classList.add(t);
  }, theme);
  await page.waitForTimeout(900);
}

async function extractCompositingCSS(page) {
  return await page.evaluate(() => {
    const props = [
      "backdropFilter", "WebkitBackdropFilter",
      "filter", "transform", "willChange",
      "opacity", "position", "overflow",
      "isolation", "mixBlendMode", "zIndex",
    ];

    const results = [];
    const seen = new Set();

    // Target all visible elements, not just cards
    const allEls = document.querySelectorAll("*");
    for (const el of allEls) {
      const id = el.tagName + "." + (el.className || "").slice(0, 80);
      if (seen.has(id)) continue;
      seen.add(id);
      const cs = window.getComputedStyle(el);
      const entry = { selector: id, props: {}, classes: el.className };
      let interesting = false;
      for (const p of props) {
        const val = cs[p];
        entry.props[p] = val;
        if (
          (p === "backdropFilter" || p === "WebkitBackdropFilter") && val && val !== "none" ||
          (p === "filter") && val && val !== "none" ||
          (p === "transform") && val && val !== "none" && val !== "none" ||
          (p === "willChange") && val && val !== "auto" ||
          (p === "isolation") && val && val !== "auto" ||
          (p === "mixBlendMode") && val && val !== "normal"
        ) {
          interesting = true;
        }
      }
      if (interesting) results.push(entry);
    }
    return results.slice(0, 50); // cap at 50
  });
}

async function loginAndCapture(browser, tag, viewportOpts) {
  const context = await browser.newContext(viewportOpts);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  // Login
  console.log(`  [${tag}] Logging in…`);
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", TEMP_PW);
  await page.click(".auth-submit");

  try {
    await page.waitForURL((url) => !url.includes("/login"), { timeout: 20000 });
    console.log(`  [${tag}] Login succeeded! URL: ${page.url()}`);
  } catch (e) {
    const errEl = await page.locator(".auth-error").textContent().catch(() => "");
    console.error(`  [${tag}] Login failed. Error: ${errEl}`);
    await page.close();
    await context.close();
    return { errors: ["login failed: " + errEl], finalUrl: page.url() };
  }
  await page.waitForTimeout(2000);

  // Navigate to library
  console.log(`  [${tag}] Navigating to ${ROUTE}…`);
  await page.goto(BASE + ROUTE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3500);

  const finalUrl = page.url();
  console.log(`  [${tag}] Final URL: ${finalUrl}`);

  const compositingData = {};

  for (const theme of ["dark", "light"]) {
    console.log(`  [${tag}] Shooting ${theme}…`);
    await setTheme(page, theme);

    await page.screenshot({
      path: path.join(OUT, `library-${tag}-${theme}-viewport.png`),
    });
    await page.screenshot({
      path: path.join(OUT, `library-${tag}-${theme}-full.png`),
      fullPage: true,
    });

    // Scrolled view
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    if (pageHeight > 900) {
      await page.evaluate((h) => window.scrollTo(0, Math.floor(h * 0.4)), pageHeight);
      await page.waitForTimeout(700);
      await page.screenshot({
        path: path.join(OUT, `library-${tag}-${theme}-scrolled.png`),
      });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
    }

    if (theme === "dark") {
      compositingData[tag] = await extractCompositingCSS(page);
    }
  }

  await page.close();
  await context.close();
  return { errors, finalUrl, compositingData };
}

(async () => {
  // Step 1: Set temp password via admin API
  console.log("=== Step 1: Setting temp password via Supabase admin API ===");
  const set1 = await adminUpdatePassword(TEMP_PW);
  if (!set1) {
    console.error("Aborting — could not set temp password");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });

  // Step 2: Desktop screenshots
  console.log("\n=== Step 2: Desktop 1440×900 ===");
  const { errors: dErr, finalUrl, compositingData: dComp } = await loginAndCapture(
    browser, "desktop", { viewport: { width: 1440, height: 900 } }
  );

  // Step 3: Mobile screenshots
  console.log("\n=== Step 3: Mobile Pixel 5 ===");
  const { errors: mErr } = await loginAndCapture(
    browser, "mobile", { ...devices["Pixel 5"] }
  );

  await browser.close();

  console.log("\n=== Screenshots written to qa-shots/ ===");
  console.log("Final URL:", finalUrl);

  if (dComp && dComp.desktop && dComp.desktop.length > 0) {
    console.log(`\n=== Compositing-suspicious CSS found: ${dComp.desktop.length} elements ===`);
    for (const entry of dComp.desktop) {
      console.log(`\nElement: ${entry.selector.substring(0, 100)}`);
      for (const [k, v] of Object.entries(entry.props)) {
        if (v && v !== "none" && v !== "auto" && v !== "normal" && v !== "1" && v !== "0px 0px" && v !== "static") {
          console.log(`  ${k}: ${v}`);
        }
      }
    }
  } else {
    console.log("\n=== No compositing-suspicious CSS found ===");
  }

  if (dErr.length) console.log("\nDesktop errors:", dErr.slice(0, 10));
  if (mErr.length) console.log("Mobile errors:", mErr.slice(0, 10));
})();
