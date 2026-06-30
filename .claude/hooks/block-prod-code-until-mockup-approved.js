#!/usr/bin/env node
/*
 * PreToolUse gate for the Calendar & Library rebuild (see docs/calendar-library-rebuild/MASTER_BRIEF.md, rule 6).
 * Denies Write/Edit against production code (src/**, supabase/migrations/**, supabase/functions/**)
 * until docs/calendar-library-rebuild/MOCKUP_APPROVED exists.
 */
const fs = require('fs');
const path = require('path');

const BLOCKED_PREFIXES = ['src/', 'supabase/migrations/', 'supabase/functions/'];
const MARKER_RELATIVE_PATH = ['docs', 'calendar-library-rebuild', 'MOCKUP_APPROVED'];

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(input || '{}');
  } catch {
    process.exit(0);
  }

  const filePath = payload?.tool_input?.file_path;
  if (!filePath) {
    process.exit(0);
  }

  const projectRoot = process.cwd();
  const absPath = path.resolve(projectRoot, filePath);
  const rel = path.relative(projectRoot, absPath).split(path.sep).join('/');

  const isBlocked = BLOCKED_PREFIXES.some(
    (prefix) => rel === prefix.slice(0, -1) || rel.startsWith(prefix)
  );
  if (!isBlocked) {
    process.exit(0);
  }

  const markerPath = path.join(projectRoot, ...MARKER_RELATIVE_PATH);
  if (fs.existsSync(markerPath)) {
    process.exit(0);
  }

  const reason =
    `Blocked: "${rel}" is production code (src/**, supabase/migrations/**, or supabase/functions/**). ` +
    'The Calendar & Library rebuild gates all production-code writes until ' +
    'docs/calendar-library-rebuild/MOCKUP_APPROVED exists - create that marker only after the human ' +
    'has explicitly approved a mockup for the active packet (Master Brief §0 rules 1 and 6).';

  process.stdout.write(
    JSON.stringify({
      systemMessage: reason,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
});
