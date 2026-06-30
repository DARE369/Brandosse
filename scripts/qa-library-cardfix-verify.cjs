/* QA harness — Library asset-card CSS bugfix verification (Packet 2 round 2).
   Logs in with real credentials, navigates to /app/library, finds asset
   cards in the grid, screenshots the grid + a zoomed crop of the first few
   cards, and dumps computed styles for .asset-card__media /
   .asset-card__source-badge / .asset-card__meta-row so we can confirm in
   text (not just visually) that the fix landed: media container is sized
   and contained, source badge sits inside it (not overlapping the fallback
   icon), and the meta-row has a real gap between its two spans.
*/
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = "http://localhost:3000";
const EMAIL = "brandosse.qa@brandosse.test";
const TEMP_PW = "QA_TempPass_2026!zX9q";
const USER_ID = "c514fd6a-1f46-4c19-8b7c-7152d1070658";
const ROUTE = "/app/library";
const OUT = path.join(process.cwd(), "qa-shots");
fs.mkdirSync(OUT, { recursive: true });

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

async function login(page) {
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", TEMP_PW);
  await page.click(".auth-submit");
  try {
    await page.waitForURL((url) => !url.includes("/login"), { timeout: 30000 });
  } catch (e) {
    console.log("  Login redirect timeout — current URL:", page.url());
  }
  await page.waitForTimeout(2000);
}

(async () => {
  const pwSet = await adminUpdatePassword(TEMP_PW);
  if (!pwSet) {
    console.error("Aborting — could not set temp password via admin API");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  await login(page);

  console.log("Navigating to", ROUTE);
  await page.goto(BASE + ROUTE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);
  console.log("Final URL:", page.url());

  // Force dark theme for consistency with prior shots.
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.classList.add("dark");
  });
  await page.waitForTimeout(500);

  await page.waitForSelector(".asset-card", { timeout: 15000 }).catch(() => {});
  const cardCount = await page.locator(".asset-card").count();
  console.log("asset-card count on page:", cardCount);

  if (cardCount === 0) {
    console.log("No .asset-card elements found — check route/auth/empty-state.");
    await page.screenshot({ path: path.join(OUT, "cardfix-noresults.png"), fullPage: true });
  } else {
    // Full grid screenshot.
    await page.screenshot({ path: path.join(OUT, "cardfix-grid-full.png"), fullPage: true });

    // Inspect every visible card's computed styles + whether it has a real
    // thumbnail (img/video inside .asset-card__media) vs fallback icon.
    const cardData = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".asset-card"));
      return cards.slice(0, 12).map((card, i) => {
        const media = card.querySelector(".asset-card__media");
        const badge = card.querySelector(".asset-card__source-badge");
        const fallback = card.querySelector(".asset-card__media-fallback");
        const img = card.querySelector(".asset-card__media img, .asset-card__media video");
        const metaRow = card.querySelector(".asset-card__meta-row");
        const metaSpans = metaRow ? Array.from(metaRow.querySelectorAll("span")).map((s) => s.textContent) : [];

        const mediaRect = media ? media.getBoundingClientRect() : null;
        const badgeRect = badge ? badge.getBoundingClientRect() : null;
        const mediaCS = media ? window.getComputedStyle(media) : null;
        const metaCS = metaRow ? window.getComputedStyle(metaRow) : null;

        return {
          index: i,
          hasRealThumb: Boolean(img),
          hasFallback: Boolean(fallback),
          mediaPosition: mediaCS ? mediaCS.position : null,
          mediaAspectRatio: mediaCS ? mediaCS.aspectRatio : null,
          mediaOverflow: mediaCS ? mediaCS.overflow : null,
          mediaRect: mediaRect ? { w: Math.round(mediaRect.width), h: Math.round(mediaRect.height) } : null,
          badgeRect: badgeRect ? { top: Math.round(badgeRect.top - (mediaRect?.top || 0)), left: Math.round(badgeRect.left - (mediaRect?.left || 0)) } : null,
          badgeInsideMedia: mediaRect && badgeRect
            ? (badgeRect.top >= mediaRect.top - 1 && badgeRect.left >= mediaRect.left - 1 && badgeRect.bottom <= mediaRect.bottom + 1)
            : null,
          metaRowGap: metaCS ? metaCS.gap : null,
          metaRowJustify: metaCS ? metaCS.justifyContent : null,
          metaSpans,
        };
      });
    });

    console.log("\n=== Per-card computed style / structure check ===");
    console.log(JSON.stringify(cardData, null, 2));

    // Find one card with a real thumbnail (if any) and one fallback card,
    // screenshot each zoomed in.
    const withThumb = cardData.find((c) => c.hasRealThumb);
    const withFallback = cardData.find((c) => c.hasFallback);

    if (withThumb) {
      const el = page.locator(".asset-card").nth(withThumb.index);
      await el.screenshot({ path: path.join(OUT, `cardfix-real-thumb-card-${withThumb.index}.png`) });
      console.log(`\nScreenshotted REAL-THUMBNAIL card at index ${withThumb.index} -> cardfix-real-thumb-card-${withThumb.index}.png`);
    } else {
      console.log("\nNo card with a real thumbnail (img/video) found among first 12 — all fallback icons (expected per data-layer note).");
    }

    if (withFallback) {
      const el = page.locator(".asset-card").nth(withFallback.index);
      await el.screenshot({ path: path.join(OUT, `cardfix-fallback-card-${withFallback.index}.png`) });
      console.log(`Screenshotted FALLBACK-ICON card at index ${withFallback.index} -> cardfix-fallback-card-${withFallback.index}.png`);
    }

    // Zoomed crop of first 4 cards together for an easy human-readable view.
    const gridLocator = page.locator(".library-grid").first();
    if (await gridLocator.count() > 0) {
      await gridLocator.screenshot({ path: path.join(OUT, "cardfix-grid-crop.png") });
    }
  }

  if (consoleErrors.length) {
    console.log("\nConsole errors:\n" + consoleErrors.slice(0, 15).join("\n"));
  }

  await browser.close();
})();
