// Single source of truth for what a new account is actually given.
//
// LOCK L5.15. Until now this number lived as a hardcoded string in three
// separate marketing surfaces, and all three were wrong:
//
//   Register.jsx:217      "100 free AI credits included on signup"
//   LandingPage.jsx:128   "new accounts start with 100 free AI credits"
//   LandingPage.jsx:261   "100 free AI credits on signup"
//
// The database grants 30. Verified against a real signup on 2026-08-22:
// user_credits.balance = 30, credit_transactions empty, no later top-up.
//
// The 100 came from profiles.credits, which defaults to 100 and gates nothing —
// the header pill, and every spend check, read user_credits.balance. So a new
// user was promised 100 on the signup page and shown "30 cr" in the header
// seconds later. The number existed in the database, just not in the table that
// counts.
//
// Two guards keep this honest, because a constant nobody checks drifts exactly
// like the strings it replaced:
//   · scripts/check-credit-grant.cjs — asserts this matches the value the
//     migration's handle_new_user_credits() trigger actually inserts.
//   · tests/e2e/time-to-first-value.spec.js — registers a real account and
//     asserts the balance it receives equals this.

/**
 * Credits a brand-new personal account receives at signup.
 * Set by handle_new_user_credits() in
 * supabase/migrations/20260710090000_baseline_core_tables.sql.
 *
 * Changing the promise means changing the trigger first — the guard fails
 * otherwise, which is the point.
 */
export const SIGNUP_CREDIT_GRANT = 30;
