const { readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');

const filePath = resolve(__dirname, '../src/admin/pages/AdminModeration/AdminModerationWorkspace.jsx');

let content = readFileSync(filePath, 'utf8');

const OLD = [
  '        )) : (',
  '          <div className="moderation-empty-panel">',
  '            <CheckCircle2 size={20} />',
  '            <p>No moderation items matched the current filters.</p>',
  '          </div>',
  '        )}'
].join('\n');

const NEW = [
  '        ) : (',
  '          <div className="admin-empty-state">',
  '            <div className="admin-empty-state__icon">\uD83D\uDCCB</div>',
  '            <h3>No content found</h3>',
  '            <p>No generated posts or drafts match the current filters.</p>',
  '            {(filters.search || filters.userId !== "all" || filters.platform !== "all" || filters.status !== "all" || filters.moderationStatus !== "all" || filters.qualityBand !== "all" || filters.dateFrom || filters.dateTo) ? (',
  '              <button',
  '                type="button"',
  '                className="admin-secondary-button"',
  '                style={{ marginTop: 12 }}',
  '                onClick={() => setFilters({',
  '                  search: "",',
  '                  userId: scopedUserId || "all",',
  '                  organizationId: "all",',
  '                  platform: "all",',
  '                  status: "all",',
  '                  moderationStatus: "all",',
  '                  qualityBand: "all",',
  '                  dateFrom: "",',
  '                  dateTo: "",',
  '                })}',
  '              >',
  '                Clear filters',
  '              </button>',
  '            ) : null}',
  '          </div>',
  '        )}'
].join('\n');

if (!content.includes(OLD)) {
  // Try with \r\n line endings
  const OLD_CRLF = OLD.replace(/\n/g, '\r\n');
  if (!content.includes(OLD_CRLF)) {
    console.error('ERROR: Target string not found. Dumping surrounding context...');
    const idx = content.indexOf('moderation-empty-panel');
    if (idx >= 0) {
      console.log('Found "moderation-empty-panel" at char', idx);
      console.log(JSON.stringify(content.slice(idx - 30, idx + 200)));
    } else {
      console.log('No "moderation-empty-panel" found at all in file');
    }
    process.exit(1);
  }
  content = content.replace(OLD_CRLF, NEW);
} else {
  content = content.replace(OLD, NEW);
}

writeFileSync(filePath, content, 'utf8');
console.log('SUCCESS: Moderation empty state fix applied.');
