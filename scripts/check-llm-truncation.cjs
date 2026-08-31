#!/usr/bin/env node
/**
 * check-llm-truncation.cjs — LOCK L5.3a guard.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * `video-worker/stages/analyze.py` called Claude with max_tokens=4096 and then
 * parsed the response as JSON without ever checking `stop_reason`. On a long
 * source the clip list ran past the limit and was cut mid-array. Two outcomes,
 * both bad and both silent:
 *
 *   - json.loads raised → 3 retries → the job failed with "invalid JSON",
 *     which points at the model rather than at our own token ceiling; or
 *   - a shorter list parsed cleanly → the job SUCCEEDED having lost real
 *     moments from the video, with nothing anywhere recording that it had.
 *
 * The second is the one that matters. It is a law-3 violation — silent loss of
 * user content — and it ran undetected for the life of the feature.
 *
 * ── What this guard asserts ─────────────────────────────────────────────────
 * For every LLM call site whose response is parsed as structured data:
 *   1. max_tokens is at or above MIN_TOKENS, and
 *   2. the code checks stop_reason near the call.
 *
 * A call site that legitimately wants a short answer (a classifier, a rewrite
 * with a hard length target) is exempt only by being listed in SHORT_BY_DESIGN
 * with a reason — so the exemption is a decision on the record, not a silence.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const MIN_TOKENS = 8000;

/** Call sites that deliberately cap output short. Each needs a stated reason. */
const SHORT_BY_DESIGN = [
  {
    file: 'supabase/functions/generateVideo/index.ts',
    reason:
      'Prompt rewriting for a video model, which performs worse on long prompts. ' +
      'Output is a prompt string, not structured data — a cut tail degrades the ' +
      'prompt but cannot silently drop a record.',
  },
];

/** Files scanned for LLM calls that parse structured output. */
const SCAN = [
  'video-worker/stages/analyze.py',
];

const failures = [];
const checked = [];

function nearby(text, index, window = 2500) {
  return text.slice(Math.max(0, index - window), Math.min(text.length, index + window));
}

for (const rel of SCAN) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`${rel}: listed in SCAN but does not exist — update this guard.`);
    continue;
  }
  const src = fs.readFileSync(abs, 'utf8');

  if (SHORT_BY_DESIGN.some((e) => e.file === rel)) {
    checked.push(`${rel} (exempt: short by design)`);
    continue;
  }

  // Real keyword-argument assignments only — anchored to the start of a line so
  // that prose, comments and string literals mentioning max_tokens (including
  // this guard's own error text inside analyze.py) are not counted as call sites.
  const re = /^[ \t]*max_?[Tt]okens\s*[=:]\s*(\d+)/gm;
  let m;
  let found = 0;
  while ((m = re.exec(src)) !== null) {
    found += 1;
    const value = Number(m[1]);
    const context = nearby(src, m.index);

    // The property that actually matters is that truncation is DETECTED. A
    // call that checks stop_reason cannot silently ship a cut-off response
    // whatever its limit, so it is safe at any size. This is non-negotiable
    // and has no opt-out.
    const checksStopReason = /stop_reason/.test(context);

    if (!checksStopReason) {
      failures.push(
        `${rel}: an LLM call sets max_tokens=${value} but no stop_reason check ` +
        `appears near it. A truncated response must be detected and refused, ` +
        `never parsed. See the comment at the top of this script.`,
      );
    }

    // The floor is a second line of defence for calls that produce a large
    // structured payload, where hitting the limit means a failed job even when
    // detected. It does not apply to a call that is deliberately short AND
    // detects its own truncation — but the intent has to be declared on the
    // line above, so "this one is meant to be small" is a decision on the
    // record rather than an unexplained number.
    // Look a few lines up, not just one: the declaration is usually the first
    // line of a short comment block explaining it, and requiring it to be the
    // immediately preceding line would force the reason to be written last,
    // which reads backwards.
    const lineStart = src.lastIndexOf('\n', m.index - 1);
    let windowStart = lineStart;
    for (let i = 0; i < 4 && windowStart > 0; i += 1) {
      windowStart = src.lastIndexOf('\n', windowStart - 1);
    }
    const preceding = src.slice(Math.max(0, windowStart), lineStart);
    const declaredShort = /short-output:\s*\S/.test(preceding);

    if (value < MIN_TOKENS && !declaredShort) {
      failures.push(
        `${rel}: max_tokens=${value} is below the ${MIN_TOKENS} floor. ` +
        `A large structured response cut at this limit fails the job even when ` +
        `detected. Raise it, or declare the intent on the line above with a ` +
        `comment: "# short-output: <why this response is small>".`,
      );
    }
  }

  if (found === 0) {
    failures.push(
      `${rel}: listed in SCAN but no max_tokens assignment was found. ` +
      `Either the call moved (update SCAN) or the limit is now implicit, ` +
      `which is worse — an implicit default can change under you.`,
    );
  } else {
    checked.push(`${rel} (${found} call site${found === 1 ? '' : 's'})`);
  }
}

if (failures.length > 0) {
  console.error('  check-llm-truncation: FAIL\n');
  for (const f of failures) console.error(`    - ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`  check-llm-truncation: OK (${checked.join(', ')})`);
