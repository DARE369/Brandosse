"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { BookmarkPlus, Check, Loader2 } from "lucide-react";
import ClipListPanel from "./ClipListPanel";
import ClipPreviewPanel from "./ClipPreviewPanel";
import PreviewModal from "./PreviewModal";
import { useSignedUrls } from "@/hooks/video-engine/useSignedUrls";
import { normalizeScore, scoreColor, formatDuration, SCORE_BAR_COLORS } from "./clip-utils";
import { saveClipToLibrary } from "./clipLibraryActions";

function useLocalStorage(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setAndStore = useCallback((newValue) => {
    setValue(newValue);
    try {
      localStorage.setItem(key, JSON.stringify(newValue));
    } catch {
      // Storage unavailable — in-memory state still works
    }
  }, [key]);

  return [value, setAndStore];
}

// ─── ClipTableView ──────────────────────────────────────────────────────────
// 48px rows — all metadata in columns, eye icon opens modal.
function ClipTableView({ clips, onPreview }) {
  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "44px" }} />
          <col style={{ width: "62px" }} />
          <col />
          <col style={{ width: "58px" }} />
          <col style={{ width: "100px" }} />
          <col style={{ width: "72px" }} />
          <col style={{ width: "76px" }} />
        </colgroup>
        <thead>
          <tr style={{ background: "var(--color-background-secondary)" }}>
            {["#", "Score", "Title", "Dur", "Platform", "Scores", ""].map((h) => (
              <th key={h} style={{
                padding:       "6px 8px",
                textAlign:     "left",
                fontSize:      10,
                fontWeight:    500,
                color:         "var(--color-text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                borderBottom:  "0.5px solid var(--color-border-tertiary)",
                position:      "sticky",
                top:           0,
                background:    "var(--color-background-secondary)",
                zIndex:        1,
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {clips.map((clip, index) => {
            const overall  = normalizeScore(clip.overall_score);
            const hook     = normalizeScore(clip.hook_score);
            const flow     = normalizeScore(clip.flow_score);
            const value    = normalizeScore(clip.content_score);
            const trend    = normalizeScore(clip.trend_score);
            const isFailed = clip.render_status === "failed";

            return (
              <tr
                key={clip.id}
                style={{ height: 48, opacity: isFailed ? 0.5 : 1, background: "var(--color-background-primary)" }}
                aria-label={
                  isFailed
                    ? `Clip ${index + 1}: failed - ${clip.error_message || "render failed"}. Credits not deducted.`
                    : undefined
                }
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-background-secondary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--color-background-primary)"; }}
              >
                <td style={{ padding: "0 8px", fontSize: 11, color: "var(--color-text-secondary)", textAlign: "center",
                  borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                  {index + 1}
                </td>

                <td style={{ padding: "0 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                  {overall !== null ? (
                    <div style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 30, height: 30, borderRadius: "50%",
                      background: `${scoreColor(overall)}18`,
                      fontSize: 11, fontWeight: 600,
                      color: scoreColor(overall),
                    }}>
                      {overall}
                    </div>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>—</span>
                  )}
                </td>

                <td style={{ padding: "0 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                  <div style={{
                    fontSize: 12, fontWeight: 500,
                    color: isFailed ? "var(--color-text-secondary)" : "var(--color-text-primary)",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {clip.ai_title || `Clip ${clip.clip_index + 1}`}
                  </div>
                  {isFailed && (
                    <div style={{ fontSize: 9, color: "var(--color-danger)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {(clip.error_message || "render failed").slice(0, 50)}
                      <span style={{ color: "var(--color-text-secondary)" }}> · Credits not deducted</span>
                    </div>
                  )}
                </td>

                <td style={{ padding: "0 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                  <span style={{ fontSize: 11, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                    {isFailed ? "—" : formatDuration(clip.duration_secs)}
                  </span>
                </td>

                <td style={{ padding: "0 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                  {clip.platform_target && (
                    <span style={{
                      fontSize: 9, padding: "2px 6px", borderRadius: 6,
                      background: "var(--color-background-secondary)",
                      border: "0.5px solid var(--color-border-tertiary)",
                      color: "var(--color-text-secondary)", whiteSpace: "nowrap",
                    }}>
                      {clip.platform_target}
                    </span>
                  )}
                </td>

                <td style={{ padding: "0 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                  {!isFailed && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {[
                        { val: hook,  color: SCORE_BAR_COLORS.Hook  },
                        { val: flow,  color: SCORE_BAR_COLORS.Flow  },
                        { val: value, color: SCORE_BAR_COLORS.Value },
                        { val: trend, color: SCORE_BAR_COLORS.Trend },
                      ].map(({ val, color }, i) => (
                        <div key={i} style={{
                          height: 2, background: "var(--color-border-tertiary)", borderRadius: 1, overflow: "hidden",
                        }}>
                          {val !== null && (
                            <div style={{ height: "100%", width: `${val}%`, background: color, borderRadius: 1 }} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </td>

                <td style={{ padding: "0 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button
                      onClick={() => onPreview(clip)}
                      title="Preview clip"
                      aria-label={`Preview ${clip.ai_title || "clip"}`}
                      style={{
                        width: 26, height: 26,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        border: "0.5px solid var(--color-border-tertiary)",
                        borderRadius: 5,
                        background: "var(--color-background-primary)",
                        color: "var(--color-text-secondary)",
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      ⊙
                    </button>
                    {!isFailed && clip.public_url && (
                      <a
                        href={clip.public_url}
                        download={`clip-${clip.clip_index + 1}.mp4`}
                        title="Download clip"
                        aria-label={`Download ${clip.ai_title || "clip"}`}
                        style={{
                          width: 26, height: 26,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          border: "0.5px solid var(--color-border-tertiary)",
                          borderRadius: 5,
                          background: "var(--color-background-primary)",
                          color: "var(--color-text-secondary)",
                          textDecoration: "none",
                          fontSize: 12,
                        }}
                      >
                        ↓
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── ClipsGallery ────────────────────────────────────────────────────────────
// Root div uses height: 100% — the parent must supply a fixed height so this
// propagates correctly (see the wrapper div in JobDetailView).
//
// Accepts jobTitle/jobId for backward compatibility with the current
// JobDetailView call site; they are unused here.
export default function ClipsGallery({ clips: rawClips, job, jobTitle, jobId }) {
  const { clips, refreshClip, isRefreshing } = useSignedUrls(rawClips);
  const [layoutMode, setLayoutMode] = useLocalStorage("video-lab-layout-mode", "split");
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [previewModalClip, setPreviewModalClip] = useState(null);
  // clipId -> personal_assets id. Shared across the gallery, list/table
  // rows, the split-view panel, and the modal so a clip saved from any one
  // of those surfaces is immediately known-saved everywhere else — avoids
  // uploadPersonalAsset creating a second Library row for the same clip.
  const [savedClips, setSavedClips] = useState(() => new Map());
  const handleClipSaved = useCallback((clipId, assetId) => {
    setSavedClips((prev) => new Map(prev).set(clipId, assetId));
  }, []);
  const [savingAll, setSavingAll] = useState(false);
  const [saveAllError, setSaveAllError] = useState("");

  // Keep completed and failed separate so failed clips fall to the bottom of
  // list/table views rather than being interleaved with scored clips.
  const completedClips = useMemo(
    () => clips.filter(c => c.render_status === "complete"),
    [clips]
  );
  const failedClips = useMemo(
    () => clips.filter(c => c.render_status === "failed"),
    [clips]
  );
  const sortedCompleted = useMemo(
    () => [...completedClips].sort((a, b) => {
      const sA = normalizeScore(a.overall_score) ?? -1;
      const sB = normalizeScore(b.overall_score) ?? -1;
      return sB - sA;
    }),
    [completedClips]
  );
  const allListClips = useMemo(
    () => [...sortedCompleted, ...failedClips],
    [sortedCompleted, failedClips]
  );
  const selectedClip = useMemo(
    () => clips.find(c => c.id === selectedClipId) ?? null,
    [clips, selectedClipId]
  );

  // Auto-select the top-scored complete clip the first time clips arrive.
  // useEffect (not derived state) so the user can later deselect without
  // the selection snapping back on every re-render.
  useEffect(() => {
    if (sortedCompleted.length > 0 && selectedClipId === null) {
      setSelectedClipId(sortedCompleted[0].id);
    }
  }, [sortedCompleted, selectedClipId]);

  const handleSelectById     = useCallback((clipId) => setSelectedClipId(clipId), []);
  const handleTableRowPreview = useCallback((clip) => setPreviewModalClip(clip), []);
  const handleCloseModal      = useCallback(() => setPreviewModalClip(null), []);
  const handleRefreshUrl      = useCallback((clipId) => refreshClip(clipId), [refreshClip]);

  // In list mode ClipListPanel calls onSelect(clipId) — look up the full clip here
  const handleListRowClick = useCallback((clipId) => {
    const clip = clips.find(c => c.id === clipId);
    if (clip) setPreviewModalClip(clip);
  }, [clips]);

  const completedCount = completedClips.length;
  const failedCount    = failedClips.length;
  const unsavedCount = sortedCompleted.filter((c) => !savedClips.has(c.id)).length;

  const handleSaveAll = useCallback(async () => {
    const targets = sortedCompleted.filter((c) => !savedClips.has(c.id));
    if (targets.length === 0) return;
    setSavingAll(true);
    setSaveAllError("");
    let failures = 0;
    for (const clip of targets) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const assetId = await saveClipToLibrary(clip);
        handleClipSaved(clip.id, assetId);
      } catch {
        failures += 1;
      }
    }
    setSavingAll(false);
    if (failures > 0) setSaveAllError(`${failures} clip${failures === 1 ? "" : "s"} could not be saved.`);
  }, [sortedCompleted, savedClips, handleClipSaved]);

  if (clips.length === 0) {
    return (
      <div style={{
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        height: "100%", padding: "40px 20px", textAlign: "center",
      }}>
        <p style={{ fontSize: 16, margin: "0 0 8px", color: "var(--color-text-primary)" }}>
          No clips were generated.
        </p>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          This can happen if the video has no speech or the AI could not identify any compelling moments.
        </p>
      </div>
    );
  }

  const LAYOUT_BUTTONS = [
    { id: "split", label: "▶", title: "Split panel" },
    { id: "list",  label: "≡", title: "List"        },
    { id: "table", label: "⊟", title: "Table"       },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>

      {/* ── Header ── */}
      <div style={{
        display:      "flex",
        alignItems:   "center",
        gap:          12,
        padding:      "10px 16px",
        borderBottom: "0.5px solid var(--color-border-tertiary)",
        background:   "var(--color-background-secondary)",
        flexShrink:   0,
      }}>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>
            {completedCount} clip{completedCount !== 1 ? "s" : ""} ready
          </p>
          <p style={{ margin: "1px 0 0", fontSize: 11, color: "var(--color-text-secondary)" }}>
            Sorted by virality score · highest first
            {failedCount > 0 && ` · ${failedCount} failed`}
            {isRefreshing && " · refreshing links…"}
          </p>
        </div>

        {completedCount > 0 ? (
          <button
            onClick={handleSaveAll}
            disabled={savingAll || unsavedCount === 0}
            title={unsavedCount === 0 ? "All clips saved to Library" : `Save ${unsavedCount} clip${unsavedCount === 1 ? "" : "s"} to Library`}
            style={{
              display:      "flex", alignItems: "center", gap: 6,
              padding:      "0 12px", height: 28,
              borderRadius: 7,
              border:       "0.5px solid var(--color-border-tertiary)",
              background:   "var(--color-background-primary)",
              color:        unsavedCount === 0 ? "var(--color-text-secondary)" : "var(--color-text-primary)",
              fontSize:     11, fontWeight: 500,
              cursor:       unsavedCount === 0 ? "default" : "pointer",
              whiteSpace:   "nowrap",
            }}
          >
            {savingAll ? <Loader2 size={13} style={{ animation: "spin 0.8s linear infinite" }} /> : unsavedCount === 0 ? <Check size={13} /> : <BookmarkPlus size={13} />}
            {savingAll ? "Saving…" : unsavedCount === 0 ? "All saved" : `Save all (${unsavedCount})`}
          </button>
        ) : null}

        {/* Single-border group wrapping all three toggle buttons */}
        <div style={{
          display:      "flex",
          border:       "0.5px solid var(--color-border-tertiary)",
          borderRadius: 7,
          overflow:     "hidden",
        }}>
          {LAYOUT_BUTTONS.map(({ id, label, title }) => (
            <button
              key={id}
              onClick={() => setLayoutMode(id)}
              title={title}
              aria-label={title}
              aria-pressed={layoutMode === id}
              style={{
                width:          30,
                height:         28,
                display:        "flex",
                alignItems:     "center",
                justifyContent: "center",
                border:         "none",
                borderLeft:     id !== "split" ? "0.5px solid var(--color-border-tertiary)" : "none",
                background:     layoutMode === id
                  ? "var(--color-background-tertiary)"
                  : "var(--color-background-secondary)",
                color:          layoutMode === id
                  ? "var(--color-text-primary)"
                  : "var(--color-text-secondary)",
                cursor:         "pointer",
                fontSize:       14,
                transition:     "background 0.1s ease",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {saveAllError ? (
        <div style={{ padding: "6px 16px", fontSize: 11, color: "var(--color-danger)", flexShrink: 0 }}>
          {saveAllError}
        </div>
      ) : null}

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>

        {layoutMode === "split" && (
          <>
            <ClipListPanel
              clips={sortedCompleted}
              selectedClipId={selectedClipId}
              onSelect={handleSelectById}
            />
            <ClipPreviewPanel
              clip={selectedClip}
              onRefreshUrl={handleRefreshUrl}
              savedAssetId={selectedClip ? savedClips.get(selectedClip.id) || null : null}
              onSaved={handleClipSaved}
            />
          </>
        )}

        {layoutMode === "list" && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <ClipListPanel
              clips={allListClips}
              selectedClipId={null}
              onSelect={handleListRowClick}
              fullWidth
            />
          </div>
        )}

        {layoutMode === "table" && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <ClipTableView
              clips={allListClips}
              onPreview={handleTableRowPreview}
            />
          </div>
        )}

      </div>

      {/* Modal — absolute on this gallery root (position:relative above).
          Placed outside Body so it overlays the full gallery in all three modes. */}
      {previewModalClip && (
        <PreviewModal
          clip={previewModalClip}
          onClose={handleCloseModal}
          onRefreshUrl={handleRefreshUrl}
          savedAssetId={savedClips.get(previewModalClip.id) || null}
          onSaved={handleClipSaved}
        />
      )}

    </div>
  );
}
