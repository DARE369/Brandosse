# Generate Page — Live Verification Kit

This folder contains runnable scripts that check, against your REAL Supabase
project (and, for two of them, your real fal.ai account), everything the
Weeks 1-3 FIXLOG marked as "could not verify — no live environment
available." **Start with `RUNBOOK.md`** — it's the master checklist that
tells you what order to run things in and has a results template to fill in
and paste back for review. This README only covers installing/configuring.

## What you need before starting

- Node.js 18 or newer (the scripts use the built-in `fetch` — no separate
  HTTP library). Check with `node -v`.
- Two free Supabase-project user accounts in this app (see RUNBOOK.md Part
  A for exactly how to create them — one needs a few credits and a mock
  connected account, the other just needs to exist).
- Your Supabase project's URL, anon key, and **service-role key** (Dashboard
  → Settings → API). The service-role key bypasses RLS — that's required
  for several of these checks (e.g. directly inserting/inspecting rows the
  way a trigger or another user's session would), but it also means this
  key must never be committed or shared. It only ever lives in your local
  `.env` file.

## Install

```
cd audit-brief/qa-kit
npm install
```

This installs exactly one dependency: `@supabase/supabase-js`.

## Configure

```
cp .env.example .env
```

Then open `.env` and fill in every value. See `.env.example`'s own comments
for what each one is and where to find it in the Supabase dashboard.
`TEST_IMAGE_URL` is optional (only used by `verify-video-jobs.js`) — leave it
blank if you don't have a convenient public image URL handy; the script
will tell you the cost trade-off of leaving it blank.

**Do not commit your real `.env`.** The repo's root `.gitignore` already
covers `.env` and `.env.*` patterns, so `git status` should not show it —
if it does, stop and check before doing anything else.

## Running a script

Every script is fully independent:

```
node verify-realtime-payload.js
node verify-credits.js
node verify-video-jobs.js
# ...etc, or use the npm scripts, e.g. `npm run verify:credits`
```

Each one:
- Reads `.env` itself (no shell exports needed).
- Prints `✅ PASS`, `❌ FAIL`, `ℹ️` (informational), or `⏭️ SKIPPED` lines with
  a plain-English explanation for each check — never a raw dump you have to
  interpret yourself (raw data is only ever shown *in addition to*, never
  *instead of*, a verdict).
- Cleans up every row it created, tagged with the prefix `QA-VERIFY-` so
  it's unmistakable in the database if you ever need to find it by hand.
  Anything a script can't safely auto-delete is listed explicitly under a
  `CLEANUP` section at the end for you to remove manually.
- Exits with code `0` if everything passed, or `1` if anything failed — so
  you can chain them with `&&` (see `npm run verify:all`, which runs every
  *free* check in one go; the two scripts that cost real money/credits —
  `verify-video-jobs.js` and `verify-credits.js` — are deliberately left out
  of that chain and gate every expensive step behind its own `y/n` prompt).

## What each script needs from you at runtime

- Most scripts need nothing beyond `.env` — they run start to finish and
  print a final verdict.
- `verify-credits.js` and `verify-video-jobs.js` will ask `Proceed? (y/n)`
  before doing anything that costs real credits/API usage. Type `y` and
  press Enter to continue, anything else to skip that case.

## If a script errors instead of printing PASS/FAIL

That means something unexpected happened outside the specific thing being
tested (e.g. your `.env` values are wrong, the Supabase project is
unreachable, an account doesn't exist). The error message is printed as
`UNEXPECTED SCRIPT ERROR` with the raw Node/Supabase error — paste that
along with your results when reporting back.

## Next step

Open **`RUNBOOK.md`** and follow it in order.
