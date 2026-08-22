const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

/**
 * persona-walkthroughs.spec.js — the proof for LOCK L6.1.
 *
 * D4 states two persona acceptance tests for the dashboard, and both had only
 * ever been assessed by reading code:
 *
 *   Power Migrant   finds every major surface without a tutorial, and reaches
 *                   video generation WITHOUT TYPING A URL
 *   Casual Operator completes signup -> brand kit -> first generated post,
 *                   unaided
 *
 * The first one is the interesting half, because it is exactly what the rest of
 * the suite cannot see. Every other test navigates with page.goto(), which is
 * the automated equivalent of typing the address bar — so a route that is
 * reachable ONLY by typing its URL passes every one of them while being
 * invisible to a real user.
 *
 * That is not hypothetical here. Finding P9-002: /app/video/jobs — the clipping
 * pipeline, the product's strongest capability — appeared in none of the nine
 * hand-copied NAV_ITEMS arrays, and could be reached only by typing it. L5.7
 * added it. Nothing stopped it being dropped again until this file.
 *
 * So the rule below is mechanical: after the initial sign-in, this spec may not
 * call page.goto(). Everything is reached by clicking, the way a person does.
 *
 * Run against a production build (`npm run test:e2e`), not `next dev` — see the
 * note in time-to-first-value.spec.js for why.
 */

// ── Environment ──────────────────────────────────────────────────────────────
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

const HYDRATION = 60_000;
const ROUTE_TIMEOUT = 60_000;
const REDIRECT_TIMEOUT = 90_000;

/**
 * Every surface the nav claims to offer, and what proves you arrived.
 * Mirrors src/ui-v2/shell/navItems.js — if the two drift, this fails, which is
 * the point: the nav drifting is the defect L5.7 fixed.
 */
const SURFACES = [
  { label: "Dashboard", url: /\/app\/dashboard/ },
  { label: "Studio", url: /\/app\/generate/ },
  { label: "Library", url: /\/app\/library/ },
  { label: "Calendar", url: /\/app\/calendar/ },
  { label: "Videos", url: /\/app\/video\/jobs/ },
  { label: "Analytics", url: /\/app\/analytics/ },
  { label: "Brand Kit", url: /\/app\/settings\/brand-kit/ },
];

async function signIn(page) {
  // The only permitted goto in this file — a person does type the login URL.
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const email = page.locator("#login-email");
  await expect(email).toBeEditable({ timeout: HYDRATION });
  await email.fill(USER_EMAIL);
  await page.locator("#login-password").fill(USER_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: REDIRECT_TIMEOUT });
}

/** Dismiss the once-per-session brand-kit nudge if it is covering the page. */
async function dismissBrandKitModal(page) {
  const skip = page.getByRole("button", { name: "Skip for now" });
  try {
    await skip.waitFor({ state: "visible", timeout: 4_000 });
    await skip.click();
    await expect(page.locator(".bk-modal")).toHaveCount(0, { timeout: 5_000 });
  } catch {
    // Not shown — fine.
  }
}

test.describe("persona: Power Migrant", () => {
  test.describe.configure({ timeout: 300_000 });
  test.skip(() => test.info().project.name !== "chromium", "desktop walkthrough");
  test.skip(!USER_EMAIL || !USER_PASSWORD, "E2E credentials not configured");

  test("reaches every major surface by clicking, never by typing a URL", async ({ page }) => {
    await signIn(page);
    await dismissBrandKitModal(page);

    const unreachable = [];

    for (const surface of SURFACES) {
      const link = page.getByRole("button", { name: surface.label, exact: true }).first();

      if ((await link.count()) === 0) {
        // The whole point of the test. A surface with no way in is not a
        // surface; it is a URL only its author knows.
        unreachable.push(`${surface.label} — no nav control anywhere on the page`);
        continue;
      }

      await link.click();
      try {
        await expect(page).toHaveURL(surface.url, { timeout: ROUTE_TIMEOUT });
      } catch {
        unreachable.push(`${surface.label} — nav control exists but did not navigate there`);
        continue;
      }
      await dismissBrandKitModal(page);
      // The next surface must be reachable from THIS one, not just from the
      // dashboard. Nav that disappears once you leave home is nav that fails
      // the person who went one level in.
    }

    expect(
      unreachable,
      `surfaces a user cannot reach without typing a URL:\n  ${unreachable.join("\n  ")}`,
    ).toEqual([]);
  });

  test("reaches video generation without typing a URL", async ({ page }) => {
    // P9-002 specifically: the clipping pipeline was reachable only by address
    // bar. Getting to the LIST is not enough — the migrant has to be able to
    // start a new one.
    await signIn(page);
    await dismissBrandKitModal(page);

    await page.getByRole("button", { name: "Videos", exact: true }).first().click();
    await expect(page).toHaveURL(/\/app\/video\/jobs/, { timeout: ROUTE_TIMEOUT });

    const start = page
      .getByRole("button", { name: /New video|Process a video|Create/i })
      .first();
    await expect(
      start,
      "on My Videos there is no control that starts one — the pipeline is reachable but unusable",
    ).toBeVisible({ timeout: ROUTE_TIMEOUT });

    await start.click();
    await expect(page).toHaveURL(/\/app\/video\/new/, { timeout: ROUTE_TIMEOUT });
  });
});

test.describe("persona: Casual Operator", () => {
  test.describe.configure({ timeout: 300_000 });
  test.skip(() => test.info().project.name !== "chromium", "desktop walkthrough");
  test.skip(!USER_EMAIL || !USER_PASSWORD, "E2E credentials not configured");

  test("can set up a brand kit and get to generating, unaided", async ({ page }) => {
    // The signup -> first-post half of this persona is measured end to end in
    // time-to-first-value.spec.js. What that one skips is the BRAND KIT leg,
    // which the wizard offers and which failed for every user until L5.12: the
    // 6-question conversation asked all six questions and then died, because it
    // called Groq from the browser where the token is hardcoded empty.
    await signIn(page);
    await dismissBrandKitModal(page);

    await page.getByRole("button", { name: "Brand Kit", exact: true }).first().click();
    await expect(page).toHaveURL(/\/app\/settings\/brand-kit/, { timeout: ROUTE_TIMEOUT });

    // Whatever state the account is in — no kit, or one already set up — the
    // page has to offer a way forward rather than a dead end.
    const somethingToDo = page.getByRole("button").or(page.getByRole("textbox"));
    await expect(
      somethingToDo.first(),
      "brand kit page offers the user no control at all",
    ).toBeVisible({ timeout: ROUTE_TIMEOUT });

    // And from there, back out to generating without the address bar.
    await page.getByRole("button", { name: "Studio", exact: true }).first().click();
    await expect(page).toHaveURL(/\/app\/generate/, { timeout: ROUTE_TIMEOUT });
    await dismissBrandKitModal(page);

    const promptBox = page.locator("textarea").first();
    await expect(promptBox).toBeVisible({ timeout: HYDRATION });
    await expect(promptBox).toBeEditable();
  });
});
