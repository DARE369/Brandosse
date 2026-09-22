#!/usr/bin/env node
/**
 * check-youtube-thumbnail-merge.cjs
 *
 * YouTubeThumbnailPicker emits into the SAME per-account YouTube settings slot
 * that YouTubeOptionsPanel already owns (privacy_status, made_for_kids,
 * category_id, contains_synthetic_media). Three call sites wire it up, each
 * with its own state shape:
 *
 *   QuickPostComposer.jsx           platformOptions.youtube            (one object, all accounts)
 *   Generate/PostProductionPanel.jsx youtubeSettings[accountId]        (per account)
 *   Studio/PostProductionPanel.jsx   postProduction.youtubeSettings[id] (per account)
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * All three already had a REPLACE-shaped setter before this feature existed
 * (handlersFor's onChange, mergeSettings) — correct for a SINGLE panel owning
 * the whole slot. Wiring a SECOND emitter into the same slot with that same
 * replace semantics means whichever panel fires last silently erases whatever
 * the other one wrote: a video could publish with no privacy_status, or with
 * no thumbnail_url, depending on render order — and nothing would say so, the
 * exact failure class the comment beside handlersFor in QuickPostComposer.jsx
 * already documents from an earlier bug ("Maximum update depth exceeded").
 *
 * Each site was fixed to SPREAD the existing per-account object before adding
 * thumbnail_url. This guard is what keeps a future edit — someone reaching for
 * the existing (wrong-for-two-panels) setter because it is right there — from
 * reintroducing the erase.
 *
 *   Usage:  node scripts/check-youtube-thumbnail-merge.cjs
 *   Exit 0 = clean. Exit 1 = a finding.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
};

const findings = [];

function checkSite({ file, renderPattern, mergePattern, mergeDescription }) {
  const src = read(file);
  if (src === null) {
    findings.push(`${file} is missing. Repoint this guard rather than deleting it.`);
    return;
  }
  if (!renderPattern.test(src)) {
    findings.push(
      `${file} no longer renders <YouTubeThumbnailPicker>. The custom-thumbnail feature `
      + "silently stopped being offered on this compose surface.",
    );
    return;
  }
  if (!mergePattern.test(src)) {
    findings.push(
      `${file}: the thumbnail picker's onChange no longer ${mergeDescription}.\n`
      + "    Without the spread, whichever panel's onChange fires LAST erases every field "
      + "the other one wrote — the video would publish with privacy_status, made_for_kids "
      + "or category_id silently missing, depending on render order alone. This is exactly "
      + "the class of bug handlersFor's own comment in QuickPostComposer.jsx documents from "
      + 'an earlier incident ("Maximum update depth exceeded").',
    );
  }
}

// ── QuickPostComposer.jsx: one shared platformOptions.youtube object ───────
checkSite({
  file: "src/calendar/components/QuickPostComposer.jsx",
  renderPattern: /<YouTubeThumbnailPicker/,
  mergePattern: /youtube:\s*\{\s*\.\.\.prev\.youtube,\s*thumbnail_url:/,
  mergeDescription: "spread the existing platformOptions.youtube object (...prev.youtube) before setting thumbnail_url",
});

// ── Generate/PostProductionPanel.jsx: youtubeSettings keyed by account id ──
checkSite({
  file: "src/components/Generate/PostProductionPanel.jsx",
  renderPattern: /<YouTubeThumbnailPicker/,
  mergePattern: /\.\.\.prev\[acc\.id\],\s*thumbnail_url:/,
  mergeDescription: "spread the existing per-account settings (...prev[acc.id]) before setting thumbnail_url",
});

// ── Studio/PostProductionPanel.jsx: postProduction.youtubeSettings[id],
//    written through the pre-existing mergeSettings(key, accountId, settings)
//    helper — which itself replaces settings[accountId] WHOLESALE. The spread
//    has to happen in the VALUE passed to mergeSettings, not inside it. ─────
checkSite({
  file: "src/pages/Studio/PostProductionPanel.jsx",
  renderPattern: /<YouTubeThumbnailPicker/,
  mergePattern: /\.\.\.\(postProduction\.youtubeSettings\?\.\[acc\.id\]\s*\|\|\s*\{\}\),\s*thumbnail_url:/,
  mergeDescription: "spread the existing postProduction.youtubeSettings[acc.id] entry before setting thumbnail_url "
    + "(mergeSettings() itself replaces settings[accountId] wholesale, so the spread must happen in the object passed to it)",
});

if (findings.length === 0) {
  console.log("check-youtube-thumbnail-merge: PASS");
  console.log("  all three compose surfaces render the thumbnail picker and merge into the");
  console.log("  existing per-account YouTube settings rather than replacing them.");
  process.exit(0);
}

console.error(`check-youtube-thumbnail-merge: FAIL — ${findings.length} finding(s)\n`);
for (const f of findings) console.error(`  ✗ ${f}\n`);
process.exit(1);
