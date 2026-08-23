#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * check-empty-states.cjs — the guard for LOCK L5.15.
 *
 * DoC-9: "WHEN a surface has no data, THE SYSTEM SHALL explain why and offer
 * the next action."
 *
 * A new account is nothing but empty states, so these ARE the product's first
 * impression. When the audit ran, 15 of 19 offered no way forward: a user
 * landed on a page, was told there was nothing there, and was left to work out
 * what to do about it on their own.
 *
 * Every <EmptyState> must therefore have:
 *   · a title
 *   · a description that explains WHY it is empty (not a restatement of the
 *     title — "You have not submitted any support tickets yet" under the
 *     heading "No support tickets yet" tells the reader nothing)
 *   · either `actions`, or `noAction="<written reason>"`
 *
 * The `noAction` escape hatch is deliberate and deliberately awkward. Some
 * empty states genuinely have no next action — "No failures" is the outcome
 * you want. Requiring a sentence for those means the exception is a decision
 * someone recorded, not a control someone forgot, and the two stop looking
 * alike in review.
 *
 * It also fails a loading state wearing an empty state's clothes. Rendering
 * "Loading tickets" in a dashed "nothing here" box tells a slow connection it
 * has no tickets, which may simply be false — the exact defect this guard was
 * written alongside (HelpPage.jsx:351, now a Skeleton).
 *
 * Run: node scripts/check-empty-states.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/** Titles that mean "still loading" rather than "nothing here". */
const LOADING_WORDS = /\b(loading|fetching|please wait|one moment)\b/i;

/** A reason has to be a sentence, not a shrug. */
const MIN_REASON_LENGTH = 15;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out);
    } else if (entry.name.endsWith(".jsx") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Capture one <EmptyState …> element starting at `start`, by counting angle
 * brackets rather than guessing at line shapes — the call sites are written
 * both inline and multi-line, and props contain JSX of their own.
 */
function captureElement(lines, start) {
  let depth = 0;
  let buf = "";
  for (let i = start; i < lines.length && i < start + 60; i += 1) {
    const line = lines[i];
    buf += `${line}\n`;
    for (const ch of line) {
      if (ch === "<") depth += 1;
      else if (ch === ">") depth -= 1;
    }
    // depth returns to 0 once the opening tag (and any nested prop JSX) closes.
    if (depth <= 0 && buf.includes("<EmptyState")) return buf;
  }
  return buf;
}

function propValue(buf, name) {
  // `name="..."`, `name={...}`, or bare `name`
  const quoted = new RegExp(`\\b${name}=(["'\`])([\\s\\S]*?)\\1`).exec(buf);
  if (quoted) return quoted[2];
  if (new RegExp(`\\b${name}=\\{`).test(buf)) return "{expression}";
  if (new RegExp(`\\b${name}(\\s|\\n|/|>)`).test(buf)) return true;
  return null;
}

const violations = [];
let checked = 0;

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes("<EmptyState")) continue;
    // The primitive's own definition, not a usage.
    if (rel.endsWith("primitives/EmptyState.jsx")) continue;

    checked += 1;
    const buf = captureElement(lines, i);
    const at = `${rel}:${i + 1}`;
    const title = propValue(buf, "title");
    const description = propValue(buf, "description");
    const actions = propValue(buf, "actions");
    const noAction = propValue(buf, "noAction");

    if (!title) {
      violations.push({ at, rule: "no-title", detail: "EmptyState has no title" });
    }
    if (!description) {
      violations.push({
        at,
        rule: "no-description",
        detail: `"${title}" does not say why it is empty`,
      });
    }
    if (typeof title === "string" && LOADING_WORDS.test(title)) {
      violations.push({
        at,
        rule: "loading-as-empty",
        detail: `"${title}" is a loading state — use <Skeleton>. Telling a slow connection it has no data may be false.`,
      });
    }
    if (!actions && !noAction) {
      violations.push({
        at,
        rule: "no-next-action",
        detail: `"${title}" is a dead end — add actions, or noAction="why there is nothing to do"`,
      });
    }
    if (noAction && actions) {
      violations.push({
        at,
        rule: "contradiction",
        detail: `"${title}" declares noAction but also passes actions`,
      });
    }
    if (typeof noAction === "string" && noAction !== "{expression}" && noAction.length < MIN_REASON_LENGTH) {
      violations.push({
        at,
        rule: "reason-too-thin",
        detail: `noAction="${noAction}" — write the actual reason, this is the whole point of the prop`,
      });
    }
  }
}

if (violations.length > 0) {
  console.error(`Empty-state guardrail failed — ${violations.length} violation(s) across ${checked} empty state(s).\n`);
  for (const v of violations) {
    console.error(`- ${v.at} [${v.rule}] ${v.detail}`);
  }
  console.error("\nDoC-9: a surface with no data must explain why and offer the next action.");
  process.exit(1);
}

console.log(`Empty-state guardrail passed — ${checked} empty state(s), every one with a way forward.`);
