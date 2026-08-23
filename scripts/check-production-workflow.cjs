#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const nextConfigPath = path.join(rootDir, "next.config.mjs");
const nextConfig = fs.existsSync(nextConfigPath) ? fs.readFileSync(nextConfigPath, "utf8") : "";

const expectedScripts = {
  dev: "node scripts/dev-turbo-prewarm.cjs",
  "dev:next": "node scripts/dev-turbo-prewarm.cjs",
  "dev:turbo": "next dev --turbopack",
  "dev:webpack": "next dev --webpack",
  build: "next build --turbopack",
  "build:next": "next build --turbopack",
  "build:webpack": "next build --webpack",
  "build:turbo": "next build --turbopack",
  "start:next": "next start",
  "smoke:routes": "node scripts/smoke-routes.cjs",
  "check:env-security": "node scripts/check-env-security.cjs",
};

const issues = [];

for (const [name, expected] of Object.entries(expectedScripts)) {
  const actual = packageJson.scripts?.[name];
  if (actual !== expected) {
    issues.push(`package.json script "${name}" must be "${expected}", found "${actual || "<missing>"}"`);
  }
}

if (/\bvite\b|@vitejs\/plugin-react|react-router-dom|gh-pages/.test(JSON.stringify(packageJson))) {
  issues.push("package.json still references removed Vite/React Router/GitHub Pages runtime dependencies.");
}

if (/env\s*:\s*{/.test(nextConfig) || /\bVITE_/.test(nextConfig)) {
  issues.push("next.config.mjs must not inject runtime env aliases or legacy VITE_* values.");
}

const nextDir = path.join(rootDir, ".next");
const buildIdPath = path.join(nextDir, "BUILD_ID");
// A running dev server creates .next/dev and never writes BUILD_ID, so a
// developer with `npm run dev` up would fail this check every time. A guard
// that cries wolf gets ignored — and an ignored guard is worse than none, which
// is the whole reason this lockdown exists. Only flag a .next that is neither a
// production build NOR an active dev server: that is a genuinely broken build.
const isDevServerArtifact = fs.existsSync(path.join(nextDir, "dev"));
if (fs.existsSync(nextDir) && !fs.existsSync(buildIdPath) && !isDevServerArtifact) {
  issues.push(".next exists but has neither BUILD_ID nor a dev-server marker — the build is incomplete. Clear .next and run npm run build.");
}

if (issues.length > 0) {
  console.error("Production workflow check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Production workflow check passed.");
