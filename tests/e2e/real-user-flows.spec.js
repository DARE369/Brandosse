const { test, expect } = require("@playwright/test");

/**
 * Real user-flow e2e suite for Brandosse.
 *
 * Runs on both Playwright projects (Desktop Chrome + Pixel 5 mobile) — tests are
 * viewport-aware and branch on `test.info().project.name === "mobile-chrome"`.
 *
 * Auth: defaults to the throwaway QA test account (override via env). Delete that
 * Supabase user before production; these tests are dev-only.
 *
 * Real generation calls fal.ai (costs credits, slow, flaky) — gated behind
 * E2E_RUN_GENERATION=1 so the default run is fast and deterministic.
 */

// ── Credentials (throwaway QA account; override via env) ────────────────────────
const USER_EMAIL = process.env.E2E_USER_EMAIL || "brandosse.qa@brandosse.test";
const USER_PASSWORD = process.env.E2E_USER_PASSWORD || "Brandosse-QA-2026!";
const RUN_GENERATION = process.env.E2E_RUN_GENERATION === "1";

// ── Timeouts (the app does client-side auth resolution; be generous) ───────────
const appUrlPattern = /\/app(\/dashboard)?|\/select-context|\/complete-signup/;
const REDIRECT_TIMEOUT = 90_000;
const LOGIN_HYDRATION = 60_000;
const AUTH_ERROR_TIMEOUT = 30_000;
const ROUTE_TIMEOUT = 60_000;

function isMobile() {
  return test.info().project.name === "mobile-chrome";
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
async function expectLoginPage(page) {
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible({
    timeout: LOGIN_HYDRATION,
  });
}

async function login(page, email = USER_EMAIL, password = USER_PASSWORD) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const emailInput = page.locator("#login-email");
  const passwordInput = page.locator("#login-password");
  await expect(emailInput).toBeEditable({ timeout: LOGIN_HYDRATION });
  await expect(passwordInput).toBeEditable({ timeout: LOGIN_HYDRATION });
  await emailInput.fill(email);
  await passwordInput.fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(appUrlPattern, { timeout: REDIRECT_TIMEOUT });
}

async function gotoRoute(page, path, expectedUrl) {
  await page.goto(path, { waitUntil: "commit", timeout: ROUTE_TIMEOUT });
  await expect(page).toHaveURL(expectedUrl, { timeout: ROUTE_TIMEOUT });
}

