// library-publish-composer.spec.js — Phase 2: the Library->Publish composer.
//
// Covers what the static contract check CANNOT: that the composer actually
// renders, that its options panels do not re-enter their own emit effect, and
// that they theme correctly in both themes. Both defects this caught were
// invisible to `next build` and to every guard script.
//
// Rewritten 2026-09-15. The first version dumped screenshots and returned
// without assertions, so it "passed" while proving nothing — and its one HTML
// dump captured `[role="dialog"].first()`, which is the Library's "Filter
// Library" bottom sheet, not the composer. This version targets the composer by
// its own aria-label and ASSERTS.
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

function loadLocalEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return out;
}
const localEnv = loadLocalEnv();
const USER_EMAIL = process.env.E2E_USER_EMAIL || localEnv.E2E_USER_EMAIL;
const USER_PASSWORD = process.env.E2E_USER_PASSWORD || localEnv.E2E_USER_PASSWORD;

const SHOT_DIR = path.join(
  "C:\\Users\\Dare\\AppData\\Local\\Temp\\claude\\c--Users-Dare-Desktop-social-media-agent---Copy\\a09c8d5d-58b4-4ff3-85d8-bd1654770a63\\scratchpad",
  "library-publish-qa2"
);
fs.mkdirSync(SHOT_DIR, { recursive: true });

async function signIn(page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const email = page.locator("#login-email");
  await expect(email).toBeEditable({ timeout: 60_000 });
  await email.fill(USER_EMAIL);
  await page.locator("#login-password").fill(USER_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 90_000 });
}

async function dismissBrandKitModal(page) {
  const skip = page.getByRole("button", { name: "Skip for now" });
  try {
    await skip.waitFor({ state: "visible", timeout: 4_000 });
    await skip.click();
  } catch { /* not shown */ }
}

// The --uiv2-* tokens are scoped to [data-uiv2-theme], stamped by
// UiV2ThemeProvider, which reads localStorage key "uiv2-theme"
// (src/ui-v2/ThemeProvider.jsx:6). Setting only "app-theme-preference" flipped
// the LEGACY token system, producing a light page body with ui-v2 still dark —
// and the panel then measured near-black on white, which reads exactly like the
// undefined-token defect but is a state the real toggle cannot produce. Set
// both, so the measurement is of the app rather than of the test.
async function setTheme(page, theme) {
  await page.evaluate((t) => {
    try {
      localStorage.setItem("uiv2-theme", t);
      localStorage.setItem("app-theme-preference", t);
    } catch {}
  }, theme);
  await page.reload({ waitUntil: "domcontentloaded" });
}

