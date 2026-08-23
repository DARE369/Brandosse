#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * check-single-deploy-target.cjs — the guard for LOCK L7.1.
 *
 * The worker must be described by exactly one deploy config. Two is not a
 * harmless leftover: it is how a service ends up running in two places, billed
 * twice, and debugged in a third — and how a fix lands on the host nobody is
 * actually using. The audit's dominant defect was disconnection, and a stale
 * deploy config is disconnection with a credit card attached.
 *
 * `railway.toml` was deleted when `fly.toml` landed, in the same change. This
 * makes bringing it back a build failure rather than a discovery six weeks
 * later.
 *
 * It also checks the direction that actually bites: that the app is told where
 * the worker lives. `WORKER_WEBHOOK_URL` still pointing at a decommissioned
 * Railway host is a worker that answers nothing, silently, which is exactly the
 * failure mode L2.3 spent a wave cleaning up after.
 *
 * Run: node scripts/check-single-deploy-target.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

/** One entry per host we could plausibly be deployed to. */
const HOSTS = [
  { name: "Fly.io", files: ["fly.toml", "video-worker/fly.toml"] },
  { name: "Railway", files: ["railway.toml", "video-worker/railway.toml", "railway.json"] },
  { name: "Render", files: ["render.yaml", "video-worker/render.yaml"] },
  { name: "Heroku", files: ["Procfile", "video-worker/Procfile"] },
  { name: "App Engine", files: ["app.yaml", "video-worker/app.yaml"] },
];

const present = [];
for (const host of HOSTS) {
  const found = host.files.filter((f) => fs.existsSync(path.join(ROOT, f)));
  if (found.length > 0) present.push({ name: host.name, found });
}

const failures = [];

if (present.length === 0) {
  failures.push(
    "No deploy config for the worker at all. It has to be described somewhere,\n"
      + "  or the next deploy is somebody's shell history.",
  );
} else if (present.length > 1) {
  failures.push(
    `The worker is described for ${present.length} different hosts:\n`
      + present.map((p) => `    ${p.name.padEnd(12)} ${p.found.join(", ")}`).join("\n")
      + "\n  Delete the ones that are not real. A repo that describes two hosts cannot\n"
      + "  tell you which one is serving traffic.",
  );
}

// Nothing in the repo should still name Railway once Fly is the host.
const onFly = present.some((p) => p.name === "Fly.io");
if (onFly) {
  const stale = [];
  const CHECK_FILES = [".env.example", ".github/workflows/ci.yml", ".github/workflows/health.yml"];
  for (const rel of CHECK_FILES) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    fs.readFileSync(full, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        // A comment explaining that Railway was replaced is fine. A variable
        // still named for it is not.
        if (/RAILWAY_[A-Z_]+/.test(line) && !/^\s*#/.test(line)) {
          stale.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
        }
      });
  }
  if (stale.length > 0) {
    failures.push(
      "Fly is the host, but these still reference Railway:\n"
        + stale.map((s) => `    ${s}`).join("\n")
        + "\n  A health check pointed at a decommissioned host reports green forever.",
    );
  }
}

if (failures.length > 0) {
  console.error("Deploy-target guardrail failed.\n");
  for (const f of failures) console.error(`- ${f}\n`);
  process.exit(1);
}

console.log(
  `Deploy-target guardrail passed — exactly one host described (${present[0].name}: ${present[0].found.join(", ")}).`,
);
