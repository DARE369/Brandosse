#!/usr/bin/env node
/**
 * check-compose-wiring.cjs — the typography layer is actually REACHED.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * The compositor — real font bytes, exact brand hex, wrapping, shrink-to-fit,
 * contrast enforcement, the ink check — was built, wired inside the
 * `generateImage` edge function, and covered by two passing guards
 * (check-compositor-fonts, check-no-diffusion-text).
 *
 * And it never ran once. `generateImage` only takes the compositor path when the
 * caller sends `compose.text`, and NOTHING in `src/` or `app/` ever sent it.
 * Every graphic the product made still had its words drawn by the diffusion
 * model. Both guards passed the whole time, because they call `compositeDesign`
 * directly — neither asserts that anything else does.
 *
 * That is this repo's dominant defect exactly: disconnection, not absence.
 * `OptimalTimesService.js`, `generate-caption`, `week_plan`, `clip_selector.py`
 * — working code nobody could reach. A guard that proves a module WORKS is not a
 * guard that proves it is USED.
 *
 * ── What this asserts ───────────────────────────────────────────────────────
 *  1. CHAIN — every link from the pipeline to the edge request body exists:
 *       generationPipeline -> opts.compose
 *       SessionStore       -> compose: opts.compose   (EVERY registration site)
 *       media.service      -> compose in the invoke body
 *  2. BEHAVIOUR — designCopy.js builds the right payload, and returns null when
 *     there is no headline so the old path is untouched.
 *  3. REPORTING — the compositor's outcome survives back to the caller, so a
 *     graphic that came back without its words can be explained.
 *  4. REQUIRED MARKS — the legal line is injected SERVER-side, so a client that
 *     forgets to send it cannot drop a legal disclosure.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { pathToFileURL } = require('node:url');
const { stripComments } = require('./lib/strip-comments.cjs');

const ROOT = process.cwd();
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const read = (relPath) => {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) {
    failures.push(`Missing file: ${relPath}`);
    return '';
  }
  return stripComments(fs.readFileSync(full, 'utf8'));
};

// ── 1. The chain ─────────────────────────────────────────────────────────────

const pipeline = read('src/services/generationPipeline.js');
const store = read('src/stores/SessionStore.js');
const media = read('src/services/media.service.js');
const edge = read('supabase/functions/generateImage/index.ts');

assert(
  /from\s+['"]\.\/designCopy['"]/.test(pipeline),
  'generationPipeline.js does not import designCopy. Nothing builds the compose payload, '
  + 'so the compositor is unreachable.',
);
assert(
  /buildComposePayload\s*\(/.test(pipeline),
  'generationPipeline.js never calls buildComposePayload — no image can carry brand typography.',
);

// Both render paths must pass it. Wiring only the carousel would leave every
// single-image render on the diffusion-text path with nothing to show for it.
const composePassCount = (pipeline.match(/compose:\s*composePayload/g) || []).length;
assert(
  composePassCount >= 2,
  `generationPipeline.js passes compose at ${composePassCount} call site(s); both the single `
  + 'render and the carousel render must pass it, or one path silently keeps the old behaviour.',
);

// EVERY registration site, not just the first. Three of the four matched on the
// first attempt at this wiring purely because the fourth was indented
// differently — a missed site is a whole surface that stays disconnected.
const registrations = (store.match(/registerImageGenerator\s*\(/g) || []).length;
const forwarded = (store.match(/compose:\s*opts\.compose/g) || []).length;
assert(registrations > 0, 'No registerImageGenerator call sites found in SessionStore.js.');
assert(
  forwarded === registrations,
  `SessionStore.js registers ${registrations} image generators but only ${forwarded} forward `
  + '`compose: opts.compose`. Every registration site is a separate surface; an unwired one '
  + 'silently renders diffusion text.',
);

assert(
  /compose\s*=\s*null/.test(media) || /\bcompose\b\s*,/.test(media),
  'media.service.js generateImages() does not accept a `compose` parameter.',
);
assert(
  /\{\s*compose\s*\}/.test(media),
  'media.service.js never puts `compose` into the generateImage request body — the payload is '
  + 'built and then dropped one call short of the wire.',
);

// ── 3. Reporting ─────────────────────────────────────────────────────────────

for (const field of ['composeApplied', 'composeError', 'composeNotes', 'composeTemplate']) {
  assert(
    new RegExp(`${field}\\s*:`).test(media),
    `media.service.js does not return \`${field}\`. The compositor states plainly why it declined `
    + 'to draw; dropping that leaves the user with a bare graphic and no explanation.',
  );
}
assert(
  /compose_applied/.test(media) && /console\.error/.test(media),
  'media.service.js does not log a requested-but-unapplied composite. The logo path does exactly '
  + 'this, for exactly the same reason.',
);
assert(
  /composeTemplate/.test(pipeline),
  'generationPipeline.js does not carry the chosen template back, so a carousel cannot vary its '
  + 'layouts and every slide renders the same composition.',
);

// ── 4. Required marks are server-side ────────────────────────────────────────

assert(
  // The ASSIGNMENT specifically. Matching `composeText.legal` anywhere also
  // matched the read in the "did the caller already set it?" guard clause, so
  // deleting the injection left this passing.
  /required_marks/.test(edge) && /composeText\.legal\s*=/.test(edge),
  'generateImage does not inject the brand\'s legal line from the server-side kit. Taking it from '
  + 'the request body means a client that forgets to send it drops a required legal disclosure.',
);
assert(
  /composeText:\s*TextContent\s*=\s*\{\s*\.\.\./.test(edge),
  'generateImage assigns composeText directly from the request body instead of copying it. The '
  + 'server-side legal/contact injection needs a mutable copy, and mutating the parsed body is a '
  + 'trap for anything that reads it later.',
);

// ── 2. Behaviour of designCopy ───────────────────────────────────────────────

async function checkBehaviour() {
  const source = path.join(ROOT, 'src', 'services', 'designCopy.js');
  if (!fs.existsSync(source)) {
    failures.push('src/services/designCopy.js is missing.');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'designcopy-'));
  const outFile = path.join(dir, 'designCopy.mjs');
  fs.writeFileSync(outFile, ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText, 'utf8');

  try {
    const { buildComposeText, buildComposePayload, TEXT_SLOTS } = await import(pathToFileURL(outFile).href);

    const plan = { caption: { cta: 'Find a stockist near you' } };

    // The no-headline case is the important one: with no payload the edge
    // function keeps its original path, so enabling this cannot change a
    // photorealistic render that was never going to carry words.
    assert(
      buildComposeText({}, plan) === null,
      'buildComposeText must return null with no headline, so the old render path is untouched.',
    );
    assert(
      buildComposeText({ headline: '   ' }, plan) === null,
      'A whitespace-only headline must count as no headline.',
    );
    assert(
      buildComposePayload({}, plan) === null,
      'buildComposePayload must return null with no headline.',
    );

    const hook = buildComposeText({ headline: 'Brewed slow', slide_purpose: 'hook' }, plan);
    assert(hook?.headline === 'Brewed slow', 'The headline did not survive.');
    assert(
      hook?.cta === undefined,
      'A CTA was put on a non-CTA slide. Repeating the call to action on every slide of a '
      + 'carousel is noise.',
    );

    const ctaSlide = buildComposeText({ headline: 'Last chance', slide_purpose: 'cta' }, plan);
    assert(
      ctaSlide?.cta === 'Find a stockist near you',
      `The CTA slide did not pick up the caption CTA; got ${JSON.stringify(ctaSlide)}`,
    );

    assert(
      buildComposeText({ headline: 'A\n  b   c' }, plan)?.headline === 'A b c',
      'Whitespace in a headline must be collapsed before it reaches the typesetter.',
    );

    // No word-count cap. Capping what a user may write is the defect the whole
    // typography layer exists to remove; the compositor shrinks to fit instead.
    const long = 'Hibiscus, ginger, and absolutely nothing else that you could not pronounce aloud';
    assert(
      buildComposeText({ headline: long }, plan)?.headline === long,
      'A long headline was truncated. The compositor shrinks type to fit; the copy is never cut.',
    );

    const payload = buildComposePayload({ headline: 'Brewed slow' }, plan, ['stack', 'banner']);
    assert(
      Array.isArray(payload?.recent_template_ids) && payload.recent_template_ids.length === 2,
      'buildComposePayload must pass recent template ids so layouts vary across a carousel.',
    );
    assert(
      Object.keys(payload.text).every((slot) => TEXT_SLOTS.includes(slot)),
      `buildComposePayload produced a slot the compositor does not understand: ${Object.keys(payload.text)}`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

checkBehaviour()
  .then(() => {
    if (failures.length > 0) {
      console.error('\n\x1b[31m✖ check-compose-wiring FAILED\x1b[0m\n');
      for (const failure of failures) console.error(`  • ${failure}\n`);
      process.exit(1);
    }
    console.log(
      `\x1b[32m✔ check-compose-wiring\x1b[0m  pipeline → store (${forwarded}/${registrations} sites) → `
      + 'media.service → edge body is connected; designCopy returns null without a headline; the '
      + 'legal line is injected server-side.',
    );
  })
  .catch((err) => {
    console.error('✖ check-compose-wiring crashed:', err);
    process.exit(1);
  });
