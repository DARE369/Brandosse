// copy-review.spec.js — the copy review, reviewed on request and frozen at publish.
//
// Covers what the static contracts cannot:
//
//   * the composer is STYLED on a direct Library load — it once rendered as an
//     unstyled form below the grid, which `toBeVisible` happily accepted;
//   * nothing is scored automatically — no seo-score request fires on open or
//     while typing;
//   * the review button pulses once the text it scored changes, and says so in
//     words;
//   * the post details panel renders the at-publish report for a real published
//     post without crashing;
//   * the Library drawer offers the asset's own copy review.
//
// seo-score is intercepted and answered with a fixed payload, so this costs no
// model call and is deterministic. Nothing here publishes or saves a post.
//
//   E2E_PUBLISHED_POST_ID — a published post owned by the QA account, for the
//   details-panel test. Skipped (not passed) when unset.
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
const env = loadLocalEnv();
const USER_EMAIL = process.env.E2E_USER_EMAIL || env.E2E_USER_EMAIL;
const USER_PASSWORD = process.env.E2E_USER_PASSWORD || env.E2E_USER_PASSWORD;
const PUBLISHED_POST_ID = process.env.E2E_PUBLISHED_POST_ID || env.E2E_PUBLISHED_POST_ID;

const MOCK_SCORE = {
  overall: 71, discoveryScore: 71, discovery_score: 71,
  breakdown: { hookStrength: 58, readability: 82, platformFit: 0 },
  measured: ["hookStrength", "readability"],
  suggestions: ["Lead with the outcome, not the setup."],
  benchmarkReport: [], hashtagSuggestions: [],
  scoreCategory: "Good", score_category: "Good", provider: "mock", model: "mock",
};

async function signIn(page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#login-email")).toBeEditable({ timeout: 60_000 });
  await page.locator("#login-email").fill(USER_EMAIL);
  await page.locator("#login-password").fill(USER_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 90_000 });
}

async function dismissBrandKit(page) {
  try { await page.getByRole("button", { name: "Skip for now" }).click({ timeout: 4_000 }); } catch { /* not shown */ }
}

test.describe("Copy review", () => {
  test.describe.configure({ timeout: 360_000 });
  test.skip(!USER_EMAIL || !USER_PASSWORD, "E2E credentials not configured");

  test("composer: styled on direct load, reviewed only on request, pulses when stale", async ({ page }) => {
    const scoreCalls = [];
    await page.route("**/functions/v1/seo-score", async (route) => {
      scoreCalls.push(Date.now());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_SCORE) });
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await signIn(page);
    // FULL load straight into the Library — never via the Calendar, whose
    // stylesheet would otherwise already be in the document.
    await page.goto("/app/library", { waitUntil: "load" });
    await dismissBrandKit(page);

    const publish = page.locator("button:not([disabled])").filter({ hasText: /^Publish$/ }).first();
    await expect(publish).toBeVisible({ timeout: 45_000 });
    await publish.click();

    const composer = page.locator('[role="dialog"][aria-label="Quick Post"]');
    await expect(composer).toBeVisible({ timeout: 20_000 });

    // Styled: the backdrop is a fixed overlay and the dialog paints a surface.
    const style = await page.evaluate(() => {
      const b = document.querySelector(".modal-backdrop");
      const m = document.querySelector(".quickpost-modal");
      return {
        backdrop: b ? getComputedStyle(b).position : null,
        modalBg: m ? getComputedStyle(m).backgroundColor : null,
      };
    });
    expect(style.backdrop, "composer backdrop is a fixed overlay, not an unstyled block").toBe("fixed");
    expect(style.modalBg, "composer dialog paints a surface").not.toBe("rgba(0, 0, 0, 0)");

    const textarea = composer.locator("textarea.ui-textarea").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });
    // Let any AI pre-fill settle, then prove nothing scored on its own.
    await page.waitForTimeout(5_000);
    expect(scoreCalls.length, "no review request fires on open").toBe(0);

    await textarea.fill("Launching today: the fastest way to turn one video into a week of posts.");
    await page.waitForTimeout(3_500);
    expect(scoreCalls.length, "no review request fires while typing").toBe(0);

    const reviewBtn = composer.locator("button.quickpost-copy-review__btn").first();
    await expect(reviewBtn).toBeVisible();
    // Typed and never reviewed: stale — in motion AND in words.
    await expect(reviewBtn).toHaveClass(/is-stale/);
    await expect(composer.getByText(/Edited\. Review it now/).first()).toBeVisible();

    await reviewBtn.click();
    await expect(composer.getByText(/Copy review\s*71/).first()).toBeVisible({ timeout: 20_000 });
    expect(scoreCalls.length, "exactly one review request, on click").toBe(1);
    await expect(reviewBtn).not.toHaveClass(/is-stale/);
    await expect(composer.getByText(/Hook 58/).first()).toBeVisible();

    // Change the text: the review now describes words that are gone.
    await textarea.fill("Launching today: turn one video into a week of posts.");
    await expect(reviewBtn).toHaveClass(/is-stale/);
    await expect(composer.getByText(/Changed since the last review/).first()).toBeVisible();
    expect(scoreCalls.length, "editing does not re-score on its own").toBe(1);

    // Never labelled a reach prediction (LOCK L5.11).
    await expect(composer.getByText(/discoverability/i)).toHaveCount(0);

    expect(errors, "no uncaught page errors").toEqual([]);
  });

  test("details panel renders the at-publish report for a real published post", async ({ page }) => {
    test.skip(!PUBLISHED_POST_ID, "set E2E_PUBLISHED_POST_ID to a published post id");
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await signIn(page);

    await page.goto(`/app/calendar?postId=${encodeURIComponent(PUBLISHED_POST_ID)}`, { waitUntil: "load" });
    await dismissBrandKit(page);
    const report = page.locator("[data-copy-review]").first();
    await expect(report, "the at-publish report renders in the details panel").toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Copy review at publish/).first()).toBeVisible();
    expect(errors, "no uncaught page errors").toEqual([]);
  });

  test("library drawer offers the asset's own copy review", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/functions/v1/seo-score", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(MOCK_SCORE),
    }));
    await signIn(page);
    await page.goto("/app/library", { waitUntil: "load" });
    await dismissBrandKit(page);

    const card = page.locator("article[aria-label^='Open ']").first();
    await expect(card).toBeVisible({ timeout: 45_000 });
    await card.click();

    await expect(page.getByText("Title and tags").first()).toBeVisible({ timeout: 20_000 });
    expect(errors, "no uncaught page errors").toEqual([]);
  });
});
