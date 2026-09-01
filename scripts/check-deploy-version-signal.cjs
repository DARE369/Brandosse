#!/usr/bin/env node
/**
 * check-deploy-version-signal.cjs
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * The worker's /health endpoint returned a hardcoded "1.0.0" that had never
 * changed. There was no way to ask a running deployment which commit it was
 * built from, so "is the latest code live?" could only be inferred by comparing
 * a deploy timestamp against a git commit time.
 *
 * That inference is unreliable, and it misled this project on 2026-09-01: the
 * timestamp comparison reported `daily-analysis` as two hours stale, and the
 * commit it appeared to be missing contained a live security fix (unauthenticated
 * callers could enumerate every active user id). Only a behavioural probe showed
 * the guard was in fact deployed. An audit should not need detective work to
 * establish what is running.
 *
 * ── What this asserts ───────────────────────────────────────────────────────
 * The chain that carries the commit sha from CI into a running container:
 *
 *   workflow --build-arg GIT_SHA  ->  Dockerfile ARG/ENV  ->  config  ->  /health
 *
 * Every link, because breaking any one of them silently returns the endpoint to
 * reporting "unknown" — which looks like a working health check.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`${rel}: does not exist — the version-signal chain is broken at this link.`);
    return null;
  }
  return fs.readFileSync(abs, 'utf8');
}

// 1. CI passes the sha at build time.
const workflow = read('.github/workflows/deploy-worker.yml');
if (workflow && !/--build-arg\s+GIT_SHA=\$\{\{\s*github\.sha\s*\}\}/.test(workflow)) {
  failures.push(
    '.github/workflows/deploy-worker.yml: the deploy step does not pass ' +
    '--build-arg GIT_SHA=${{ github.sha }}. Without it every image reports ' +
    '"unknown" and deployed-version questions go back to guessing from timestamps.',
  );
}

// 2. The image accepts it and keeps it in the environment.
const dockerfile = read('video-worker/Dockerfile');
if (dockerfile) {
  if (!/^ARG\s+GIT_SHA/m.test(dockerfile)) {
    failures.push('video-worker/Dockerfile: no `ARG GIT_SHA` — the build arg is discarded.');
  }
  if (!/^ENV\s+WORKER_GIT_SHA=\$GIT_SHA/m.test(dockerfile)) {
    failures.push(
      'video-worker/Dockerfile: no `ENV WORKER_GIT_SHA=$GIT_SHA` — the arg exists ' +
      'at build time but never reaches the running process.',
    );
  }
}

// 3. The app reads it.
const config = read('video-worker/config.py');
if (config && !/alias="WORKER_GIT_SHA"/.test(config)) {
  failures.push('video-worker/config.py: WORKER_GIT_SHA is not declared, so the app cannot read it.');
}

// 4. And reports it.
const main = read('video-worker/main.py');
if (main && !/"git_sha":\s*config\.git_sha/.test(main)) {
  failures.push(
    'video-worker/main.py: /health does not report `git_sha`. A health endpoint ' +
    'that cannot state its own version is the exact gap this guard exists to close.',
  );
}

if (failures.length > 0) {
  console.error('  check-deploy-version-signal: FAIL\n');
  for (const f of failures) console.error(`    - ${f}`);
  console.error('');
  process.exit(1);
}

console.log('  check-deploy-version-signal: OK (workflow -> Dockerfile -> config -> /health)');
