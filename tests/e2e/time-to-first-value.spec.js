const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

/**
 * time-to-first-value.spec.js — the proof for LOCK L5.15.
 *
 * DoC-9 sets one number for onboarding: "Time-to-first-value ≤5 minutes for a
 * new signup", with the Casual Operator persona test "completes signup → brand
 * kit → first generated post unaided".
 *
 * Every other test in this repo signs in as an account that already has data.
 * That account can never catch what this one is for, because the defects on the
 * first-run path are only visible to an account that has nothing:
 *
 *   · the onboarding wizard being unreachable (209 lines that render for nobody)
 *   · empty states with no way forward — 15 of 19 when the audit ran
 *   · a signup page promising 100 credits over a database that grants 30
 *
 * So this registers a REAL, genuinely-empty account every run and walks the
 * path a stranger walks. It is slow and it creates data, which is the price of
 * being the only test that sees what a new user sees.
 *
 * The account is deleted at the end when a service-role key is available; if
 * one is not, the test still passes and tells you what to clean up. Test
 * accounts are named `ttfv+<timestamp>@brandosse-qa.dev` so a leftover is
 * always identifiable.
 *
 * Generation costs real money at fal.ai, so — following the convention already
 * in real-user-flows.spec.js — the default run measures up to "Studio, loaded,
 * prompt seeded, ready to generate" and E2E_RUN_GENERATION=1 measures all the
 * way to a finished post. Both are reported against the same 5-minute bar.
 *
 * ── Run this against a production build, not `next dev` ──────────────────────
 * `npm run test:e2e` already does the right thing: it starts `next start` on
 * 3001. Pointing it at a dev server instead makes the wizard → Studio handoff
 * assertion fail, and the failure is an artefact, not a defect.
 *
 * next.config.mjs sets reactStrictMode, so in dev React mounts the tree, throws
 * that mount away, and mounts again. The seeded prompt does not survive that:
 * the first mount consumes the one-shot seed out of SessionStore and writes it
 * to local state, the remount discards that local state, and by then the seed
 * is gone. Verified 2026-08-22 — identical walk, dev returned an empty prompt
 * box, `next start` returned the seeded text.
 *
 * Left as-is rather than hardened: the behaviour users get is correct, and
 * rewriting the store's consume-once contract to survive a dev-only remount is
 * new work, not completion work. Recorded so the next person does not spend the
 * afternoon debugging a phantom, as this one did.
 */

// ── Environment ──────────────────────────────────────────────────────────────
// The Playwright runner does not load .env.local (it shells out to `next start`,
// which loads it for the server only). Read it here so the test can reach
// Supabase directly for setup assertions and cleanup.
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
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || localEnv.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || localEnv.SUPABASE_SERVICE_ROLE_KEY;

// Kept in step with src/constants/credits.js. scripts/check-credit-grant.cjs
// holds the constant to the migration; this holds the running system to the
// constant. Read from source so there is still exactly one number.
function declaredSignupGrant() {
  const source = fs.readFileSync(path.join(process.cwd(), "src/constants/credits.js"), "utf8");
  const match = /export const SIGNUP_CREDIT_GRANT\s*=\s*(\d+)/.exec(source);
  return match ? Number(match[1]) : null;
}

// ── The bar ──────────────────────────────────────────────────────────────────
const TTFV_BUDGET_MS = 5 * 60 * 1000;
const RUN_GENERATION = process.env.E2E_RUN_GENERATION === "1";

const REDIRECT_TIMEOUT = 90_000;
const HYDRATION = 60_000;
const ROUTE_TIMEOUT = 60_000;

function newAccount() {
  // Date.now() is fine here — this is a test, not a workflow script.
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return { email: `ttfv+${stamp}@brandosse-qa.dev`, password: `Ttfv-Probe-${stamp}!` };
}

