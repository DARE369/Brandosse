#!/usr/bin/env node
/**
 * check-no-diffusion-text.cjs — on the compositor path, the image model never
 * draws words.
 *
 * ── Why this is worth a guard of its own ────────────────────────────────────
 * The entire value of deterministic typography is that the words are correct by
 * construction. That holds only while the BACKGROUND is genuinely text-free.
 * A stray model-drawn word behind real composited type is the worst of both
 * approaches: it still reads as AI, and now the brand's real headline is sitting
 * on top of a misspelled ghost of itself.
 *
 * Two things have to stay true, and both are easy to lose in a refactor:
 *
 *  1. Ideogram is never selected on this path. It exists in this stack for
 *     exactly one reason — rendering exact text inside an image — which is
 *     precisely what must not happen here.
 *
 *  2. The no-text instruction is appended AFTER the prompt enhancer, never
 *     before. The enhancer is an LLM that rewrites its input freely; given
 *     "render no text" in its input it will cheerfully paraphrase it into
 *     something softer, or drop it for length. Appending afterwards is what
 *     makes the instruction survive verbatim.
 *
 * Neither is visible in a code review of the diff that breaks it, which is what
 * makes them detector material rather than convention.
 */

const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./lib/strip-comments.cjs');

const ROOT = process.cwd();
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const CALLER = path.join(ROOT, 'supabase', 'functions', 'generateImage', 'index.ts');
const TEMPLATES = path.join(ROOT, 'supabase', 'functions', '_shared', 'designTemplates.ts');

function main() {
  const caller = stripComments(fs.readFileSync(CALLER, 'utf8'));
  const templates = fs.readFileSync(TEMPLATES, 'utf8');

  // ── 1. Ideogram is excluded from the compositor path ──────────────────────
  assert(
    /wantsComposite\s*&&\s*imageModel\s*===\s*"ideogram"/.test(caller)
    || /imageModel\s*===\s*"ideogram"[\s\S]{0,120}wantsComposite/.test(caller),
    'generateImage must force a non-Ideogram model when compositing. Ideogram\'s whole purpose is '
    + 'drawing exact text inside the image, which is what the compositor exists to replace.',
  );
  assert(
    /if\s*\(wantsComposite\s*&&\s*imageModel\s*===\s*"ideogram"\)\s*imageModel\s*=/.test(caller),
    'The Ideogram exclusion must actually reassign imageModel, not merely test it.',
  );

  // ── 2. The directive is appended, and appended LAST ───────────────────────
  assert(
    /backgroundDirectiveFor\(/.test(caller),
    'generateImage must append the template\'s background directive to the prompt.',
  );

  // Call sites, not import lines: both symbols are imported at the top of the
  // file, and comparing import order answers a different question entirely.
  const enhancerIndex = caller.indexOf('callPromptEngine({');
  const directiveIndex = caller.indexOf('backgroundDirectiveFor(designTemplate)');
  assert(
    enhancerIndex !== -1 && directiveIndex > enhancerIndex,
    'The background directive must be appended AFTER the prompt enhancer runs. The enhancer rewrites '
    + 'its input freely and will soften or drop a negative instruction it is given; appending '
    + 'afterwards is the only way it survives verbatim.',
  );

  // It must be concatenated onto the final prompt, not passed as a separate
  // field some provider may ignore.
  assert(
    /finalPrompt\s*=\s*`\$\{finalPrompt\}[\s\S]{0,80}backgroundDirectiveFor/.test(caller),
    'The directive must be concatenated onto finalPrompt so it reaches the provider.',
  );

  // ── 3. Every template forbids text, emphatically ──────────────────────────
  const directiveFn = templates.slice(templates.indexOf('export function backgroundDirectiveFor'));
  assert(
    /NO text/.test(directiveFn) && /watermark/i.test(directiveFn) && /logos/i.test(directiveFn),
    'backgroundDirectiveFor must forbid text, watermarks and logos explicitly.',
  );
  assert(
    (directiveFn.match(/\bNO\b/g) || []).length >= 6,
    'The no-text rule must be stated several ways. Image models treat a single negative as a weak '
    + 'preference, and one stray word in the background defeats the entire pipeline.',
  );

  // Each template must declare where the background stays calm, or the two
  // halves of the image are designed independently and the text lands on a face.
  // Counted inside the DESIGN_TEMPLATES array only — the interface above it
  // also declares `calmRegion: string`, which is a type, not a template.
  const arrayStart = templates.indexOf('export const DESIGN_TEMPLATES');
  const templateArray = arrayStart === -1 ? '' : templates.slice(arrayStart);
  const calmRegions = templateArray.match(/calmRegion:/g) || [];
  const templateIds = templateArray.match(/^\s{4}id:\s*"/gm) || [];
  assert(
    calmRegions.length === templateIds.length && templateIds.length > 0,
    `Every template must declare a calmRegion (found ${calmRegions.length} for ${templateIds.length} templates). `
    + 'Without it the model is not told which region to leave for the text.',
  );

  const compositions = templateArray.match(/composition:/g) || [];
  assert(
    compositions.length === templateIds.length,
    'Every template must declare a composition direction — a centred subject with centred text is '
    + 'the statistical mean of every image model and reads as generic.',
  );

  // ── 4. The enhancer must not be told to bake text in on this path ─────────
  // Ideogram's enhancer prompt explicitly asks for exact text in the image.
  // That instruction existing is fine; reaching a composited render is not.
  assert(
    !/buildEnhancerSystemPrompt\(\s*["']ideogram["']\s*\)/.test(caller),
    'The Ideogram enhancer prompt must never be selected explicitly — it instructs the model to '
    + 'render exact text inside the image.',
  );

  if (failures.length > 0) {
    console.error('\n\x1b[31m✖ check-no-diffusion-text FAILED\x1b[0m\n');
    for (const failure of failures) console.error(`  • ${failure}\n`);
    process.exit(1);
  }

  console.log(
    '\x1b[32m✔ check-no-diffusion-text\x1b[0m  the compositor path never routes to Ideogram, and the ' +
    'no-text directive survives the enhancer.',
  );
}

main();
