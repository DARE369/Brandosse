const { spawn } = require("node:child_process");
const path = require("node:path");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3001";
const port = new URL(baseURL).port || "3001";
const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const playwrightCli = path.join(process.cwd(), "node_modules", "@playwright", "test", "cli.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isReachable() {
  try {
    const response = await fetch(baseURL, { signal: AbortSignal.timeout(5_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable()) return true;
    await delay(1_000);
  }
  return false;
}

function spawnServer() {
  return spawn(process.execPath, [nextBin, "start", "-p", port], {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: true,
  });
}

function runPlaywright(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [playwrightCli, "test", ...args], {
      cwd: process.cwd(),
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        E2E_BASE_URL: baseURL,
      },
    });

    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  let server = null;

  if (!(await isReachable())) {
    server = spawnServer();
    const ready = await waitForServer();
    if (!ready) {
      if (server && !server.killed) server.kill("SIGTERM");
      console.error(`Timed out waiting for ${baseURL}`);
      process.exit(1);
    }
  }

  const code = await runPlaywright(process.argv.slice(2));

  if (server && !server.killed) {
    server.kill("SIGTERM");
    await delay(1_000);
    if (!server.killed) server.kill("SIGKILL");
  }

  process.exit(code);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