/**
 * Delete the account this run created, along with whatever it produced.
 *
 * Deleting a user that owns content fails outright: 56 of the 96 foreign keys
 * to auth.users in this schema have no ON DELETE CASCADE, so Postgres raises
 * 23503 and the whole delete is refused. Running with E2E_RUN_GENERATION=1
 * always trips it, because by then the account owns a post.
 *
 * Rather than hardcode a list of tables — which silently goes stale the moment
 * a new one is added — this reads the offending table out of the error and
 * clears it, then retries. Whatever is actually blocking the delete gets named
 * and removed, and the loop is bounded so a genuine failure still surfaces.
 */
async function deleteAccount(userId) {
  if (!SERVICE_KEY || !userId) return false;
  const auth = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  // Postgres names the blocking table in the 23503 message, JSON-encoded:
  //   update or delete on table "users" violates foreign key constraint
  //   "posts_user_id_fkey" on table "posts"
  // The first table named is the one being deleted FROM; the blocker is last.
  const blockerOf = async (response) => {
    const body = await response.text();
    let message = body;
    try {
      message = JSON.parse(body)?.message ?? body;
    } catch {
      // Not JSON — match the raw text instead.
    }
    const named = [...message.matchAll(/on table "([^"]+)"/g)].map((m) => m[1]);
    return { table: named.length > 1 ? named[named.length - 1] : null, message };
  };

  const purge = (table) =>
    fetch(`${SUPABASE_URL}/rest/v1/${table}?user_id=eq.${userId}`, {
      method: "DELETE",
      headers: { ...auth, Prefer: "return=minimal" },
    });

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: auth,
    });
    if (response.ok) return true;

    const { table, message } = await blockerOf(response);
    if (!table) {
      console.warn(`  could not delete test account: ${message.slice(0, 200)}`);
      return false;
    }

    // Blockers nest — clearing `sessions` is itself refused while
    // `content_plans` still points at it. Walk down to whatever is actually at
    // the bottom, clear that, then come back up. Every table in this chain
    // carries user_id, so each level is one scoped delete.
    const stack = [table];
    while (stack.length > 0 && stack.length < 8) {
      const current = stack[stack.length - 1];
      const result = await purge(current);
      if (result.ok) {
        console.log(`  cleared ${current} to release the account`);
        stack.pop();
        continue;
      }
      const nested = await blockerOf(result);
      if (!nested.table || stack.includes(nested.table)) {
        console.warn(`  blocked by ${current}, and could not clear it: ${nested.message.slice(0, 160)}`);
        return false;
      }
      stack.push(nested.table);
    }
  }

  console.warn("  gave up deleting the test account after 12 attempts");
  return false;
}

