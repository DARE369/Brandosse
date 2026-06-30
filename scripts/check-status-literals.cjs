#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const TARGET_FILES = [
  "src/pages/Dashboard/UserDashboard.jsx",
  "src/hooks/useRealtimeKPIs.js",
  "src/components/User/UserNavbar.jsx",
  "src/pages/CalendarPage/components/ScheduleModal.jsx",
  "src/pages/CalendarPage/components/BulkScheduleModal.jsx",
  "src/admin/pages/AdminModeration/AdminModerationPage.jsx",
  "src/admin/components/ContentModeration/PublicationModal.jsx",
  "src/admin/components/ContentModeration/ModerationQueue.jsx",
  "src/admin/components/ContentModeration/FilterBar.jsx",
  "src/admin/utils/apiService.js",
  "src/stores/CalendarStore.js",
];

const LIFECYCLE = "draft|scheduled|publishing|published|failed|processing|completed";
const RULES = [
  {
    label: ".eq(status, '...') must use constants",
    regex: new RegExp(`\\.eq\\(\\s*['"]status['"]\\s*,\\s*['"](${LIFECYCLE})['"]`),
  },
  {
    label: ".neq(status, '...') must use constants",
    regex: new RegExp(`\\.neq\\(\\s*['"]status['"]\\s*,\\s*['"](${LIFECYCLE})['"]`),
  },
  {
    label: ".in(status, ['...']) must use constants",
    regex: new RegExp(`\\.in\\(\\s*['"]status['"]\\s*,\\s*\\[[^\\]]*['"](${LIFECYCLE})['"]`),
  },
  {
    label: "status: '...' assignments must use constants",
    regex: new RegExp(`\\bstatus\\s*:\\s*['"](${LIFECYCLE})['"]`),
  },
];

const violations = [];

for (const relativePath of TARGET_FILES) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    violations.push({
      file: relativePath,
      line: 0,
      rule: "Target file missing",
      source: "Expected file does not exist",
    });
    continue;
  }

  const lines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    // Constant-backed usage is always allowed.
    if (line.includes("POST_STATUS.") || line.includes("GENERATION_STATUS.")) return;

    for (const rule of RULES) {
      if (rule.regex.test(line)) {
        violations.push({
          file: relativePath,
          line: index + 1,
          rule: rule.label,
          source: line.trim(),
        });
      }
    }
  });
}

if (violations.length > 0) {
  console.error("Status literal guardrail failed. Replace raw lifecycle strings with constants.");
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} [${violation.rule}] ${violation.source}`);
  }
  process.exit(1);
}

console.log("Status literal guardrail passed.");
