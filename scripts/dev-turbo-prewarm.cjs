#!/usr/bin/env node

const { spawn } = require("node:child_process");

const port = process.env.PORT || "3000";
const host = process.env.HOSTNAME || "localhost";
const baseUrl = process.env.NEXT_DEV_PREWARM_BASE_URL || `http://${host}:${port}`;
const defaultRoutes = [
  "/",
  "/login",
  "/app/dashboard",
  "/app/generate",
  "/app/calendar",
  "/app/library",
  "/app/admin",
  "/app/org/test-org/workspace",
];

const routes = (process.env.NEXT_DEV_PREWARM_ROUTES || defaultRoutes.join(","))
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);

const nextArgs = ["node_modules/next/dist/bin/next", "dev", "--turbopack"];
const nextDev = spawn(process.execPath, nextArgs, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

let shuttingDown = false;

function stop(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!nextDev.killed) nextDev.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("exit", () => stop("SIGTERM"));

nextDev.on("exit", (code, signal) => {
  if (shuttingDown) return;
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status < 500) return;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }

  throw lastError || new Error(`Timed out waiting for ${baseUrl}`);
}

async function warmRoute(route) {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}${route}`, {
    redirect: "manual",
    headers: {
      "x-dev-prewarm": "1",
    },
  });
  await response.arrayBuffer();
  return {
    route,
    status: response.status,
    elapsedMs: Date.now() - startedAt,
  };
}

async function prewarm() {
  if (process.env.NEXT_DEV_PREWARM === "0") return;

  try {
    await waitForServer();
    console.log(`\nPrewarming ${routes.length} Turbopack route families at ${baseUrl}`);

    for (const route of routes) {
      try {
        const result = await warmRoute(route);
        console.log(`prewarm ${result.route} ${result.status} ${result.elapsedMs}ms`);
      } catch (error) {
        console.warn(`prewarm ${route} failed: ${error.message}`);
      }
    }

    console.log("Prewarm complete. Dev server is ready.\n");
  } catch (error) {
    console.warn(`Dev prewarm skipped: ${error.message}`);
  }
}

prewarm();
