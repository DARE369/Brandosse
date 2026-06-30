import { readFileSync, writeFileSync } from 'fs';

const filePath = new URL('../src/admin/pages/AdminModeration/AdminModerationWorkspace.jsx', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

let content = readFileSync(filePath, 'utf8');

const OLD = `        )) : (
          <div className="moderation-empty-panel">
            <CheckCircle2 size={20} />
            <p>No moderation items matched the current filters.</p>
          </div>
        )}`;

const NEW = `        ) : (
          <div className="admin-empty-state">
            <div className="admin-empty-state__icon">\u{1F4CB}</div>
            <h3>No content found</h3>
            <p>No generated posts or drafts match the current filters.</p>
            {(filters.search || filters.userId !== "all" || filters.platform !== "all" || filters.status !== "all" || filters.moderationStatus !== "all" || filters.qualityBand !== "all" || filters.dateFrom || filters.dateTo) ? (
              <button
                type="button"
                className="admin-secondary-button"
                style={{ marginTop: 12 }}
                onClick={() => setFilters({
                  search: "",
                  userId: scopedUserId || "all",
                  organizationId: "all",
                  platform: "all",
                  status: "all",
                  moderationStatus: "all",
                  qualityBand: "all",
                  dateFrom: "",
                  dateTo: "",
                })}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        )}`;

if (!content.includes(OLD)) {
  console.error('ERROR: Target string not found. File may have already been patched or content changed.');
  process.exit(1);
}

content = content.replace(OLD, NEW);
writeFileSync(filePath, content, 'utf8');
console.log('SUCCESS: Moderation empty state fix applied.');
