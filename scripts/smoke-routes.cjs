#!/usr/bin/env node

const DEFAULT_BASE_URL = "http://localhost:3001";
const DEFAULT_TIMEOUT_MS = 30000;

const baseUrl = (process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

const routes = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/auth/callback",
  "/complete-signup",
  "/join",
  "/select-context",
  "/review/test-review-token",
  "/app/dashboard",
  "/app/generate",
  "/app/generate/test-session-id",
  "/app/calendar",
  "/app/library",
  "/app/analytics",
  "/app/settings",
  "/app/settings/brand-kit",
  "/app/help",
  "/app/billing/credits",
  "/app/video/new",
  "/app/video/jobs",
  "/app/video/jobs/test-job-id",
  "/app/admin",
  "/app/admin/users",
  "/app/admin/users/test-user",
  "/app/admin/accounts",
  "/app/admin/organizations",
  "/app/admin/organizations/test-org",
  "/app/admin/moderation?post=test-post",
  "/app/admin/complaints",
  "/app/admin/complaints/test-complaint",
  "/app/admin/logs?source=connection_events",
  "/app/admin/analytics",
  "/app/admin/settings",
  "/app/admin/content/review",
  "/app/org/test-org",
  "/app/org/test-org/overview",
  "/app/org/test-org/workspace",
  "/app/org/test-org/office",
  "/app/org/test-org/pipeline",
  "/app/org/test-org/pipeline/tasks",
  "/app/org/test-org/calendar",
  "/app/org/test-org/library",
  "/app/org/test-org/common-room",
  "/app/org/test-org/common-room/test-channel",
  "/app/org/test-org/team-activity",
  "/app/org/test-org/admin/members",
  "/app/org/test-org/admin/roles",
  "/app/org/test-org/admin/pipelines",
  "/app/org/test-org/admin/credits",
  "/app/org/test-org/admin/settings",
  "/app/org/test-org/admin/brand-kit",
];

function makeUrl(route) {
  return `${baseUrl}${route}`;
}

async function checkRoute(route) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const startedAt = Date.now();
    const response = await fetch(makeUrl(route), {
      redirect: "follow",
      signal: controller.signal,
    });
    const body = await response.arrayBuffer();
    const elapsedMs = Date.now() - startedAt;

    return {
      route,
      status: response.status,
      bytes: body.byteLength,
      elapsedMs,
      ok: response.status >= 200 && response.status < 400,
    };
  } catch (error) {
    return {
      route,
      status: "ERR",
      bytes: 0,
      elapsedMs: timeoutMs,
      ok: false,
      error: error?.name === "AbortError" ? "timeout" : error?.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`Smoke testing ${routes.length} routes against ${baseUrl}`);

  const results = [];
  for (const route of routes) {
    const result = await checkRoute(route);
    results.push(result);

    const suffix = result.ok
      ? `${result.status} ${result.bytes}b ${result.elapsedMs}ms`
      : `${result.status} ${result.error || ""}`.trim();
    console.log(`${result.ok ? "PASS" : "FAIL"} ${route} ${suffix}`);
  }

  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    console.error(`Smoke route check failed: ${failures.length}/${routes.length} routes failed.`);
    process.exit(1);
  }

  console.log(`Smoke route check passed: ${routes.length}/${routes.length} routes healthy.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
