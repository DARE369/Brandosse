#!/usr/bin/env node

const groups = [
  {
    label: "personal authenticated flow",
    vars: ["E2E_USER_EMAIL", "E2E_USER_PASSWORD"],
  },
  {
    label: "admin authenticated flow",
    vars: ["E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD"],
  },
  {
    label: "organization authenticated flow",
    vars: ["E2E_ORG_EMAIL", "E2E_ORG_PASSWORD", "E2E_ORG_ID"],
  },
];

const strict = process.env.E2E_REQUIRE_AUTH === "1" || process.argv.includes("--strict");
let missingAny = false;

console.log("E2E environment coverage");
console.log(`Base URL: ${process.env.E2E_BASE_URL || "http://localhost:3001"}`);

for (const group of groups) {
  const missing = group.vars.filter((name) => !process.env[name]);
  if (missing.length === 0) {
    console.log(`OK ${group.label}: enabled`);
    continue;
  }

  missingAny = true;
  console.log(`SKIP ${group.label}: missing ${missing.join(", ")}`);
}

if (missingAny) {
  const message = strict
    ? "Authenticated E2E coverage is required but not fully configured."
    : "Authenticated E2E coverage is not fully configured. Public/protected-route checks still run.";
  console.log(message);
}

if (strict && missingAny) {
  process.exit(1);
}