// The Brand Kit onboarding modal appears once per session when no kit is configured.
async function dismissBrandKitModalIfPresent(page) {
  const skip = page.getByRole("button", { name: "Skip for now" });
  try {
    await skip.waitFor({ state: "visible", timeout: 5_000 });
    await skip.click();
    await expect(page.locator(".bk-modal")).toHaveCount(0, { timeout: 5_000 });
  } catch {
    // Modal not shown (already skipped / kit configured) — fine.
  }
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `horizontal overflow of ${overflow}px`).toBeLessThanOrEqual(2);
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. Public + auth flows
// ════════════════════════════════════════════════════════════════════════════════
test.describe("public and auth flows", () => {
  test("landing page exposes primary auth navigation", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: "Log in" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Get started free" })).toBeVisible();
    await page.getByRole("link", { name: "Log in" }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await expectLoginPage(page);
  });

  test("invalid login fails without leaving the login page", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.locator("#login-email").fill("invalid@example.com");
    await page.locator("#login-password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".auth-error[role='alert']")).toContainText(
      /invalid|failed|confirm|timed out|not configured/i,
      { timeout: AUTH_ERROR_TIMEOUT },
    );
    await expect(page).toHaveURL(/\/login$/);
  });

  test("password reset request form is reachable", async ({ page }) => {
    await page.goto("/forgot-password", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 2. Protected-route denial
// ════════════════════════════════════════════════════════════════════════════════
test.describe("protected route denial", () => {
  test.describe.configure({ timeout: 120_000 });

  test("personal route redirects unauthenticated users to login", async ({ page }) => {
    await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: REDIRECT_TIMEOUT });
    await expectLoginPage(page);
  });

  test("admin route does not expose the admin shell to guests", async ({ page }) => {
    await page.goto("/app/admin", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: REDIRECT_TIMEOUT });
    await expectLoginPage(page);
    await expect(page.getByText("Admin Overview")).toHaveCount(0);
  });

  test("org route does not expose the workspace shell to guests", async ({ page }) => {
    await page.goto("/app/org/test-org/workspace", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: REDIRECT_TIMEOUT });
    await expectLoginPage(page);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 3. Authenticated personal "real user" journeys
// ════════════════════════════════════════════════════════════════════════════════
test.describe("authenticated personal user flows", () => {
  test.describe.configure({ timeout: 240_000 });

  test("dashboard loads with greeting, KPI cards, and primary navigation", async ({ page }) => {
    await login(page);
    await gotoRoute(page, "/app/dashboard", /\/app\/dashboard/);

    await expect(page.getByText(/Good morning|Good afternoon|Good evening/)).toBeVisible({
      timeout: ROUTE_TIMEOUT,
    });

    // KPI row renders four cards (real data or skeletons → still 4 cards).
    await expect(page.locator('[class*="StatCard-module"]').first()).toBeVisible({
      timeout: ROUTE_TIMEOUT,
    });

    // Primary navigation — every NAV_ITEMS entry, by its label. Asserting the
    // labels rather than a container class is what would have caught the drift
    // L5.7 fixed, where Analytics appeared in the nav on four pages and not the
    // other five.
    for (const label of ["Dashboard", "Studio", "Library", "Calendar", "Videos", "Analytics", "Brand Kit"]) {
      await expect(
        page.getByRole("button", { name: label, exact: true }).first(),
        `nav item "${label}" is missing`,
      ).toBeVisible({ timeout: ROUTE_TIMEOUT });
    }

    await expectNoHorizontalOverflow(page);
  });

  test("navbar Generate opens the AI Studio with a working prompt input", async ({ page }) => {
    await login(page);
    await gotoRoute(page, "/app/dashboard", /\/app\/dashboard/);

    // Real user click: the "Studio" entry in the primary nav.
    await page.getByRole("button", { name: "Studio", exact: true }).first().click();
    await expect(page).toHaveURL(/\/app\/generate/, { timeout: ROUTE_TIMEOUT });

    await dismissBrandKitModalIfPresent(page);

    const promptBox = page.locator("textarea").first();
    await expect(promptBox).toBeVisible({ timeout: ROUTE_TIMEOUT });

    // Empty prompt → both actions disabled.
    const enhance = page.getByRole("button", { name: /Enhance/i }).first();
    const generate = page.getByRole("button", { name: /^Generate/ }).first();
    await expect(enhance).toBeDisabled();
    await expect(generate).toBeDisabled();

    // Typing a prompt enables Enhance (deterministic — no credit dependency).
    await promptBox.fill("A vibrant flat-lay product photo of a ceramic coffee mug on oak");
    await expect(promptBox).toHaveValue(/coffee mug/);
    await expect(enhance).toBeEnabled();
  });

  test("primary pages load end to end", async ({ page }) => {
    await login(page);

    await gotoRoute(page, "/app/generate", /\/app\/generate/);
    await dismissBrandKitModalIfPresent(page);
    await expect(page.locator("textarea").first()).toBeVisible({ timeout: ROUTE_TIMEOUT });

    await gotoRoute(page, "/app/calendar", /\/app\/calendar/);
    await gotoRoute(page, "/app/library", /\/app\/library/);
    // The ui-v2 rebuild renamed this "Content Library" -> "Library", and renders
    // the page title as a div rather than a heading element.
    await expect(page.getByText("Library", { exact: true }).first()).toBeVisible({
      timeout: ROUTE_TIMEOUT,
    });

    await gotoRoute(page, "/app/settings", /\/app\/settings/);
    await gotoRoute(page, "/app/billing/credits", /\/app\/billing\/credits/);
    await gotoRoute(page, "/app/video/jobs", /\/app\/video\/jobs/);
  });

  // ── The nine-day blind spot ───────────────────────────────────────────────
  // The step above loads /app/video/jobs and stops there. The LIST page was
  // never the one that broke: from 2026-09-14 to 2026-09-23, opening any job
  // threw "ReferenceError: id is not defined" before first paint and showed the
  // global error boundary instead of the clip review screen. Every route check
  // in this file stayed green for all nine days, because none of them ever
  // clicked a job.
  //
  // check-undefined-identifiers.cjs now catches that specific cause statically.
  // This covers the surface: the detail page must actually render, whatever the
  // reason it might not.
  test("a video job opens to its detail page, not the error boundary", async ({ page }) => {
    await login(page);
    await gotoRoute(page, "/app/video/jobs", /\/app\/video\/jobs/);

    // Each row exposes the job through an aria-label (VideosPage.jsx:496).
    const firstJob = page.getByRole("button", { name: /^Open / }).first();
    try {
      await firstJob.waitFor({ state: "visible", timeout: 20_000 });
    } catch {
      test.skip(true, "The QA account has no video jobs, so the detail page cannot be exercised.");
      return;
    }

    await firstJob.click();
    await expect(page).toHaveURL(/\/app\/video\/jobs\/[0-9a-f-]{36}/, { timeout: ROUTE_TIMEOUT });

    // app/global-error.tsx — the screen the ReferenceError produced. Asserted
    // first and by its own copy, so a regression names itself in the failure.
    await expect(page.getByText("This has been reported automatically.")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);

    // And the page reached its own content, rather than merely avoiding a crash:
    // the job chip is rendered by JobView, the component that was throwing
    // (VideoJobPage.jsx:585). A fetch failure renders VideoJobBody's empty state
    // instead and would not satisfy this.
    await expect(page.getByText(/^JOB [0-9a-f]{6}$/).first()).toBeVisible({
      timeout: ROUTE_TIMEOUT,
    });
  });

  test("logout returns to login and re-protects routes", async ({ page }) => {
    await login(page);
    await gotoRoute(page, "/app/dashboard", /\/app\/dashboard/);

    // Sign out lives behind the avatar menu since the ui-v2 shell landed.
    await page.locator('[class*="AvatarMenu-module__"][class*="avatar"]').first().click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(/\/login|^\/$|\/$/, { timeout: REDIRECT_TIMEOUT });

    // Session is gone — a protected route now redirects back to login.
    await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: REDIRECT_TIMEOUT });
    await expectLoginPage(page);
  });

  test("opt-in: full image generation produces a result", async ({ page }) => {
    test.skip(!RUN_GENERATION, "Set E2E_RUN_GENERATION=1 to run real fal.ai generation (costs credits).");
    test.setTimeout(300_000);

    await login(page);
    await gotoRoute(page, "/app/generate", /\/app\/generate/);
    await dismissBrandKitModalIfPresent(page);

    const promptBox = page.locator(".studio-bar__textarea");
    await expect(promptBox).toBeVisible({ timeout: ROUTE_TIMEOUT });
    await promptBox.fill("Minimalist product photo of a matte black water bottle, soft studio light");

    const generateBtn = page.locator(".studio-bar__generate");
    await expect(generateBtn).toBeEnabled({ timeout: ROUTE_TIMEOUT });
    await generateBtn.click();

    // A result card appears once generation completes (long, external).
    await expect(page.locator(".studio-card").first()).toBeVisible({ timeout: 240_000 });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 4. Mobile-native checks (only on the Pixel 5 project)
// ════════════════════════════════════════════════════════════════════════════════
test.describe("mobile-native shell", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(() => {
    test.skip(!isMobile(), "Mobile-only checks run on the mobile-chrome project.");
  });

  test("bottom tab bar shows the primary destinations and content has no overflow", async ({ page }) => {
    await login(page);
    await gotoRoute(page, "/app/dashboard", /\/app\/dashboard/);

    // Bottom tab bar = primary nav items (the collision fix restored all 5).
    const primaryTabs = page.locator('.app-sidebar .sidebar-nav-item[data-mobile-nav="primary"]');
    expect(await primaryTabs.count()).toBeGreaterThanOrEqual(5);

    await expectNoHorizontalOverflow(page);

    // Generate page is also overflow-free on mobile.
    await gotoRoute(page, "/app/generate", /\/app\/generate/);
    await dismissBrandKitModalIfPresent(page);
    await expectNoHorizontalOverflow(page);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 5. Admin / org flows (opt-in via env — separate accounts)
// ════════════════════════════════════════════════════════════════════════════════
test.describe("authenticated admin flows", () => {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  test.skip(!email || !password, "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run admin flows.");

  test("admin can open primary admin surfaces", async ({ page }) => {
    await login(page, email, password);
    await page.goto("/app/admin", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/app\/admin/);
    for (const path of [
      "/app/admin/users", "/app/admin/accounts", "/app/admin/organizations",
      "/app/admin/moderation", "/app/admin/complaints", "/app/admin/logs",
      "/app/admin/analytics", "/app/admin/settings",
    ]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});

test.describe("authenticated org flows", () => {
  const email = process.env.E2E_ORG_EMAIL;
  const password = process.env.E2E_ORG_PASSWORD;
  const orgId = process.env.E2E_ORG_ID;
  test.skip(!email || !password || !orgId, "Set E2E_ORG_EMAIL, E2E_ORG_PASSWORD, and E2E_ORG_ID to run org flows.");

  test("org user can open member org surfaces", async ({ page }) => {
    await login(page, email, password);
    for (const path of [
      `/app/org/${orgId}/workspace`, `/app/org/${orgId}/office`, `/app/org/${orgId}/pipeline`,
      `/app/org/${orgId}/calendar`, `/app/org/${orgId}/library`, `/app/org/${orgId}/common-room`,
      `/app/org/${orgId}/team-activity`,
    ]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});