// sRGB relative luminance, so "is this panel dark on a light page" is measured
// rather than eyeballed from a screenshot.
function luminance(rgbString) {
  const m = /rgba?\(([^)]+)\)/.exec(rgbString || "");
  if (!m) return null;
  const [r, g, b] = m[1].split(",").slice(0, 3).map((v) => {
    const c = parseFloat(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

for (const themeName of ["light", "dark"]) {
  test.describe(`Phase 2 composer (${themeName})`, () => {
    test.describe.configure({ timeout: 420_000 });
    test.skip(!USER_EMAIL || !USER_PASSWORD, "E2E credentials not configured");

    test(`composer renders and collects required fields [${themeName}]`, async ({ page }, testInfo) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource/.test(m.text())) {
          errors.push(`[console.error] ${m.text()}`);
        }
      });

      await signIn(page);
      await dismissBrandKitModal(page);
      await setTheme(page, themeName);
      await dismissBrandKitModal(page);
      await page.goto("/app/library", { waitUntil: "domcontentloaded" });
      await dismissBrandKitModal(page);
      await page.waitForTimeout(1500);

      // Wait for the Library to actually LOAD before counting buttons. A fixed
      // sleep raced it: on a slower pass every rail read "All 0" and the count
      // was legitimately zero, which looks exactly like "no asset is
      // publishable" and is a completely different finding. Poll instead.
      const publishBtn = page.locator("button:not([disabled])")
        .filter({ hasText: /^Publish$/ }).first();
      // B — the composer must open IN PLACE, not navigate away.
      await expect
        .poll(async () => publishBtn.count(), {
          message: "an enabled Publish button appears once the Library loads",
          // Generous on purpose: this repo's dev machine runs a near-full disk and
          // Turbopack compiles the route on first hit, so the grid can take well
          // over a minute to paint 130+ assets. A tight timeout here fails as
          // "nothing is publishable", which is a product claim this has no basis
          // to make.
          timeout: 150_000,
        })
        .toBeGreaterThan(0);
      const urlBefore = page.url();
      await publishBtn.click();

      // A — the composer's OWN dialog, by aria-label. Not [role=dialog].first(),
      // which is the Library's filter sheet.
      const composer = page.locator('[role="dialog"][aria-label="Quick Post"]');
      await expect(composer, "the composer dialog renders").toBeVisible({ timeout: 15_000 });
      expect(page.url(), "opening the composer must not navigate").toBe(urlBefore);

      // Turn YouTube on so its required-field panel mounts.
      // Record what the composer is actually OFFERING. "hasYouTube: false" on
      // its own is ambiguous — it could mean the chip failed to render, or that
      // this account has no publishable YouTube connection. Those are very
      // different findings and the report must not conflate them.
      // The capability lookup (connected_accounts_health_summary) is async, so
      // WAIT for the chip rather than sleeping at it. A fixed 2.5s pause raced
      // it and reported the offered platforms as just [On, Off] — the
      // AI-disclosure buttons, which reuse the .platform-toggle class — which
      // reads identically to "YouTube is not connected" and is not the same
      // finding at all.
      const ytChip = composer.locator("button.platform-toggle").filter({ hasText: /^YouTube$/ }).first();
      await ytChip.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});

      const offeredChips = await composer.locator("button.platform-toggle").allInnerTexts();
      const hintText = await composer.locator(".quickpost-hint").allInnerTexts();
      const hasYouTube = (await ytChip.count()) > 0;

      // Fail rather than skip. Every required-field assertion below is gated on
      // YouTube being offered, so if the QA account ever loses that connection
      // this spec would go on passing while proving nothing — a guard aimed at
      // nothing, which is worse than no guard because it stops anyone looking.
      // If this fails, reconnect YouTube on the QA account; do not soften it.
      expect(
        hasYouTube,
        `the QA account must have a publishable YouTube connection for this spec to prove anything. `
        + `Composer offered: [${(await composer.locator("button.platform-toggle").allInnerTexts()).join(", ")}]`,
      ).toBe(true);

      await ytChip.click();
      await page.waitForTimeout(800);

      const report = { theme: themeName, hasYouTube, offeredChips, hintText, errors };

      if (hasYouTube) {
        // C — the shared YouTube panel mounts…
        await expect(
          composer.getByText("Is this video made for kids?", { exact: false }).first(),
          "the shared YouTube options panel mounted",
        ).toBeVisible({ timeout: 10_000 });

        // …and its OWN synthetic-media checkbox must be GONE, because the single
        // "Declare AI-generated media" control above now owns that declaration.
        const ownCheckbox = composer.getByText("realistic altered or AI-generated content", { exact: false });
        report.youtubeOwnSyntheticCheckboxCount = await ownCheckbox.count();
        expect(
          report.youtubeOwnSyntheticCheckboxCount,
          "YouTube panel must NOT render its own synthetic-media checkbox when controlled",
        ).toBe(0);

        // …and the single AI-disclosure control must be present exactly once.
        report.aiDisclosureCount = await composer.getByText("Declare AI-generated media").count();
        expect(report.aiDisclosureCount, "exactly one AI-disclosure control").toBe(1);

        // F — a real, separate YouTube title field.
        await expect(
          composer.getByLabel("YouTube title"),
          "YouTube title input renders",
        ).toBeVisible();

        // D — measure the panel's background against the page's. In light theme
        // the panel must not be dark: that was the undefined-token defect.
        const panelBg = await composer.locator('[data-account]').first()
          .evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => null);
        const pageBg = await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor);
        report.panelBg = panelBg;
        report.pageBg = pageBg;
        const lp = luminance(panelBg);
        const lb = luminance(pageBg);
        report.panelLuminance = lp;
        report.pageLuminance = lb;
        if (lp !== null && lb !== null) {
          // Not "identical" — elevated surfaces legitimately differ. But a panel
          // on the opposite side of mid-grey from its page is the defect.
          expect(
            Math.abs(lp - lb) < 0.5,
            `panel bg ${panelBg} (lum ${lp?.toFixed(3)}) vs page bg ${pageBg} (lum ${lb?.toFixed(3)})`,
          ).toBe(true);
        }

        // E — Publish now stays disabled until made-for-kids is answered.
        const publishNow = composer.getByRole("button", { name: "Publish now", exact: true });
        await expect(publishNow, "Publish now button exists").toBeVisible();
        report.disabledBeforeAnswer = await publishNow.isDisabled();
        expect(report.disabledBeforeAnswer, "Publish now disabled before the COPPA answer").toBe(true);

        await composer.getByText("No, it's not made for kids", { exact: false }).first().click();
        await composer.getByLabel("YouTube title").fill("Phase 2 verification title");
        await page.waitForTimeout(600);
        report.disabledAfterAnswer = await publishNow.isDisabled();
      }

      await page.screenshot({
        path: path.join(SHOT_DIR, `composer-${testInfo.project.name}-${themeName}.png`),
        fullPage: true,
      });
      fs.writeFileSync(
        path.join(SHOT_DIR, `report-${testInfo.project.name}-${themeName}.json`),
        JSON.stringify(report, null, 2),
      );

      expect(errors, "no uncaught page errors or React errors").toEqual([]);
    });
  });
}
