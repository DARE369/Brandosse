import React, { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  FileWarning,
  Loader2,
  PenLine,
  RefreshCcw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { useAppNavigation } from "../../../Context/AppNavigationContext";
import { useAdminLayoutContext } from "../../AdminLayoutContext";
import { useMutableSearchParams } from "../../../next/useMutableSearchParams";
import ActivityStatusBadge from "../../components/ActivityStatusBadge";
import QualityScoreBadge from "../../components/QualityScoreBadge";
import useDebouncedValue from "../../hooks/useDebouncedValue";
import { formatShortDateTime } from "../../utils/formatDate";
import PlatformIcon from "../../../components/Shared/PlatformIcon";
import { supabase } from "../../../services/supabaseClient";
import {
  MODERATION_PAGE_SIZE,
  DELETE_REASON_OPTIONS,
  FORCE_REASON_OPTIONS,
  MODERATION_STATUS_OPTIONS,
  PLATFORM_OPTIONS,
  QUALITY_BAND_OPTIONS,
  QUALITY_BREAKDOWN_FIELDS,
  REGENERATION_MODE_OPTIONS,
  STATUS_OPTIONS,
  analyzeUploadedMedia,
  assignModeratorToItems,
  archiveItems,
  calculateReadinessChecks,
  fetchAdminPostsPage,
  fetchConnectedAccountsForUser,
  fetchModerationFilterOptions,
  fetchQualityReviewDetail,
  fileToBase64,
  forceModerationAction,
  formatCaptionSnippet,
  getModerationMeta,
  getQualityBandMeta,
  getStatusMeta,
  groupModerationItems,
  markItemsApproved,
  normalizeHashtags,
  ensureModerationPost,
  promoteGeneratedVersion,
  rescoreModerationItem,
  resolveItemMediaUrl,
  runRegenerationRequest,
  saveModerationEdits,
  stripHashtagsFromCaption,
  submitDeletionRequests,
} from "./moderationApi";

const EMPTY_LIST = [];

function formatDateOnly(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function toDateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toDateTimeInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeInputValue(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toHashtagInputValue(tags) {
  return normalizeHashtags(tags).join(" ");
}

function scoreToAngle(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return "0deg";
  return `${Math.max(0, Math.min(100, numeric)) * 3.6}deg`;
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getInitials(name = "") {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "SA";
}

function normalizePlatformKey(value) {
  return String(value || "").trim().toLowerCase();
}

function getAvailableActions(item) {
  const status = item?.unified_status;
  const moderation = item?.moderation_status;

  if (status === "published") {
    return { canEdit: false, canSchedule: false, canPublish: false, canArchive: false, canDelete: true };
  }

  if (moderation === "flagged") {
    return { canEdit: true, canSchedule: true, canPublish: false, canArchive: true, canDelete: true };
  }

  if (status === "scheduled") {
    return { canEdit: true, canSchedule: false, canPublish: false, canArchive: false, canDelete: true };
  }

  return { canEdit: true, canSchedule: true, canPublish: true, canArchive: moderation === "flagged", canDelete: true };
}

function normalizeRiskFlags(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.values(value).map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") return [value];
  return [];
}

function normalizeScoreExplanation(value) {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value)
    .map(([key, explanation]) => ({
      key,
      label: key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      explanation: String(explanation || "").trim(),
    }))
    .filter((entry) => entry.explanation);
}

function getSuggestedAnalysisPlatforms(analysis) {
  if (!analysis?.per_platform || typeof analysis.per_platform !== "object") return [];
  return Object.keys(analysis.per_platform).filter(Boolean);
}

function getAnalysisVariant(analysis, platform) {
  if (!analysis?.per_platform || typeof analysis.per_platform !== "object") return null;
  const platformKey = normalizePlatformKey(platform);
  if (platformKey && analysis.per_platform[platformKey]) {
    return { key: platformKey, value: analysis.per_platform[platformKey] };
  }

  const firstEntry = Object.entries(analysis.per_platform).find(([, value]) => value && typeof value === "object");
  if (!firstEntry) return null;
  return { key: firstEntry[0], value: firstEntry[1] };
}

function getAnalysisCaption(variant, platform) {
  if (!variant || typeof variant !== "object") return "";
  if (normalizePlatformKey(platform) === "youtube") {
    return [variant.title, variant.description].filter(Boolean).join("\n\n");
  }
  return String(variant.caption || variant.description || "").trim();
}

function getAnalysisHashtags(variant) {
  if (!variant || typeof variant !== "object") return [];
  if (Array.isArray(variant.hashtags)) return normalizeHashtags(variant.hashtags);
  if (Array.isArray(variant.tags)) return normalizeHashtags(variant.tags);
  return [];
}

function buildEditDraft(item, accounts = []) {
  const itemPlatforms = [
    item?.platform,
    ...(Array.isArray(item?.metadata?.platforms) ? item.metadata.platforms : []),
  ]
    .map((platform) => normalizePlatformKey(platform))
    .filter(Boolean);
  const exactMatch = accounts.find((account) => account.id === item?.account_id) || null;
  const platformMatch = accounts.find((account) => itemPlatforms.includes(normalizePlatformKey(account.platform))) || null;
  const selectedAccountIds = exactMatch
    ? [exactMatch.id]
    : platformMatch
      ? [platformMatch.id]
      : (accounts[0] ? [accounts[0].id] : []);
  const activePlatform = itemPlatforms[0]
    || normalizePlatformKey(exactMatch?.platform)
    || normalizePlatformKey(platformMatch?.platform)
    || normalizePlatformKey(accounts[0]?.platform);
  return {
    caption: stripHashtagsFromCaption(item?.caption || item?.prompt || ""),
    hashtagsText: toHashtagInputValue(item?.hashtags),
    scheduledAtText: toDateTimeInputValue(item?.scheduled_at),
    selectedAccountIds,
    platform: activePlatform || "",
    uploadedPreviewUrl: "",
    uploadedFile: null,
    uploadedFileName: "",
    analysis: null,
    analysisPlatform: activePlatform || "",
    analysisError: "",
  };
}

function getDefaultSelectedAccountIds(primaryItem, connectedAccounts = []) {
  if (!primaryItem) return connectedAccounts.slice(0, 1).map((account) => account.id);
  const exactMatch = connectedAccounts.find((account) => account.id === primaryItem.account_id);
  if (exactMatch) return [exactMatch.id];

  const matchingPlatformAccounts = connectedAccounts
    .filter((account) => normalizePlatformKey(account.platform) === normalizePlatformKey(primaryItem.platform))
    .map((account) => account.id);

  if (matchingPlatformAccounts.length > 0) return [matchingPlatformAccounts[0]];
  return connectedAccounts.slice(0, 1).map((account) => account.id);
}

function MediaThumb({ item }) {
  const mediaUrl = resolveItemMediaUrl(item);
  if (!mediaUrl) {
    return (
      <div className="moderation-thumb moderation-thumb-empty">
        <FileWarning size={16} />
      </div>
    );
  }

  if (String(item?.media_type || "").toLowerCase() === "video") {
    return (
      <div className="moderation-thumb">
        <video src={mediaUrl} muted playsInline />
      </div>
    );
  }

  return (
    <div className="moderation-thumb">
      <img src={mediaUrl} alt={item?.caption || "Content preview"} loading="lazy" />
    </div>
  );
}

function StatusPill({ status }) {
  const meta = getStatusMeta(status);
  return <span className={`moderation-pill moderation-pill-${meta.tone}`}>{meta.label}</span>;
}

function ModerationPill({ status }) {
  const meta = getModerationMeta(status);
  return <span className={`moderation-pill moderation-pill-${meta.tone}`}>{meta.label}</span>;
}

function DrawerSection({ label, children, compact = false }) {
  return (
    <section className={`moderation-drawer-section${compact ? " compact" : ""}`}>
      <div className="moderation-drawer-label">{label}</div>
      {children}
    </section>
  );
}

function ModalShell({ title, subtitle, children, footer, onClose }) {
  return (
    <>
      <button type="button" className="moderation-modal-backdrop" aria-label="Close dialog" onClick={onClose} />
      <div className="moderation-modal" role="dialog" aria-modal="true">
        <div className="moderation-modal-header">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="moderation-icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>
        <div className="moderation-modal-body">{children}</div>
        {footer ? <div className="moderation-modal-footer">{footer}</div> : null}
      </div>
    </>
  );
}

function ForceActionModal({ open, mode, items, connectedAccounts, busy, onClose, onConfirm }) {
  const [scheduledAtText, setScheduledAtText] = useState("");
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [reasonCode, setReasonCode] = useState(FORCE_REASON_OPTIONS[0].value);
  const [note, setNote] = useState("");
  const primaryItem = items[0];

  useEffect(() => {
    if (!open) return;
    setScheduledAtText(mode === "schedule" ? toDateTimeInputValue(new Date(Date.now() + 60 * 60 * 1000).toISOString()) : "");
    setSelectedAccountIds(getDefaultSelectedAccountIds(primaryItem, connectedAccounts));
    setReasonCode(FORCE_REASON_OPTIONS[0].value);
    setNote("");
  }, [connectedAccounts, mode, open, primaryItem]);

  if (!open) return null;

  const sameUser = new Set(items.map((item) => item.user?.id)).size <= 1;
  const checks = primaryItem
    ? calculateReadinessChecks({
        item: primaryItem,
        mode,
        selectedAccountIds,
        connectedAccounts,
        scheduledAt: fromDateTimeInputValue(scheduledAtText),
      })
    : [];
  const hasBlocker = !sameUser || checks.some((check) => check.state === "fail");

  return (
    <ModalShell
      title={mode === "publish" ? "Force Publish" : "Force Schedule"}
      subtitle={mode === "publish" ? "This action is logged at risk level HIGH." : `Apply to ${pluralize(items.length, "item")}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="admin-secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="admin-primary-button"
            disabled={busy || hasBlocker}
            onClick={() => onConfirm({
              selectedAccountIds,
              scheduledAt: fromDateTimeInputValue(scheduledAtText),
              reasonCode,
              note,
            })}
          >
            {busy ? <Loader2 size={14} className="admin-spin" /> : null}
            {mode === "publish" ? "Confirm Force Publish" : "Confirm Force Schedule"}
          </button>
        </>
      )}
    >
      {!sameUser ? (
        <div className="admin-inline-alert admin-inline-alert-warning">
          <AlertTriangle size={16} />
          <span>Batch scheduling currently requires all selected rows to belong to the same user because platform connections are user-scoped.</span>
        </div>
      ) : null}

      <div className="moderation-form-grid">
        <label className="moderation-field">
          <span>Platform(s)</span>
          <div className="moderation-choice-grid">
            {connectedAccounts.map((account) => {
              const active = selectedAccountIds.includes(account.id);
              return (
                <button
                  key={account.id}
                  type="button"
                  className={`moderation-choice-chip${active ? " active" : ""}`}
                  onClick={() => setSelectedAccountIds((current) => (
                    active ? current.filter((id) => id !== account.id) : [...current, account.id]
                  ))}
                >
                  <PlatformIcon platform={account.platform} size="xs" />
                  <span>{account.account_name || account.username || account.platform}</span>
                </button>
              );
            })}
          </div>
        </label>

        {mode === "schedule" ? (
          <label className="moderation-field">
            <span>Schedule time</span>
            <input
              type="datetime-local"
              className="admin-input moderation-input-full"
              value={scheduledAtText}
              onChange={(event) => setScheduledAtText(event.target.value)}
            />
          </label>
        ) : null}

        <label className="moderation-field">
          <span>Reason</span>
          <select className="admin-select moderation-input-full" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
            {FORCE_REASON_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <label className="moderation-field moderation-field-span">
          <span>Internal note</span>
          <textarea className="admin-textarea moderation-textarea" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional context for the audit trail" />
        </label>
      </div>

      <div className="moderation-checklist">
        <div className="moderation-modal-section-title">Readiness Check</div>
        {checks.map((check) => (
          <div key={check.key} className={`moderation-check moderation-check-${check.state}`}>
            <span>{check.state === "pass" ? "OK" : check.state === "warning" ? "!" : "X"}</span>
            <div>
              <strong>{check.label}</strong>
              <p>{check.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

function DeleteArchiveModal({ open, mode, items, busy, onClose, onConfirm }) {
  const [reasonCode, setReasonCode] = useState(DELETE_REASON_OPTIONS[0].value);
  const [note, setNote] = useState("");
  const [typedConfirm, setTypedConfirm] = useState("");

  useEffect(() => {
    if (!open) return;
    setReasonCode(DELETE_REASON_OPTIONS[0].value);
    setNote("");
    setTypedConfirm("");
  }, [open]);

  if (!open) return null;

  const needsTypedConfirm = items.length > 1;
  const confirmPhrase = `I confirm archiving ${items.length} items`;
  const confirmDisabled = busy || !reasonCode || (needsTypedConfirm && typedConfirm !== confirmPhrase);
  const primaryItem = items[0];
  const confirmLabel = mode === "delete" ? "Submit Archive & Deletion Request" : "Archive Selected Content";

  return (
    <ModalShell
      title={mode === "delete" ? "Delete Post" : "Archive Content"}
      subtitle={mode === "delete" ? "This action soft-archives the content first and logs a deletion request." : `Archive ${pluralize(items.length, "item")}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="admin-secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="admin-danger-button"
            disabled={confirmDisabled}
            onClick={() => onConfirm({ reasonCode, note })}
          >
            {busy ? <Loader2 size={14} className="admin-spin" /> : null}
            {confirmLabel}
          </button>
        </>
      )}
    >
      {primaryItem ? (
        <div className="moderation-delete-preview">
          <MediaThumb item={primaryItem} />
          <div>
            <strong>{formatCaptionSnippet(primaryItem.caption, 88)}</strong>
            <p>{primaryItem.user?.name} | {formatDateOnly(primaryItem.unified_date || primaryItem.created_at)}</p>
          </div>
        </div>
      ) : null}

      <div className="moderation-form-grid">
        <label className="moderation-field">
          <span>Reason code</span>
          <select className="admin-select moderation-input-full" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
            {DELETE_REASON_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <label className="moderation-field moderation-field-span">
          <span>Internal note</span>
          <textarea className="admin-textarea moderation-textarea" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional internal context" />
        </label>
      </div>

      {mode === "delete" ? (
        <div className="admin-inline-alert admin-inline-alert-warning">
          <AlertTriangle size={16} />
          <span>This action will archive the post and submit a deletion request for approval. It cannot be undone without admin approval.</span>
        </div>
      ) : null}

      {needsTypedConfirm ? (
        <label className="moderation-field">
          <span>Typed confirmation</span>
          <input
            type="text"
            className="admin-input moderation-input-full"
            placeholder={confirmPhrase}
            value={typedConfirm}
            onChange={(event) => setTypedConfirm(event.target.value)}
          />
        </label>
      ) : null}
    </ModalShell>
  );
}

function QualityPanel({ open, item, review, loading, busy, onClose, onRegenerate, onRescore }) {
  if (!open) return null;

  const band = getQualityBandMeta(review);
  const flags = normalizeRiskFlags(review?.risk_flags);
  const explanations = normalizeScoreExplanation(review?.score_explanation);

  return (
    <>
      <button type="button" className="moderation-drawer-backdrop secondary" onClick={onClose} aria-label="Close quality review" />
      <aside className="moderation-quality-drawer">
        <div className="moderation-drawer-header">
          <div>
            <span className="admin-section-kicker">Quality Review</span>
            <h3>{item?.user?.name || "Content quality"}</h3>
          </div>
          <button type="button" className="moderation-icon-button" onClick={onClose} aria-label="Close quality review">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="moderation-loading-state"><Loader2 size={18} className="admin-spin" /><span>Loading quality review...</span></div>
        ) : (
          <div className="moderation-drawer-scroll">
            <DrawerSection label="Overview">
              <div className="moderation-quality-hero">
                <div className={`moderation-score-ring moderation-score-ring-${band.tone}`} style={{ "--moderation-score-angle": scoreToAngle(review?.overall_score) }}>
                  <strong>{band.scoreText}</strong>
                  <span>/100</span>
                </div>
                <div>
                  <strong>{band.label}</strong>
                  <p>{review?.confidence_level ? `Confidence: ${review.confidence_level}` : "Confidence unavailable"}</p>
                </div>
              </div>
            </DrawerSection>

            <DrawerSection label="Score Breakdown">
              <div className="moderation-breakdown-list">
                {QUALITY_BREAKDOWN_FIELDS.map((field) => {
                  const value = Number(review?.[field.key]);
                  const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, (value / 5) * 100)) : 0;
                  return (
                    <div key={field.key} className="moderation-breakdown-row">
                      <div>
                        <strong>{field.label}</strong>
                        <span>{Number.isFinite(value) ? `${value.toFixed(1)}/5` : "-"}</span>
                      </div>
                      <div className="moderation-breakdown-bar"><span style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            </DrawerSection>

            {flags.length ? (
              <DrawerSection label="Risk Flags">
                <div className="moderation-tag-list">
                  {flags.map((flag) => <span key={flag} className="moderation-tag warning">{flag}</span>)}
                </div>
              </DrawerSection>
            ) : null}

            {explanations.length ? (
              <DrawerSection label="Explanation">
                <div className="moderation-rich-list">
                  {explanations.map((entry) => (
                    <div key={entry.key}>
                      <strong>{entry.label}</strong>
                      <p>{entry.explanation}</p>
                    </div>
                  ))}
                </div>
              </DrawerSection>
            ) : null}

            {review?.suggested_rewrite_instructions || review?.suggested_regen_direction ? (
              <DrawerSection label="Suggested Action">
                <div className="moderation-rich-list">
                  {review?.suggested_rewrite_instructions ? (
                    <div>
                      <strong>Rewrite guidance</strong>
                      <p>{review.suggested_rewrite_instructions}</p>
                    </div>
                  ) : null}
                  {review?.suggested_regen_direction ? (
                    <div>
                      <strong>Regen direction</strong>
                      <p>{review.suggested_regen_direction}</p>
                    </div>
                  ) : null}
                </div>
              </DrawerSection>
            ) : null}
          </div>
        )}

        <div className="moderation-drawer-footer">
          <button type="button" className="admin-secondary-button" disabled={busy} onClick={onRescore}>
            <RefreshCcw size={14} />
            Re-score
          </button>
          <button type="button" className="admin-primary-button" onClick={onRegenerate}>
            <Sparkles size={14} />
            Regenerate with Hints
          </button>
        </div>
      </aside>
    </>
  );
}

function RegenerationWorkspace({ open, item, review, busy, result, onClose, onGenerate, onPromote }) {
  const [mode, setMode] = useState(REGENERATION_MODE_OPTIONS[0].value);
  const [prompt, setPrompt] = useState("");
  const [platform, setPlatform] = useState("");
  const [brandOverride, setBrandOverride] = useState("");

  useEffect(() => {
    if (!open) return;
    setMode(REGENERATION_MODE_OPTIONS[0].value);
    setPrompt(item?.prompt || item?.caption || "");
    setPlatform(item?.platform || "instagram");
    setBrandOverride(review?.suggested_regen_direction || "");
  }, [item, open, review?.suggested_regen_direction]);

  if (!open || !item) return null;

  return (
    <>
      <button type="button" className="moderation-modal-backdrop" onClick={onClose} aria-label="Close regeneration workspace" />
      <section className="moderation-regen-workspace">
        <div className="moderation-regen-header">
          <div>
            <span className="admin-section-kicker">Regeneration Flow</span>
            <h2>Regenerate Content Variant</h2>
          </div>
          <button type="button" className="moderation-icon-button" onClick={onClose} aria-label="Close workspace">
            <X size={18} />
          </button>
        </div>

        <div className="moderation-regen-grid">
          <div className="moderation-regen-column">
            <DrawerSection label="Original Post">
              <div className="moderation-regen-preview">
                <MediaThumb item={item} />
                <div className="moderation-rich-list">
                  <div><strong>Caption</strong><p>{item.caption || "No caption"}</p></div>
                  <div><strong>Prompt</strong><p>{item.prompt || "No prompt captured"}</p></div>
                </div>
              </div>
            </DrawerSection>

            <DrawerSection label="Setup">
              <div className="moderation-form-grid">
                <label className="moderation-field">
                  <span>Mode</span>
                  <select className="admin-select moderation-input-full" value={mode} onChange={(event) => setMode(event.target.value)}>
                    {REGENERATION_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="moderation-field">
                  <span>Target platform</span>
                  <select className="admin-select moderation-input-full" value={platform} onChange={(event) => setPlatform(event.target.value)}>
                    {PLATFORM_OPTIONS.filter((option) => option.value !== "all").map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="moderation-field moderation-field-span">
                  <span>Revised prompt</span>
                  <textarea className="admin-textarea moderation-textarea" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
                </label>
                <label className="moderation-field moderation-field-span">
                  <span>Brand context override</span>
                  <textarea className="admin-textarea moderation-textarea" value={brandOverride} onChange={(event) => setBrandOverride(event.target.value)} placeholder="Optional direction for the next variant" />
                </label>
              </div>
            </DrawerSection>
          </div>

          <div className="moderation-regen-column">
            <DrawerSection label="Compare">
              {result ? (
                <div className="moderation-compare-grid">
                  <div className="moderation-compare-card">
                    <strong>Original</strong>
                    <p>{item.caption || "No caption"}</p>
                    <span>Quality: {getQualityBandMeta(review).scoreText}/100</span>
                  </div>
                  <div className="moderation-compare-card promoted">
                    <strong>New Variant</strong>
                    <p>{result.caption || "No caption returned"}</p>
                    <span>Quality: {getQualityBandMeta(result.quality_review).scoreText}/100</span>
                  </div>
                </div>
              ) : (
                <div className="moderation-empty-panel">
                  <Sparkles size={20} />
                  <p>Generate a new variant to compare the draft against the current content.</p>
                </div>
              )}
            </DrawerSection>
          </div>
        </div>

        <div className="moderation-regen-footer">
          <button type="button" className="admin-secondary-button" onClick={onClose}>Keep Original</button>
          {result?.new_version_id ? (
            <button type="button" className="admin-secondary-button" onClick={() => onPromote(result.new_version_id)}>Promote New Version</button>
          ) : null}
          <button
            type="button"
            className="admin-primary-button"
            disabled={busy}
            onClick={() => onGenerate({
              post_id: item.post_id,
              regeneration_mode: mode,
              revised_prompt: prompt,
              brand_context_override: brandOverride || null,
              target_platform: platform,
            })}
          >
            {busy ? <Loader2 size={14} className="admin-spin" /> : <Rocket size={14} />}
            Generate
          </button>
        </div>
      </section>
    </>
  );
}

function DetailDrawer({
  item,
  open,
  drawerMode,
  busyAction,
  connectedAccounts,
  editDraft,
  setEditDraft,
  onClose,
  onEnterEdit,
  onCancelEdit,
  onSaveEdit,
  onOpenQuality,
  onOpenForceAction,
  onOpenDeleteAction,
  onOpenArchiveAction,
  onOpenRegeneration,
  onRescore,
  onUploadFile,
  onViewUser,
  fileInputRef,
}) {
  if (!open || !item) return null;

  const available = getAvailableActions(item);
  const band = getQualityBandMeta(item.quality_review);
  const hashtags = normalizeHashtags(item.hashtags);
  const mediaUrl = editDraft?.uploadedPreviewUrl || resolveItemMediaUrl(item);
  const analysisPlatforms = getSuggestedAnalysisPlatforms(editDraft?.analysis);
  const activeAnalysis = getAnalysisVariant(editDraft?.analysis, editDraft?.analysisPlatform || editDraft?.platform || item.platform);
  const analysisPlatform = activeAnalysis?.key || "";
  const analysisVariant = activeAnalysis?.value || null;
  const analysisCaption = getAnalysisCaption(analysisVariant, analysisPlatform);
  const analysisHashtags = getAnalysisHashtags(analysisVariant);
  const analysisQualityEstimate = Number(editDraft?.analysis?.quality_estimate);
  const saveBusy = busyAction === "save";
  const rescoreBusy = busyAction === "rescore";

  return (
    <>
      <button type="button" className="moderation-drawer-backdrop" onClick={onClose} aria-label="Close detail drawer" />
      <aside className="moderation-detail-drawer">
        <div className="moderation-drawer-header">
          <div>
            <button type="button" className="moderation-back-button" onClick={drawerMode === "edit" ? onCancelEdit : onClose}>
              <ArrowLeft size={14} />
              {drawerMode === "edit" ? "Cancel Edit" : "Back to Queue"}
            </button>
            <h3>{item.generation_id ? `Gen #${item.generation_id.slice(0, 6)}` : `Post #${item.post_id?.slice(0, 6)}`}</h3>
            <div className="moderation-inline-meta">
              <PlatformIcon platform={item.platform} size="xs" />
              <StatusPill status={item.unified_status} />
            </div>
          </div>
          {drawerMode === "view" ? (
            <button type="button" className="moderation-icon-button" onClick={onClose} aria-label="Close detail drawer">
              <X size={16} />
            </button>
          ) : null}
        </div>

        <div className="moderation-drawer-scroll">
          <DrawerSection label="Media">
            <div className="moderation-media-card">
              {mediaUrl ? (
                String(item.media_type || "").toLowerCase() === "video" ? (
                  <video src={mediaUrl} controls muted playsInline />
                ) : (
                  <img src={mediaUrl} alt={item.caption || "Preview"} />
                )
              ) : (
                <div className="moderation-empty-panel compact">
                  <FileWarning size={18} />
                  <p>No media attached</p>
                </div>
              )}
            </div>

            {drawerMode === "edit" ? (
              <div className="moderation-inline-actions">
                <button type="button" className="admin-secondary-button" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={14} />
                  Replace from Device
                </button>
                <button type="button" className="admin-secondary-button" disabled title="Media library picker can be added in a follow-up pass">
                  <Eye size={14} />
                  From Library
                </button>
                <input ref={fileInputRef} type="file" hidden accept="image/*,video/*" onChange={onUploadFile} />
              </div>
            ) : null}

            {drawerMode === "edit" && editDraft?.analysisError ? (
              <div className="admin-inline-alert admin-inline-alert-warning">
                <AlertTriangle size={16} />
                <span>{editDraft.analysisError}</span>
              </div>
            ) : null}
          </DrawerSection>

          {drawerMode === "edit" && editDraft?.analysis ? (
            <DrawerSection label="AI Analysis">
              <div className="moderation-analysis-card">
                <div className="moderation-analysis-meta">
                  <div>
                    <strong>Media insight</strong>
                    <p>{editDraft.analysis.media_description || "AI analysis completed for the uploaded media."}</p>
                  </div>
                  <div>
                    <strong>Brand note</strong>
                    <p>{editDraft.analysis.brand_alignment_note || "No brand note returned."}</p>
                  </div>
                  <div>
                    <strong>Quality estimate</strong>
                    <p>{Number.isFinite(analysisQualityEstimate) ? `${Math.round(analysisQualityEstimate)}/100` : "Unavailable"}</p>
                  </div>
                </div>

                {analysisPlatforms.length ? (
                  <>
                    <div className="moderation-choice-grid">
                      {analysisPlatforms.map((platformKey) => (
                        <button
                          key={platformKey}
                          type="button"
                          className={`moderation-choice-chip${platformKey === analysisPlatform ? " active" : ""}`}
                          onClick={() => setEditDraft((current) => ({
                            ...current,
                            analysisPlatform: platformKey,
                            platform: platformKey,
                          }))}
                        >
                          <PlatformIcon platform={platformKey} size="xs" />
                          <span>{platformKey}</span>
                        </button>
                      ))}
                    </div>

                    <div className="moderation-rich-list">
                      <div>
                        <strong>Suggested caption</strong>
                        <p>{analysisCaption || "No caption suggestion returned for this platform."}</p>
                      </div>
                      <div>
                        <strong>Suggested hashtags</strong>
                        <p>{analysisHashtags.length ? analysisHashtags.join(" ") : "No hashtag suggestion returned."}</p>
                      </div>
                    </div>

                    <div className="moderation-inline-actions">
                      <button
                        type="button"
                        className="admin-secondary-button"
                        disabled={!analysisCaption}
                        onClick={() => setEditDraft((current) => ({
                          ...current,
                          caption: analysisCaption || current.caption,
                          platform: analysisPlatform || current.platform,
                          analysisPlatform: analysisPlatform || current.analysisPlatform,
                        }))}
                      >
                        Apply Caption
                      </button>
                      <button
                        type="button"
                        className="admin-secondary-button"
                        disabled={!analysisHashtags.length}
                        onClick={() => setEditDraft((current) => ({
                          ...current,
                          hashtagsText: analysisHashtags.length ? toHashtagInputValue(analysisHashtags) : current.hashtagsText,
                          platform: analysisPlatform || current.platform,
                          analysisPlatform: analysisPlatform || current.analysisPlatform,
                        }))}
                      >
                        Apply Hashtags
                      </button>
                      <button
                        type="button"
                        className="admin-primary-button"
                        disabled={!analysisCaption && !analysisHashtags.length}
                        onClick={() => setEditDraft((current) => ({
                          ...current,
                          caption: analysisCaption || current.caption,
                          hashtagsText: analysisHashtags.length ? toHashtagInputValue(analysisHashtags) : current.hashtagsText,
                          platform: analysisPlatform || current.platform,
                          analysisPlatform: analysisPlatform || current.analysisPlatform,
                        }))}
                      >
                        Apply Suggestions
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </DrawerSection>
          ) : null}

          <DrawerSection label="User">
            <div className="moderation-user-card">
              <div className="admin-avatar">{getInitials(item.user?.name)}</div>
              <div>
                <strong>{item.user?.name}</strong>
                <ActivityStatusBadge status={item.user?.activity_status} />
              </div>
            </div>
            <button type="button" className="moderation-link-button" onClick={onViewUser}>
              View User Profile
              <ExternalLink size={14} />
            </button>
          </DrawerSection>

          <DrawerSection label="Quality Score">
            <div className="moderation-quality-summary">
              <button type="button" className="moderation-quality-trigger" onClick={onOpenQuality}>
                <div className={`moderation-score-ring moderation-score-ring-${band.tone}`} style={{ "--moderation-score-angle": scoreToAngle(item.quality_review?.overall_score) }}>
                  <strong>{band.scoreText}</strong>
                </div>
                <div>
                  <strong>{band.label}</strong>
                  <p>{item.quality_review?.overall_score ? `${Math.round(Number(item.quality_review.overall_score))}/100 overall` : "No quality score yet"}</p>
                </div>
              </button>
              <button type="button" className="admin-secondary-button" disabled={rescoreBusy} onClick={onRescore}>
                {rescoreBusy ? <Loader2 size={14} className="admin-spin" /> : <RefreshCcw size={14} />}
                Re-score
              </button>
            </div>
          </DrawerSection>

          <DrawerSection label="Caption">
            {drawerMode === "edit" ? (
              <>
                <textarea
                  className="admin-textarea moderation-textarea"
                  value={editDraft.caption}
                  onChange={(event) => setEditDraft((current) => ({ ...current, caption: event.target.value }))}
                />
                <div className="moderation-field-foot">
                  <span>{analysisCaption ? "AI suggestion ready above" : "AI Optimize Caption"}</span>
                  <span>{editDraft.caption.length} characters</span>
                </div>
              </>
            ) : (
              <p className="moderation-body-copy">{item.caption || "No caption provided."}</p>
            )}
          </DrawerSection>

          <DrawerSection label="Hashtags">
            {drawerMode === "edit" ? (
              <>
                <input
                  type="text"
                  className="admin-input moderation-input-full"
                  value={editDraft.hashtagsText}
                  onChange={(event) => setEditDraft((current) => ({ ...current, hashtagsText: event.target.value }))}
                  placeholder="#campaign #brand #launch"
                />
                <div className="moderation-field-foot">
                  <span>{analysisHashtags.length ? "AI hashtags ready above" : "AI Optimize Hashtags"}</span>
                  <span>{normalizeHashtags(editDraft.hashtagsText).length} tags</span>
                </div>
              </>
            ) : hashtags.length ? (
              <div className="moderation-tag-list">
                {hashtags.map((tag) => <span key={tag} className="moderation-tag">{tag}</span>)}
              </div>
            ) : (
              <p className="moderation-muted-copy">No hashtags yet.</p>
            )}
          </DrawerSection>

          <DrawerSection label="Generation Details">
            <div className="moderation-metadata-list">
              <div><span>Prompt</span><strong>{item.prompt || "Not captured"}</strong></div>
              <div><span>Generated</span><strong>{formatShortDateTime(item.created_at)}</strong></div>
              <div><span>Scheduled</span><strong>{item.scheduled_at ? formatShortDateTime(item.scheduled_at) : "-"}</strong></div>
              <div><span>Platform</span><strong>{item.platform || "-"}</strong></div>
              <div><span>Moderation</span><ModerationPill status={item.moderation_status} /></div>
            </div>
          </DrawerSection>

          {drawerMode === "edit" ? (
            <>
              <DrawerSection label="Platform">
                <div className="moderation-choice-grid">
                  {connectedAccounts.map((account) => {
                    const active = editDraft.selectedAccountIds.includes(account.id);
                    return (
                      <button
                        key={account.id}
                        type="button"
                        className={`moderation-choice-chip${active ? " active" : ""}`}
                        onClick={() => setEditDraft((current) => ({
                          ...current,
                          selectedAccountIds: active
                            ? current.selectedAccountIds.filter((id) => id !== account.id)
                            : [...current.selectedAccountIds, account.id],
                          platform: normalizePlatformKey(account.platform),
                          analysisPlatform: normalizePlatformKey(account.platform),
                        }))}
                      >
                        <PlatformIcon platform={account.platform} size="xs" />
                        <span>{account.account_name || account.username || account.platform}</span>
                      </button>
                    );
                  })}
                </div>
              </DrawerSection>

              <DrawerSection label="Schedule">
                <input
                  type="datetime-local"
                  className="admin-input moderation-input-full"
                  value={editDraft.scheduledAtText}
                  onChange={(event) => setEditDraft((current) => ({ ...current, scheduledAtText: event.target.value }))}
                />
              </DrawerSection>
            </>
          ) : null}
        </div>

        <div className="moderation-drawer-footer">
          {drawerMode === "view" ? (
            <>
              {available.canEdit ? (
                <button type="button" className="admin-secondary-button" onClick={onEnterEdit}>
                  <PenLine size={14} />
                  Edit
                </button>
              ) : null}
              <button type="button" className="admin-secondary-button" onClick={onOpenRegeneration}>
                <Sparkles size={14} />
                Regenerate
              </button>
              {available.canSchedule ? (
                <button type="button" className="admin-secondary-button" onClick={() => onOpenForceAction("schedule")}>
                  <CalendarDays size={14} />
                  Force Schedule
                </button>
              ) : null}
              {available.canPublish ? (
                <button type="button" className="admin-primary-button" onClick={() => onOpenForceAction("publish")}>
                  <Rocket size={14} />
                  Force Publish
                </button>
              ) : null}
              {available.canArchive ? (
                <button type="button" className="admin-secondary-button" onClick={onOpenArchiveAction}>
                  <FileWarning size={14} />
                  Archive
                </button>
              ) : null}
              <button type="button" className="admin-danger-button" onClick={() => onOpenDeleteAction("delete")}>
                <Trash2 size={14} />
                Delete Request
              </button>
            </>
          ) : (
            <>
              <button type="button" className="admin-secondary-button" onClick={onCancelEdit}>Cancel</button>
              <button type="button" className="admin-primary-button" disabled={saveBusy} onClick={onSaveEdit}>
                {saveBusy ? <Loader2 size={14} className="admin-spin" /> : <ShieldCheck size={14} />}
                Save Draft
              </button>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

export default function AdminModerationWorkspace({
  scopedUserId = null,
  embedded = false,
  showUserColumn = true,
  compact = false,
} = {}) {
  const { navigate } = useAppNavigation();
  const queryClient = useQueryClient();
  const { adminAccess } = useAdminLayoutContext();
  const [searchParams, setSearchParams] = useMutableSearchParams();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    search: "",
    userId: scopedUserId || "all",
    organizationId: "all",
    assignmentScope: "all",
    platform: "all",
    status: "all",
    moderationStatus: "all",
    qualityBand: "all",
    dateFrom: "",
    dateTo: "",
  });
  const [selectedIds, setSelectedIds] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [activeItemId, setActiveItemId] = useState(null);
  const [drawerMode, setDrawerMode] = useState("view");
  const [editDraft, setEditDraft] = useState(buildEditDraft(null, []));
  const [modalState, setModalState] = useState(null);
  const [qualityItemId, setQualityItemId] = useState(null);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenResult, setRegenResult] = useState(null);
  const [busyAction, setBusyAction] = useState("");
  const [selectedReviewerId, setSelectedReviewerId] = useState("");
  const debouncedSearch = useDebouncedValue(filters.search, 250);
  const rowGridTemplate = showUserColumn
    ? "40px 72px 160px minmax(0, 1fr) 80px 100px 130px 140px 88px"
    : "40px 72px minmax(0, 1fr) 80px 100px 130px 140px 88px";
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!scopedUserId) return;
    setFilters((current) => (
      current.userId === scopedUserId
        ? current
        : { ...current, userId: scopedUserId }
    ));
  }, [scopedUserId]);

  useEffect(() => {
    if (!adminAccess?.user?.id) return;
    setSelectedReviewerId((current) => current || adminAccess.user.id);
  }, [adminAccess?.user?.id]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters.userId, filters.organizationId, filters.assignmentScope, filters.platform, filters.status, filters.moderationStatus, filters.qualityBand, filters.dateFrom, filters.dateTo]);

  const queryKey = useMemo(
    () => [
      "admin-posts",
      adminAccess?.user?.id || "anon",
      adminAccess?.organizationId || "all",
      page,
      debouncedSearch,
      scopedUserId || filters.userId,
      filters.organizationId,
      filters.assignmentScope,
      filters.platform,
      filters.status,
      filters.moderationStatus,
      filters.qualityBand,
      filters.dateFrom,
      filters.dateTo,
    ],
    [
      adminAccess?.organizationId,
      adminAccess?.user?.id,
      debouncedSearch,
      filters.dateFrom,
      filters.dateTo,
      filters.assignmentScope,
      filters.moderationStatus,
      filters.organizationId,
      filters.platform,
      filters.qualityBand,
      filters.status,
      filters.userId,
      page,
      scopedUserId,
    ],
  );

  const postsQuery = useQuery({
    queryKey,
    enabled: Boolean(adminAccess?.isAdmin),
    placeholderData: keepPreviousData,
    queryFn: () => fetchAdminPostsPage({
      adminAccess,
      page,
      limit: MODERATION_PAGE_SIZE,
      filters: {
        ...filters,
        userId: scopedUserId || filters.userId,
        search: debouncedSearch,
        assignedModeratorId: filters.assignmentScope === "mine" ? adminAccess?.user?.id : null,
      },
    }),
  });

  const optionsQuery = useQuery({
    queryKey: ["admin-post-options", adminAccess?.user?.id || "anon", adminAccess?.organizationId || "all"],
    enabled: Boolean(adminAccess?.isAdmin),
    queryFn: () => fetchModerationFilterOptions(adminAccess),
  });

  const rows = postsQuery.data?.data ?? EMPTY_LIST;
  const groups = useMemo(() => groupModerationItems(rows), [rows]);
  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.includes(row.id)), [rows, selectedIds]);
  const activeItem = useMemo(() => rows.find((row) => row.id === activeItemId) || null, [activeItemId, rows]);
  const modalItems = modalState?.items || [];
  const accountsUserId = modalItems[0]?.user?.id || activeItem?.user?.id || null;
  const qualityItem = useMemo(() => rows.find((row) => row.id === qualityItemId) || (activeItem?.id === qualityItemId ? activeItem : null), [activeItem, qualityItemId, rows]);
  const connectedAccountsQuery = useQuery({
    queryKey: ["admin-post-accounts", accountsUserId || "none"],
    enabled: Boolean(accountsUserId),
    queryFn: () => fetchConnectedAccountsForUser(accountsUserId),
  });
  const qualityReviewQuery = useQuery({
    queryKey: ["admin-post-quality", qualityItem?.id || "none", qualityItem?.post_id || "none", qualityItem?.generation_id || "none"],
    enabled: Boolean(qualityItem),
    queryFn: () => fetchQualityReviewDetail(qualityItem),
  });

  useEffect(() => {
    setSelectedIds((current) => {
      if (!current.length) return current;
      const next = current.filter((id) => rows.some((row) => row.id === id));
      return next.length === current.length ? current : next;
    });
  }, [rows]);

  useEffect(() => {
    setExpandedGroups((current) => {
      let changed = false;
      const next = { ...current };
      groups.forEach((group) => {
        if (next[group.key] === undefined) {
          next[group.key] = group.expandedByDefault;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [groups]);

  useEffect(() => {
    if (!rows.length) return;
    const postId = searchParams.get("post");
    const generationId = searchParams.get("generation");
    if (!postId && !generationId) return;
    const matched = rows.find((row) => row.post_id === postId || row.generation_id === generationId);
    if (matched) {
      setActiveItemId(matched.id);
    }
  }, [rows, searchParams]);

  useEffect(() => {
    if (!adminAccess?.isAdmin) return undefined;

    const channel = supabase
      .channel("admin-moderation-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "generations" }, () => {
        queryClient.invalidateQueries({ queryKey: ["admin-posts"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, () => {
        queryClient.invalidateQueries({ queryKey: ["admin-posts"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [adminAccess?.isAdmin, queryClient]);

  useEffect(() => {
    if (!activeItem || drawerMode !== "edit") return;
    setEditDraft(buildEditDraft(activeItem, connectedAccountsQuery.data || []));
  }, [activeItem?.id, connectedAccountsQuery.data, drawerMode]);

  useEffect(() => {
    const previewUrl = editDraft.uploadedPreviewUrl;
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [editDraft.uploadedPreviewUrl]);

  const invalidateModeration = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin-posts"] });
    await queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
  };

  const openItem = (item) => {
    setActiveItemId(item.id);
    setDrawerMode("view");
    const next = new URLSearchParams(searchParams);
    if (item.post_id) {
      next.set("post", item.post_id);
      next.delete("generation");
    } else if (item.generation_id) {
      next.set("generation", item.generation_id);
      next.delete("post");
    }
    setSearchParams(next);
  };

  const closeItem = () => {
    setActiveItemId(null);
    setDrawerMode("view");
    setQualityItemId(null);
    const next = new URLSearchParams(searchParams);
    next.delete("post");
    next.delete("generation");
    setSearchParams(next);
  };

  const handleSaveEdit = async () => {
    if (!activeItem) return;
    setBusyAction("save");
    try {
      await saveModerationEdits({
        adminAccess,
        item: activeItem,
        values: {
          caption: editDraft.caption,
          hashtags: editDraft.hashtagsText,
          scheduledAt: fromDateTimeInputValue(editDraft.scheduledAtText),
          platform: editDraft.platform,
          selectedAccountIds: editDraft.selectedAccountIds,
          connectedAccounts: connectedAccountsQuery.data || [],
        },
      });
      toast.success("Moderation draft saved.");
      setDrawerMode("view");
      await invalidateModeration();
    } catch (error) {
      toast.error(error.message || "Failed to save edits.");
    } finally {
      setBusyAction("");
    }
  };

  const handleUploadFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !activeItem) return;
    if (event.target) {
      event.target.value = "";
    }

    const previewUrl = URL.createObjectURL(file);
    setEditDraft((current) => ({
      ...current,
      uploadedPreviewUrl: previewUrl,
      uploadedFile: file,
      uploadedFileName: file.name,
      analysisError: "",
      analysis: null,
    }));

    try {
      const base64 = await fileToBase64(file);
      const selectedPlatforms = (connectedAccountsQuery.data || [])
        .filter((account) => editDraft.selectedAccountIds.includes(account.id))
        .map((account) => account.platform)
        .filter(Boolean);
      const analysis = await analyzeUploadedMedia({
        media_base64: base64,
        media_type: file.type.startsWith("video") ? "video" : "image",
        target_platforms: selectedPlatforms.length ? selectedPlatforms : [editDraft.platform || activeItem.platform || "instagram"],
        brand_kit_id: null,
        post_id: activeItem.post_id || null,
      });
      const suggestedPlatforms = getSuggestedAnalysisPlatforms(analysis);
      setEditDraft((current) => ({
        ...current,
        analysis,
        analysisPlatform: normalizePlatformKey(current.platform) || suggestedPlatforms[0] || "",
      }));
    } catch (error) {
      setEditDraft((current) => ({
        ...current,
        analysisError: error.status === 404
          ? "The admin-analyze-media edge function is not deployed yet. The preview was updated locally."
          : (error.message || "Media analysis failed."),
      }));
    }
  };

  const handleForceConfirm = async (payload) => {
    if (!modalState) return;
    setBusyAction("force");
    try {
      for (const item of modalState.items) {
        await forceModerationAction({
          adminAccess,
          item,
          mode: modalState.mode,
          connectedAccounts: connectedAccountsQuery.data || [],
          ...payload,
        });
      }
      toast.success(modalState.mode === "publish" ? "Content force published." : "Content force scheduled.");
      setModalState(null);
      await invalidateModeration();
    } catch (error) {
      toast.error(error.message || "Force action failed.");
    } finally {
      setBusyAction("");
    }
  };

  const handleDeleteArchiveConfirm = async (payload) => {
    if (!modalState) return;
    setBusyAction("delete");
    try {
      if (modalState.type === "archive") {
        await archiveItems({ adminAccess, items: modalState.items, ...payload });
        toast.success("Content archived.");
      } else {
        await submitDeletionRequests({ adminAccess, items: modalState.items, ...payload });
        toast.success("Deletion request submitted.");
      }
      setModalState(null);
      await invalidateModeration();
      if (activeItemId && modalState.items.some((item) => item.id === activeItemId)) {
        closeItem();
      }
    } catch (error) {
      toast.error(error.message || "Moderation action failed.");
    } finally {
      setBusyAction("");
    }
  };

  const handleBulkApprove = async () => {
    if (!selectedRows.length) return;
    setBusyAction("approve");
    try {
      await markItemsApproved({ adminAccess, items: selectedRows });
      toast.success("Selected content marked safe.");
      setSelectedIds([]);
      await invalidateModeration();
    } catch (error) {
      toast.error(error.message || "Failed to update moderation status.");
    } finally {
      setBusyAction("");
    }
  };

  const handleBulkAssignReviewer = async () => {
    if (!selectedRows.length) return;
    if (!selectedReviewerId) {
      toast.error("Choose a reviewer before assigning.");
      return;
    }

    setBusyAction("assign");
    try {
      await assignModeratorToItems({
        adminAccess,
        items: selectedRows,
        moderatorId: selectedReviewerId,
      });
      toast.success("Reviewer assigned to selected content.");
      setSelectedIds([]);
      await invalidateModeration();
    } catch (error) {
      toast.error(error.message || "Failed to assign reviewer.");
    } finally {
      setBusyAction("");
    }
  };

  const handleRescore = async (item) => {
    if (!item) return;
    setBusyAction("rescore");
    try {
      await rescoreModerationItem({ adminAccess, item });
      toast.success("Quality review updated.");
      await Promise.all([
        invalidateModeration(),
        queryClient.invalidateQueries({ queryKey: ["admin-post-quality"] }),
      ]);
    } catch (error) {
      toast.error(error.message || "Failed to re-score this item.");
    } finally {
      setBusyAction("");
    }
  };

  const handleGenerateVariant = async (payload) => {
    setRegenBusy(true);
    try {
      let nextPayload = payload;
      if (!payload.post_id && activeItem) {
        const ensured = await ensureModerationPost(activeItem, {
          accountId: activeItem.account_id || editDraft.selectedAccountIds[0] || null,
          platform: editDraft.platform || activeItem.platform || null,
        });
        nextPayload = {
          ...payload,
          post_id: ensured.post.id,
        };
      }

      const result = await runRegenerationRequest(nextPayload);
      setRegenResult(result);
      toast.success("New variant generated.");
    } catch (error) {
      toast.error(error.status === 404 ? "Deploy admin-regenerate-post to enable regeneration." : (error.message || "Regeneration failed."));
    } finally {
      setRegenBusy(false);
    }
  };

  const handlePromoteVariant = async (versionId) => {
    try {
      await promoteGeneratedVersion({ version_id: versionId });
      toast.success("New version promoted.");
      await invalidateModeration();
      setRegenOpen(false);
      setRegenResult(null);
    } catch (error) {
      toast.error(error.status === 404 ? "Deploy admin-promote-content-version to enable promotion." : (error.message || "Version promotion failed."));
    }
  };

  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));
  const totalCount = postsQuery.data?.count || 0;
  const startRecord = totalCount ? (page - 1) * MODERATION_PAGE_SIZE + 1 : 0;
  const endRecord = totalCount ? Math.min(totalCount, page * MODERATION_PAGE_SIZE) : 0;

  if (!adminAccess?.isAdmin) {
    return <div className="admin-page-loading">Admin access required.</div>;
  }

  return (
    <section className={`admin-page moderation-page-shell${activeItem || qualityItem ? " drawer-open" : ""}${embedded ? " moderation-page-shell-embedded" : ""}${compact ? " moderation-page-shell-compact" : ""}`}>
      {!embedded ? (
        <header className="admin-page-header">
          <div>
            <span className="admin-section-kicker">Content Review</span>
            <h2 className="admin-page-title">Moderation Queue</h2>
            <p className="admin-page-subtext">A unified cross-user queue for reviewing, editing, scheduling, publishing, archiving, and regenerating content across the platform.</p>
          </div>
          <div className="admin-header-actions">
            <button type="button" className="admin-secondary-button" onClick={() => queryClient.invalidateQueries({ queryKey: ["admin-posts"] })}>
              {postsQuery.isFetching ? <Loader2 size={14} className="admin-spin" /> : <RefreshCcw size={14} />}
              Refresh
            </button>
          </div>
        </header>
      ) : null}

      <div className="admin-filterbar moderation-filterbar">
        <input
          type="search"
          className="admin-input"
          placeholder="Search caption prefix or generation ID"
          value={filters.search}
          onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
        />
        {!scopedUserId ? (
          <select className="admin-select" value={filters.userId} onChange={(event) => setFilters((current) => ({ ...current, userId: event.target.value }))}>
            <option value="all">All Users</option>
            {(optionsQuery.data?.users || []).map((user) => (
              <option key={user.id} value={user.id}>{user.full_name || user.email || user.id}</option>
            ))}
          </select>
        ) : null}
        {adminAccess.isSuperAdmin && !scopedUserId ? (
          <select className="admin-select" value={filters.organizationId} onChange={(event) => setFilters((current) => ({ ...current, organizationId: event.target.value }))}>
            <option value="all">All Orgs</option>
            {(optionsQuery.data?.organizations || []).map((organization) => (
              <option key={organization.id} value={organization.id}>{organization.name}</option>
            ))}
          </select>
        ) : null}
        <select className="admin-select" value={filters.assignmentScope} onChange={(event) => setFilters((current) => ({ ...current, assignmentScope: event.target.value }))}>
          <option value="all">All Queue</option>
          <option value="mine">My Queue</option>
        </select>
        <select className="admin-select" value={filters.platform} onChange={(event) => setFilters((current) => ({ ...current, platform: event.target.value }))}>
          {PLATFORM_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select className="admin-select" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select className="admin-select" value={filters.moderationStatus} onChange={(event) => setFilters((current) => ({ ...current, moderationStatus: event.target.value }))}>
          {MODERATION_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select className="admin-select" value={filters.qualityBand} onChange={(event) => setFilters((current) => ({ ...current, qualityBand: event.target.value }))}>
          {QUALITY_BAND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <input type="date" className="admin-input moderation-date-input" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
        <input type="date" className="admin-input moderation-date-input" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} />
      </div>

      {selectedRows.length ? (
        <div className="admin-bulkbar moderation-bulkbar">
          <strong>{pluralize(selectedRows.length, "item")} selected</strong>
          <div className="admin-header-actions">
            <select className="admin-select" value={selectedReviewerId} onChange={(event) => setSelectedReviewerId(event.target.value)}>
              <option value="">Select reviewer</option>
              {(optionsQuery.data?.admins || []).map((admin) => (
                <option key={admin.id} value={admin.id}>
                  {admin.name} ({admin.role})
                </option>
              ))}
            </select>
            <button type="button" className="admin-secondary-button" disabled={busyAction === "assign"} onClick={handleBulkAssignReviewer}>
              {busyAction === "assign" ? "Assigning..." : "Assign Reviewer"}
            </button>
            <button type="button" className="admin-secondary-button" disabled={busyAction === "approve"} onClick={handleBulkApprove}>Mark Safe</button>
            <button type="button" className="admin-secondary-button" onClick={() => setModalState({ type: "force", mode: "schedule", items: selectedRows })}>Force Schedule</button>
            <button type="button" className="admin-secondary-button" onClick={() => setModalState({ type: "archive", items: selectedRows })}>Archive</button>
            <button type="button" className="admin-danger-button" onClick={() => setModalState({ type: "delete", items: selectedRows })}>Submit Delete Request</button>
          </div>
        </div>
      ) : null}

      <div className="admin-panel moderation-queue-panel">
        <div className="moderation-table-head" style={{ gridTemplateColumns: rowGridTemplate }}>
          <label className="moderation-checkbox-cell">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(event) => setSelectedIds(event.target.checked ? rows.map((row) => row.id) : [])}
            />
          </label>
          <span>Media</span>
          {showUserColumn ? <span>User</span> : null}
          <span>Caption</span>
          <span>Platform</span>
          <span>Status</span>
          <span>Quality</span>
          <span>Scheduled</span>
          <span>View</span>
        </div>

        {postsQuery.isLoading ? (
          <div className="admin-page-loading moderation-inline-loading">Loading moderation queue...</div>
        ) : postsQuery.isError ? (
          <div className="admin-empty-state">
            <div className="admin-empty-state__icon">⚠️</div>
            <h3>Failed to load content</h3>
            <p>{postsQuery.error?.message || "An unexpected error occurred fetching content."}</p>
            <p style={{ fontSize: "0.78rem", opacity: 0.6, marginTop: 4 }}>
              Check the browser console. Verify RLS policies allow the admin role to read <code>generations</code> and <code>posts</code>.
            </p>
            <button type="button" className="admin-secondary-button" style={{ marginTop: 12 }} onClick={() => queryClient.invalidateQueries({ queryKey: ["admin-posts"] })}>
              Retry
            </button>
          </div>
        ) : rows.length ? groups.map((group) => (
          <section key={group.key} className="moderation-group">
            <button type="button" className="moderation-group-header" onClick={() => setExpandedGroups((current) => ({ ...current, [group.key]: !current[group.key] }))}>
              <div>
                {expandedGroups[group.key] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <strong>{group.label}</strong>
              </div>
              <span>{pluralize(group.rows.length, "item")}</span>
            </button>

            {expandedGroups[group.key] ? (
              <div className="moderation-group-rows">
                {group.rows.map((item) => (
                  <div key={item.id} className="moderation-row" style={{ gridTemplateColumns: rowGridTemplate }}>
                    <label className="moderation-checkbox-cell">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.id)}
                        onChange={(event) => setSelectedIds((current) => (
                          event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)
                        ))}
                      />
                    </label>
                    <MediaThumb item={item} />
                    {showUserColumn ? (
                      <div className="moderation-user-cell">
                        <strong>{item.user?.name}</strong>
                        <ActivityStatusBadge status={item.user?.activity_status} />
                      </div>
                    ) : null}
                    <div className="moderation-caption-cell" title={item.caption}>{formatCaptionSnippet(item.caption)}</div>
                    <div className="moderation-platform-cell">{item.platform ? <PlatformIcon platform={item.platform} size="xs" /> : "-"}</div>
                    <div><StatusPill status={item.unified_status} /></div>
                    <button type="button" className="moderation-quality-chip" onClick={() => setQualityItemId(item.id)}>
                      <QualityScoreBadge score={item.quality_review?.overall_score} size="sm" />
                    </button>
                    <div className="moderation-scheduled-cell">{item.scheduled_at ? formatShortDateTime(item.scheduled_at) : "-"}</div>
                    <div><button type="button" className="admin-secondary-button moderation-view-button" onClick={() => openItem(item)}>View</button></div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        )) : (
          <div className="admin-empty-state">
            <div className="admin-empty-state__icon">📋</div>
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
        )}

        <div className="admin-pagination">
          <span>Showing {startRecord}-{endRecord} of {totalCount}</span>
          <div className="admin-header-actions">
            <button type="button" className="admin-secondary-button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
            <button type="button" className="admin-secondary-button" disabled={page * MODERATION_PAGE_SIZE >= totalCount} onClick={() => setPage((current) => current + 1)}>Next</button>
          </div>
        </div>
      </div>

      <DetailDrawer
        item={activeItem}
        open={Boolean(activeItem)}
        drawerMode={drawerMode}
        busyAction={busyAction}
        connectedAccounts={connectedAccountsQuery.data || []}
        editDraft={editDraft}
        setEditDraft={setEditDraft}
        onClose={closeItem}
        onEnterEdit={() => {
          setEditDraft(buildEditDraft(activeItem, connectedAccountsQuery.data || []));
          setDrawerMode("edit");
        }}
        onCancelEdit={() => setDrawerMode("view")}
        onSaveEdit={handleSaveEdit}
        onOpenQuality={() => setQualityItemId(activeItem?.id || null)}
        onOpenForceAction={(mode) => setModalState({ type: "force", mode, items: [activeItem] })}
        onOpenDeleteAction={(mode) => setModalState({ type: mode, items: [activeItem] })}
        onOpenArchiveAction={() => setModalState({ type: "archive", items: [activeItem] })}
        onOpenRegeneration={() => {
          setRegenOpen(true);
          setRegenResult(null);
        }}
        onRescore={() => handleRescore(activeItem)}
        onUploadFile={handleUploadFile}
        onViewUser={() => navigate(`/app/admin/users/${activeItem?.user?.id}`)}
        fileInputRef={fileInputRef}
      />

      <QualityPanel
        open={Boolean(qualityItem)}
        item={qualityItem}
        review={qualityReviewQuery.data || qualityItem?.quality_review}
        loading={qualityReviewQuery.isLoading}
        busy={busyAction === "rescore"}
        onClose={() => setQualityItemId(null)}
        onRescore={() => handleRescore(qualityItem)}
        onRegenerate={() => {
          if (qualityItem) {
            setActiveItemId(qualityItem.id);
          }
          setQualityItemId(null);
          setRegenOpen(true);
          setRegenResult(null);
        }}
      />

      <RegenerationWorkspace
        open={regenOpen}
        item={activeItem}
        review={qualityReviewQuery.data || activeItem?.quality_review}
        busy={regenBusy}
        result={regenResult}
        onClose={() => {
          setRegenOpen(false);
          setRegenResult(null);
        }}
        onGenerate={handleGenerateVariant}
        onPromote={handlePromoteVariant}
      />

      <ForceActionModal
        open={modalState?.type === "force"}
        mode={modalState?.mode}
        items={modalItems}
        connectedAccounts={connectedAccountsQuery.data || []}
        busy={busyAction === "force"}
        onClose={() => setModalState(null)}
        onConfirm={handleForceConfirm}
      />

      <DeleteArchiveModal
        open={modalState?.type === "delete" || modalState?.type === "archive"}
        mode={modalState?.type}
        items={modalItems}
        busy={busyAction === "delete"}
        onClose={() => setModalState(null)}
        onConfirm={handleDeleteArchiveConfirm}
      />
    </section>
  );
}
