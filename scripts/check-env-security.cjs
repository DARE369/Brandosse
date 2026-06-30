#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");

const sourceRoots = ["app", "src", "pages", "scripts"].map((entry) => path.join(rootDir, entry));
const extensions = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

const serverOnlyPathParts = [
  `${path.sep}app${path.sep}api${path.sep}`,
  `${path.sep}src${path.sep}app${path.sep}api${path.sep}`,
  `${path.sep}src${path.sep}lib${path.sep}video-engine${path.sep}`,
  `${path.sep}scripts${path.sep}`,
];

const allowedClientEnvNames = new Set([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLIC_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_ENABLE_PROMPT_SUGGESTIONS_EDGE_IN_DEV",
  "NODE_ENV",
]);

const allowedLegacyMentions = new Set();

function toRepoPath(filePath) {
  return path.relative(rootDir, filePath).replaceAll(path.sep, "/");
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function isServerOnlyFile(filePath) {
  return serverOnlyPathParts.some((part) => filePath.includes(part));
}

function report(issues, filePath, lineNumber, message) {
  issues.push(`${toRepoPath(filePath)}:${lineNumber}: ${message}`);
}

const issues = [];
const files = sourceRoots.flatMap((dir) => walk(dir));

for (const filePath of files) {
  const repoPath = toRepoPath(filePath);
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const serverOnly = isServerOnlyFile(filePath);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const envAccesses = [...line.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]);
    const runtimeEnvAccesses = [...line.matchAll(/getRuntimeEnvValue\(['"]([^'"]+)['"]/g)].map((match) => match[1]);
    const allAccesses = [...envAccesses, ...runtimeEnvAccesses];

    for (const name of allAccesses) {
      if (!serverOnly && !allowedClientEnvNames.has(name)) {
        report(issues, filePath, lineNumber, `client/shared code reads non-public env "${name}"`);
      }

      if (!serverOnly && /^NEXT_PUBLIC_.*(SECRET|SERVICE|TOKEN|PRIVATE|API_KEY|WEBHOOK)/.test(name)) {
        report(issues, filePath, lineNumber, `public env "${name}" looks like a secret`);
      }

      if (name.startsWith("VITE_") && !allowedLegacyMentions.has(repoPath)) {
        report(issues, filePath, lineNumber, `legacy VITE env "${name}" is not allowed in active app code`);
      }
    }

    const literalViteMentions = [...line.matchAll(/\bVITE_[A-Z0-9_]+\b/g)].map((match) => match[0]);
    for (const name of literalViteMentions) {
      if (!allowedLegacyMentions.has(repoPath)) {
        report(issues, filePath, lineNumber, `legacy VITE env mention "${name}" is not allowed in active app code`);
      }
    }

    const secretNameMentions = [...line.matchAll(/\b(SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|PAYSTACK_SECRET_KEY|GROQ_API_KEY|GROK_API_KEY|XAI_API_KEY|ANTHROPIC_API_KEY|REPLICATE_API_TOKEN|VIDEO_WORKER_WEBHOOK_SECRET)\b/g)].map((match) => match[0]);
    for (const name of secretNameMentions) {
      if (!serverOnly && !allowedLegacyMentions.has(repoPath)) {
        report(issues, filePath, lineNumber, `server secret "${name}" mentioned in client/shared code`);
      }
    }
  });
}

if (issues.length > 0) {
  console.error("Environment security check failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Environment security check passed.");
