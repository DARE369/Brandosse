#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const npmCliPath = process.env.npm_execpath
  || path.join(process.env.APPDATA || "", "npm", "node_modules", "npm", "bin", "npm-cli.js");

function getInvocation(command, args) {
  if (command !== "npm" || process.platform !== "win32") {
    return { executable: command, args };
  }

  return {
    executable: process.execPath,
    args: [npmCliPath, ...args],
  };
}

const checks = [
  ["production workflow", ["npm", ["run", "check:production-workflow"]]],
  ["canonical docs", ["npm", ["run", "check:docs-canonical"]]],
  ["environment security", ["npm", ["run", "check:env-security"]]],
  ["e2e environment", ["npm", ["run", "check:e2e-env"]]],
  ["edge functions", ["npm", ["run", "check:edge-functions"]]],
  ["status literals", ["npm", ["run", "check:status-literals"]]],
  ["ui consistency", ["npm", ["run", "check:ui-consistency"]]],
];

for (const [label, [command, args]] of checks) {
  console.log(`\n== ${label} ==`);
  const invocation = getInvocation(command, args);
  const result = spawnSync(invocation.executable, invocation.args, {
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    console.error(`Production readiness check failed at: ${label}`);
    process.exit(result.status || 1);
  }
}

console.log("\nProduction readiness checks passed.");
