"use client";

import { useMemo, useState } from "react";
import { Save, Calendar, Send, Sparkles, RefreshCw } from "lucide-react";
import { Card, Badge, Button, Dropdown } from "../../ui-v2";
import { platformNeedsTitle, getPlatformSpec } from "../../services/platforms/platformCaptionSpecs";
import PlatformFitStrip from "./PlatformFitStrip";
import styles from "./PostProductionPanel.module.css";

const SCORE_DIMS = [
  ["readability", "Readability"],
  ["hookStrength", "Hook strength"],
  ["hashtagQuality", "Hashtag quality"],
  ["brandConsistency", "Brand consistency"],
  ["platformFit", "Platform fit"],
];

function scoreColor(v) {
  if (v >= 85) return "var(--uiv2-success)";
  if (v >= 65) return "var(--uiv2-warning)";
  return "var(--uiv2-danger)";
}

/**
 * Single unified post-production panel — title/caption/hashtags, real
 * discovery score (seo-score edge function via optimizeSeo/scoreSeo in
 * SessionStore), and a real target-account dropdown (backed by
 * connected_accounts, not a hardcoded platform list). Replaces the old
 * dual StudioPublishPanel + legacy PostProductionSheet flow.
 */
export default function PostProductionPanel({
  published,
  selectedGeneration,
  postProduction,
  updatePostProduction,
  publishing,
  accounts,
  onSaveDraft,
  onOpenSchedule,
  onOpenPublishConfirm,
  onClose,
  onGenerateAnother,
  onRegenerateMetadata,
  onRescore,
  metadataRetryAfter = 0,
  seoRetryAfter = 0,
}) {
  const [tagValue, setTagValue] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);

  const selectedIds = postProduction.selectedPlatforms || [];
  const selectedAccountId = selectedIds[0] || null;
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || null;
  const isSeoBusy = postProduction.seoStatus === "scoring" || postProduction.seoStatus === "optimizing";

  const mediaType = selectedGeneration?.media_type || "image";

  // One entry per selected account, for the per-platform fit strip. Deduped by
  // platform so two Instagram accounts don't show two identical fit chips.
  const selectedPlatformList = useMemo(() => {
    const seen = new Set();
    return selectedIds
      .map((id) => accounts.find((a) => a.id === id))
      .filter(Boolean)
      .filter((a) => {
        const key = String(a.platform || "").toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((a) => ({ id: a.id, platform: a.platform, label: getPlatformSpec(a.platform).label }));
  }, [selectedIds, accounts]);

  // Any selected platform that wants a separate title (YouTube/Pinterest, or
  // TikTok when this is a photo post) → the Title field is shown. Otherwise
  // it's hidden (Instagram/X/etc. are caption-only).
  const showTitleField = selectedPlatformList.some((p) => platformNeedsTitle(p.platform, mediaType));

  const toggleAccount = (id) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    updatePostProduction({ selectedPlatforms: next });
  };

  const handleAutoFit = (platformKey, trimmed) => {
    // v1: one base caption. Auto-fit trims the base to the tightest selected
    // platform's cap. (Per-platform overrides are the deferred v2.)
    updatePostProduction({ caption: trimmed });
  };

  // Pre-publish guard: does the current caption/title overrun any selected
  // platform's hard cap? Surfaced on the Publish button so the user fixes it
  // before delivery instead of the server rejecting it (or silently trimming).
  const overLimitPlatforms = useMemo(() => {
    const caption = postProduction.caption || "";
    const tags = postProduction.hashtags || [];
    const title = postProduction.title || "";
    const body = [caption, tags.join(" ")].filter(Boolean).join("\n\n");
    return selectedPlatformList.filter((p) => {
      const spec = getPlatformSpec(p.platform);
      const capOver = [...body].length > spec.captionMax;
      const needsTitle = platformNeedsTitle(p.platform, mediaType);
      const titleOver = needsTitle && spec.titleMax && [...title].length > spec.titleMax;
      const titleMissing = needsTitle && !title.trim();
      return capOver || titleOver || titleMissing;
    });
  }, [postProduction.caption, postProduction.hashtags, postProduction.title, selectedPlatformList, mediaType]);
  const hasBlockingFit = overLimitPlatforms.length > 0;

  const addHashtag = () => {
    const t = tagValue.trim();
    if (!t) return;
    const tag = t.startsWith("#") ? t : `#${t}`;
    updatePostProduction({ hashtags: [...(postProduction.hashtags || []), tag] });
    setTagValue("");
  };
  const removeHashtag = (idx) => {
    updatePostProduction({ hashtags: (postProduction.hashtags || []).filter((_, i) => i !== idx) });
  };

  if (published) {
    return (
      <Card className={styles.panel}>
        <div className={styles.publishedBox}>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Published (simulated)</div>
          <div style={{ fontSize: 12.5, color: "var(--uiv2-text-secondary)", marginBottom: 16 }}>
            "{postProduction.title || selectedGeneration?.prompt?.slice(0, 40) || "Your post"}" was queued to{" "}
            {selectedAccount ? (selectedAccount.display_name || selectedAccount.account_name) : "your account"}.
          </div>
          <Button onClick={onGenerateAnother}>
            <Sparkles size={14} aria-hidden="true" /> Generate another
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.kicker}>Post production</span>
        <Badge tone="warning">Simulated publish</Badge>
      </div>

      {/* Title only shows when a selected platform actually uses one
          (YouTube/Pinterest always; TikTok for photo posts). Caption-only
          platforms (Instagram/X/LinkedIn/Facebook/Threads) hide it. */}
      {showTitleField && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Title</span>
          <input
            className={styles.input}
            value={postProduction.title || ""}
            onChange={(e) => updatePostProduction({ title: e.target.value })}
          />
        </label>
      )}

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Caption</span>
        <textarea
          className={[styles.input, styles.textarea].join(" ")}
          value={postProduction.caption || ""}
          onChange={(e) => updatePostProduction({ caption: e.target.value })}
        />
      </label>

      {selectedPlatformList.length > 0 && (
        <PlatformFitStrip
          platforms={selectedPlatformList}
          caption={postProduction.caption || ""}
          hashtags={postProduction.hashtags || []}
          title={postProduction.title || ""}
          mediaType={mediaType}
          onAutoFit={handleAutoFit}
        />
      )}

      {/* WEEK 2 FIX 3 (+ ADDENDUM UPGRADE 2): manual recovery control —
          works whether the automatic publish-stage hydrate never ran, is
          still running, or got stuck. metadataStatus is server-owned
          (generate-post-metadata writes in_progress/completed/failed
          itself) plus stale-'in_progress' rows get reconciled to 'failed'
          on read, so this button is never permanently blocked. */}
      <div className={styles.metadataActionRow}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRegenerateMetadata}
          disabled={postProduction.metadataStatus === "in_progress" || metadataRetryAfter > 0}
        >
          <RefreshCw size={12} aria-hidden="true" />
          {metadataRetryAfter > 0
            ? `Retry in ${metadataRetryAfter}s`
            : postProduction.metadataStatus === "in_progress" ? "Regenerating…" : "Regenerate caption & title"}
        </Button>
        {postProduction.metadataStatus === "failed" && metadataRetryAfter === 0 && (
          <span className={styles.metadataFailedHint}>Last attempt failed — try again.</span>
        )}
      </div>

      <div className={styles.tagRow}>
        {(postProduction.hashtags || []).map((tag, i) => (
          <span key={`${tag}-${i}`} className={styles.tag}>
            {tag}
            <button type="button" className={styles.tagRemove} onClick={() => removeHashtag(i)} aria-label={`Remove ${tag}`}>✕</button>
          </span>
        ))}
      </div>
      <div className={styles.tagInput}>
        <input
          className={[styles.input, styles.tagInputField].join(" ")}
          placeholder="Add a hashtag…"
          value={tagValue}
          onChange={(e) => setTagValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addHashtag(); } }}
        />
        <Button variant="subtle" size="sm" onClick={addHashtag}>Add</Button>
      </div>

      <div>
        <div className={styles.scoreRow}>
          <span className={styles.fieldLabel}>Discovery readiness</span>
          {/* WEEK 2 FIX 3/4: "not scored yet" / "failed" must never look
              like a real score of 0 — scoreColor(0) would otherwise render
              a red "0" indistinguishable from a genuinely poor score. */}
          {isSeoBusy ? (
            <span className={styles.scoreValue}>…</span>
          ) : postProduction.seoStatus === "failed" ? (
            <span className={styles.scoreValue} style={{ color: "var(--uiv2-text-secondary)" }}>—</span>
          ) : postProduction.seoStatus === "scored" ? (
            <span className={styles.scoreValue} style={{ color: scoreColor(postProduction.seoScore || 0) }}>
              {postProduction.seoScore ?? 0}
            </span>
          ) : (
            <span className={styles.scoreValue} style={{ color: "var(--uiv2-text-secondary)" }}>—</span>
          )}
        </div>
        {postProduction.seoStatus === "failed" && (
          <div className={styles.scoreFailedRow}>
            <span className={styles.metadataFailedHint}>Scoring unavailable.</span>
            <Button variant="ghost" size="sm" onClick={onRescore} disabled={isSeoBusy || seoRetryAfter > 0}>
              <RefreshCw size={12} aria-hidden="true" /> {seoRetryAfter > 0 ? `Retry in ${seoRetryAfter}s` : "Retry"}
            </Button>
          </div>
        )}
        {!isSeoBusy && postProduction.seoStatus !== "failed" && (
          <div className={styles.scoreFailedRow}>
            <Button variant="ghost" size="sm" onClick={onRescore} disabled={isSeoBusy || seoRetryAfter > 0}>
              <RefreshCw size={12} aria-hidden="true" /> {seoRetryAfter > 0 ? `Retry in ${seoRetryAfter}s` : "Re-score"}
            </Button>
          </div>
        )}
        {postProduction.seoStatus === "scored" && postProduction.seoBreakdown && (
          <div className={styles.scoreBars}>
            {SCORE_DIMS.map(([key, label]) => {
              const val = postProduction.seoBreakdown?.[key] ?? 0;
              return (
                <div key={key} className={styles.scoreBarRow}>
                  <span className={styles.scoreBarLabel}>{label}</span>
                  <div className={styles.scoreTrack}>
                    <div className={styles.scoreFill} style={{ width: `${val}%`, background: scoreColor(val) }} />
                  </div>
                  <span className={styles.scoreNum}>{val}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Target accounts <span style={{ color: "var(--uiv2-text-tertiary)" }}>— posts to every selected account</span></span>
        <Dropdown
          open={accountOpen}
          onClose={() => setAccountOpen(false)}
          align="left"
          width="100%"
          trigger={
            <button type="button" className={styles.dropdownBtn} onClick={() => setAccountOpen((o) => !o)}>
              <span>
                {selectedIds.length === 0
                  ? "Choose accounts"
                  : selectedIds.length === 1
                    ? (selectedAccount?.display_name || selectedAccount?.account_name || selectedAccount?.platform || "1 account")
                    : `${selectedIds.length} accounts selected`}
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: accountOpen ? "rotate(180deg)" : "none" }}><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          }
        >
          {accounts.length === 0 ? (
            <div style={{ padding: "8px 9px", fontSize: 12.5, color: "var(--uiv2-text-secondary)" }}>No connected accounts</div>
          ) : (
            accounts.map((a) => {
              const on = selectedIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  className={styles.dropdownItem}
                  onClick={() => toggleAccount(a.id)}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                      border: `1.5px solid ${on ? "var(--uiv2-accent-solid)" : "var(--uiv2-border-strong)"}`,
                      background: on ? "var(--uiv2-accent-solid)" : "transparent",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4"><path d="M5 12l5 5 9-11" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </span>
                    {a.display_name || a.account_name || a.platform}
                  </span>
                </button>
              );
            })
          )}
        </Dropdown>
      </div>

      <div className={styles.footer}>
        <Button variant="subtle" onClick={onSaveDraft} disabled={publishing}>
          <Save size={13} aria-hidden="true" /> Save as draft
        </Button>
        <Button variant="subtle" onClick={onOpenSchedule} disabled={publishing}>
          <Calendar size={13} aria-hidden="true" /> Schedule…
        </Button>
        <Button
          onClick={onOpenPublishConfirm}
          disabled={publishing || selectedIds.length === 0 || hasBlockingFit}
          title={hasBlockingFit ? `Fix the caption for ${overLimitPlatforms.map((p) => p.label).join(", ")} first` : undefined}
          style={{ marginLeft: "auto" }}
        >
          <Send size={13} aria-hidden="true" />
          {hasBlockingFit
            ? `${overLimitPlatforms.length} platform${overLimitPlatforms.length > 1 ? "s" : ""} need${overLimitPlatforms.length > 1 ? "" : "s"} attention`
            : "Publish now"}
        </Button>
      </div>
    </Card>
  );
}
