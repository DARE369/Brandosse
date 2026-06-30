#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const canonicalDocs = [
  "docs/CANONICAL_DOCS.md",
  "docs/next-migration-status.md",
  "docs/TECHNICAL_CONSTRAINTS.md",
  "docs/FEATURE_INVENTORY.md",
  "docs/platform-styling-and-theming-reference.md",
  "docs/mobile-tablet-layout-contract.md",
  "docs/POST_AND_GENERATION_LIFECYCLE_REFERENCE.md",
  "docs/handoff/README.md",
  "docs/REAL_USER_FLOW_VALIDATION.md",
];

const allowedHistoricalMentions = new Set([
  "docs/CANONICAL_DOCS.md",
  "docs/next-migration-status.md",
]);

const forbiddenPatterns = [
  /\bReact\s*\+\s*Vite\b/i,
  /\bVite\s+7\b/i,
  /\bvite\s+dev\b/i,
  /\blocalhost:5173\b/i,
  /\bsrc\/main\.jsx\b/i,
  /\bsrc\/router\/router\.jsx\b/i,
  /\bVITE_[A-Z0-9_]+\b/,
];

const issues = [];

for (const repoPath of canonicalDocs) {
  const filePath = path.join(rootDir, repoPath);
  if (!fs.existsSync(filePath)) {
    issues.push(`${repoPath}: missing canonical doc`);
    continue;
  }

  if (allowedHistoricalMentions.has(repoPath)) continue;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(line)) {
        issues.push(`${repoPath}:${index + 1}: canonical doc contains legacy runtime reference: ${line.trim()}`);
      }
    }
  });
}

if (issues.length > 0) {
  console.error("Canonical docs check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Canonical docs check passed.");