async function findUserId(email) {
  if (!SERVICE_KEY) return null;
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  if (!response.ok) return null;
  const body = await response.json();
  return body?.users?.[0]?.id ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// Time to first value
// ════════════════════════════════════════════════════════════════════════════
test.describe("time to first value", () => {
  // Registration, four wizard steps, and a Studio load — on a cold dev server
  // the first compile of each route dominates. Generous on purpose: this test
  // asserts the measured elapsed time itself, so a slow harness cannot make it
  // pass, only make it take longer to fail.
  test.describe.configure({ timeout: 420_000, mode: "serial" });

  // Desktop only. The point is the funnel, not the viewport — mobile-chrome
  // would double the accounts created for no extra signal.
  test.skip(() => test.info().project.name !== "chromium", "funnel test — desktop only");

  // Every test here registers its own account and both are torn down at the
  // end. Sharing one would be cheaper, but Playwright gives each test a fresh
  // browser context — so the second test would arrive with an empty
  // localStorage, no Supabase session, and get bounced to /login. It would also
  // stop being a zero-data account the moment E2E_RUN_GENERATION populated it.
  const created = [];

  async function register(page) {
    const account = newAccount();
    created.push(account);
    await page.goto("/register", { waitUntil: "domcontentloaded" });
    const emailInput = page.locator("#reg-email");
    await expect(emailInput).toBeEditable({ timeout: HYDRATION });
    await emailInput.fill(account.email);
    await page.locator("#reg-password").fill(account.password);
    await page.getByRole("button", { name: "Create Account" }).click();
    return account;
  }

  test.afterAll(async () => {
    for (const account of created) {
      const userId = await findUserId(account.email);
      const deleted = await deleteAccount(userId);
      if (deleted) {
        console.log(`  cleaned up ${account.email}`);
      } else {
        console.warn(
          `  LEFTOVER TEST ACCOUNT: ${account.email}` +
            (SERVICE_KEY ? " (delete failed)" : " (no SUPABASE_SERVICE_ROLE_KEY — delete it manually)"),
        );
      }
    }
  });

  test("a brand-new signup reaches first value in under five minutes", async ({ page }) => {
    test.skip(!SUPABASE_URL || !ANON_KEY, "Supabase URL/anon key not configured");

    const startedAt = Date.now();
    const mark = (label) => {
      const elapsed = Date.now() - startedAt;
      console.log(`  ${String(Math.round(elapsed / 1000)).padStart(4)}s  ${label}`);
      return elapsed;
    };

    // ── Step 1: register ────────────────────────────────────────────────────
    const account = await register(page);

    // ── Step 2: the wizard must actually intercept ──────────────────────────
    // This is the assertion that matters most. OnboardingWizard.jsx is 209
    // lines that only ever run if AppHomeRedirect / Login route a new account
    // into them — the exact "built but never reached" shape that accounts for
    // most of this codebase's defects. If registration lands anywhere else,
    // the wizard is dead code and every new user is dropped into an empty
    // dashboard with no guidance.
    await expect(page).toHaveURL(/\/app\/onboarding/, { timeout: REDIRECT_TIMEOUT });
    await expect(page.getByText("Welcome to Brandosse")).toBeVisible({ timeout: HYDRATION });
    mark("registered, onboarding wizard reached");

    // The promise made on the page they just left has to match what they got.
    const grant = declaredSignupGrant();
    if (grant !== null && SERVICE_KEY) {
      const userId = await findUserId(account.email);
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/user_credits?user_id=eq.${userId}&select=balance`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
      );
      const rows = await response.json();
      expect(
        rows?.[0]?.balance,
        `signup page promises ${grant} credits — this account actually received ${rows?.[0]?.balance}`,
      ).toBe(grant);
      mark(`credit grant honoured (${grant})`);
    }

    // ── Step 3: walk the four steps ─────────────────────────────────────────
    await expect(page.getByText("Step 1 of 4")).toBeVisible();
    await page.getByRole("button", { name: /Continue/ }).click();

    await expect(page.getByText("Step 2 of 4")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Skip for now" }).click();

    await expect(page.getByText("Step 3 of 4")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Skip for now" }).click();

    await expect(page.getByText("Step 4 of 4")).toBeVisible({ timeout: 30_000 });
    mark("wizard walked to the first-post step");

    // ── Step 4: the handoff into Studio ─────────────────────────────────────
    // The wizard does not generate anything itself — it seeds the prompt and
    // hands off. If the seed is dropped, the user retypes what they just typed,
    // which is the difference between a handoff and a dead end.
    const seedPrompt = "A bright announcement post for a summer sale";
    await page.locator("textarea").first().fill(seedPrompt);
    await page.getByRole("button", { name: /Create my first post/ }).click();

    await expect(page).toHaveURL(/\/app\/generate/, { timeout: ROUTE_TIMEOUT });

    // The brand-kit modal is a once-per-session nudge over Studio, not a gate.
    const skipModal = page.getByRole("button", { name: "Skip for now" });
    try {
      await skipModal.waitFor({ state: "visible", timeout: 8_000 });
      await skipModal.click();
    } catch {
      // Not shown — fine.
    }

    const promptBox = page.locator("textarea").first();
    await expect(promptBox).toBeVisible({ timeout: HYDRATION });
    await expect(
      promptBox,
      "the prompt typed in the wizard did not survive the handoff into Studio",
    ).toHaveValue(new RegExp(seedPrompt.slice(0, 20)), { timeout: 30_000 });

    const readyToGenerate = mark("Studio open, prompt carried over, ready to generate");

    // ── Step 5: the bar ─────────────────────────────────────────────────────
    if (!RUN_GENERATION) {
      expect(
        readyToGenerate,
        `signup → ready-to-generate took ${Math.round(readyToGenerate / 1000)}s, over the ${TTFV_BUDGET_MS / 1000}s bar`,
      ).toBeLessThan(TTFV_BUDGET_MS);
      console.log(
        `\n  TTFV (to ready-to-generate): ${Math.round(readyToGenerate / 1000)}s of ${TTFV_BUDGET_MS / 1000}s` +
          `\n  Set E2E_RUN_GENERATION=1 to measure through to a finished post.\n`,
      );
      return;
    }

    // Full path — costs credits at fal.ai.
    await page.getByRole("button", { name: /^Generate/ }).first().click();
    await expect(page.locator("img").first()).toBeVisible({ timeout: 180_000 });
    const firstValue = mark("first post generated");

    expect(
      firstValue,
      `signup → first generated post took ${Math.round(firstValue / 1000)}s, over the ${TTFV_BUDGET_MS / 1000}s bar`,
    ).toBeLessThan(TTFV_BUDGET_MS);
    console.log(`\n  TTFV (to first generated post): ${Math.round(firstValue / 1000)}s of ${TTFV_BUDGET_MS / 1000}s\n`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // What a zero-data account is actually shown
  // ════════════════════════════════════════════════════════════════════════
  test("every surface a new account lands on offers a way forward", async ({ page }) => {
    test.skip(!SUPABASE_URL || !ANON_KEY, "Supabase URL/anon key not configured");

    // Its own account, deliberately. It has to be a signed-in session in THIS
    // browser context, and it has to still be empty — which the other test's
    // account is not once E2E_RUN_GENERATION has put a post in it.
    await register(page);
    await expect(page).toHaveURL(/\/app\/onboarding/, { timeout: REDIRECT_TIMEOUT });

    // scripts/check-empty-states.cjs proves every <EmptyState> declares an
    // action or a written reason. It cannot prove the right one renders for a
    // real empty account — only a browser with an empty account can do that.
    const surfaces = [
      { path: "/app/dashboard", label: "Dashboard" },
      { path: "/app/library", label: "Library" },
      { path: "/app/analytics", label: "Analytics" },
      { path: "/app/billing/credits", label: "Credits" },
      { path: "/app/video/jobs", label: "My videos" },
    ];

    const deadEnds = [];

    for (const surface of surfaces) {
      await page.goto(surface.path, { waitUntil: "commit", timeout: ROUTE_TIMEOUT });
      await expect(page).toHaveURL(new RegExp(surface.path.replace(/\//g, "\\/")), {
        timeout: ROUTE_TIMEOUT,
      });
      // Let the zero-data render settle — these pages fetch before they can
      // know they are empty.
      await page.waitForTimeout(4_000);

      // A surface is a dead end if it says there is nothing here and offers no
      // control to change that.
      const buttons = await page.getByRole("button").count();
      const links = await page.getByRole("link").count();
      const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
      const looksEmpty = /no |nothing |yet\b/i.test(bodyText);

      if (looksEmpty && buttons + links === 0) {
        deadEnds.push(`${surface.label} (${surface.path}) shows an empty state with no controls at all`);
      }

      expect(bodyText.length, `${surface.label} rendered nothing at all`).toBeGreaterThan(0);
    }

    expect(deadEnds, `dead-end surfaces:\n${deadEnds.join("\n")}`).toEqual([]);
  });
});
