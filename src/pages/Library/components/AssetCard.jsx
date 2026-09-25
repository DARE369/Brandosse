"use client";

// Grid-view asset card — ui-v2 rebuild of src/pages/LibraryPage/components/LibraryCard.jsx
// (AS_IS_AUDIT.md §3.2 — Refactor: same interaction shape, restyled onto
// ui-v2 primitives/tokens). Matches the approved mockup's .assetCard markup
// 1:1: media-type badge (top-left) + real Badge-toned status pill
// (top-right — in use / unused / archived), a real ~44x44 touch target for
// bulk-select (MOBILE_PARITY.md MUST-FIX), AI-tagging shimmer row, and
// user tags vs. AI tags rendered as visually distinct chips.
import { useState } from "react";
import { FileImage, FileText, Film, MoreHorizontal, Sparkles } from "lucide-react";
import { Badge, Button, IconButton, Dropdown } from "../../../ui-v2";
import {
  getItemTitle,
  getSourceLabel,
  getMetaLeftLabel,
  getMetaRightLabel,
  getFormatLabel,
  getProvenanceLabel,
  isUnused,
} from "../libraryItemUtils";
import { PUBLISH_STATE, publishStateLabel } from "../publishability";
import styles from "./AssetCard.module.css";

// The publish gate outranks the usage pill. "Unused" is interesting; "the
// publisher cannot reach this file" is actionable, and a card can only carry
// one pill without becoming noise.
const GATE_TONE = {
  [PUBLISH_STATE.BLOCKED]: "danger",
  [PUBLISH_STATE.NO_DESTINATION]: "warning",
  [PUBLISH_STATE.TAGGING]: "info",
};

function statusPillFor(asset, publishability) {
  const gateTone = publishability ? GATE_TONE[publishability.state] : null;
  if (gateTone) {
    // Badge takes no title prop, so the reason goes on a wrapper. Without this
    // the card would show a state with no way to find out what it means.
    return (
      <span className={styles.statusPill} title={publishability.reason}>
        <Badge tone={gateTone}>{publishStateLabel(publishability.state)}</Badge>
      </span>
    );
  }
  if (asset.status === "archived") return <Badge tone="warning" className={styles.statusPill}>Archived</Badge>;
  if (isUnused(asset)) return <Badge tone="neutral" className={styles.statusPill}>Unused</Badge>;
  return <Badge tone="success" className={styles.statusPill}>In use</Badge>;
}

// Which connected accounts would take this file. Shown only once we actually
// know — an empty strip is better than a wrong one.
function PlatformFitRow({ publishability }) {
  const fits = publishability?.fits || [];
  if (fits.length === 0) return null;
  return (
    <div className={styles.fitRow} aria-label="Which connected accounts accept this file">
      {fits.map((fit) => (
        <span
          key={fit.key}
          className={[styles.fitChip, fit.accepts ? styles.fitChipYes : styles.fitChipNo].join(" ")}
          title={fit.reason}
        >
          {fit.label.slice(0, 2).toUpperCase()}
        </span>
      ))}
    </div>
  );
}

function AssetMedia({ asset, publishability, selectable, isSelected, onToggleSelect }) {
  const [failed, setFailed] = useState(false);
  const title = getItemTitle(asset);
  // A video row's thumbnail_url is null far more often than not (most Library
  // sources never generate a static frame — see personal-asset-upload's own
  // header on this), but the <video> element two lines below already falls
  // back to file_url when it is. That fallback could never run: this gate
  // required thumbnail_url truthy to reach the branch at all, so a video with
  // a perfectly good file_url and no thumbnail_url fell straight to the
  // generic film icon instead of ever attempting a live preview frame.
  const hasPreview = Boolean((asset.thumbnail_url || asset.file_url) && !failed);

  return (
    <div className={styles.assetMedia}>
      <span className={styles.mediaBadge}>{getFormatLabel(asset)}</span>
      {statusPillFor(asset, publishability)}

      {hasPreview ? (
        asset.media_type === "video" ? (
          <video
            src={asset.thumbnail_url || asset.file_url}
            muted
            playsInline
            preload="metadata"
            onError={() => setFailed(true)}
          />
        ) : (
          <img src={asset.thumbnail_url} alt={title} loading="lazy" onError={() => setFailed(true)} />
        )
      ) : asset.media_type === "video" ? (
        <Film size={26} aria-hidden="true" />
      ) : asset.media_type === "document" ? (
        <FileText size={26} aria-hidden="true" />
      ) : (
        <FileImage size={26} aria-hidden="true" />
      )}

      <button
        type="button"
        className={[styles.selectHit, selectable ? styles.selectHitVisible : ""].filter(Boolean).join(" ")}
        onClick={(event) => {
          event.stopPropagation();
          onToggleSelect?.(asset);
        }}
        aria-label={isSelected ? `Deselect ${title}` : `Select ${title}`}
        aria-pressed={isSelected}
      >
        <span className={[styles.selectCheck, isSelected ? styles.selectCheckChecked : ""].filter(Boolean).join(" ")}>
          {isSelected ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : null}
        </span>
      </button>
    </div>
  );
}

function AssetTags({ asset }) {
  const tags = Array.isArray(asset.tags) ? asset.tags.filter(Boolean) : [];
  const aiTags = Array.isArray(asset.ai_tags) ? asset.ai_tags.filter(Boolean) : [];

  if (asset.ai_tagging_status === "pending") {
    return (
      <div className={styles.aiShimmerRow}>
        <span className={[styles.shimmerLine, styles.shimmerLineW1].join(" ")} />
        <span className={[styles.shimmerLine, styles.shimmerLineW2].join(" ")} />
      </div>
    );
  }

  if (tags.length === 0 && aiTags.length === 0) return null;

  return (
    <div className={styles.tagRow}>
      {tags.slice(0, 3).map((tag) => (
        <span key={`tag-${tag}`} className={styles.tagChip}>{tag}</span>
      ))}
      {aiTags.slice(0, 2).map((tag) => (
        <span key={`ai-${tag}`} className={[styles.tagChip, styles.tagChipAi].join(" ")}>
          <Sparkles size={9} aria-hidden="true" /> {tag}
        </span>
      ))}
    </div>
  );
}

export default function AssetCard({
  asset,
  publishability = null,
  selectable = false,
  isSelected = false,
  onToggleSelect,
  onOpenDrawer,
  onSchedule,
  onPublish,
  onArchive,
  onDelete,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const title = getItemTitle(asset);

  return (
    <article
      className={[styles.assetCard, isSelected ? styles.assetCardSelected : ""].filter(Boolean).join(" ")}
      tabIndex={0}
      role="button"
      aria-label={`Open ${title}`}
      onClick={(event) => {
        if (event.target.closest("button")) return;
        onOpenDrawer?.(asset);
      }}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
          event.preventDefault();
          onOpenDrawer?.(asset);
        }
      }}
    >
      <AssetMedia asset={asset} publishability={publishability} selectable={selectable} isSelected={isSelected} onToggleSelect={onToggleSelect} />

      <div className={styles.assetBody}>
        <h4 className={styles.assetTitle} title={title}>{title}</h4>
        <div className={styles.sourceRow} title={getProvenanceLabel(asset) || undefined}>
          {getProvenanceLabel(asset) || getSourceLabel(asset)}
        </div>
        <AssetTags asset={asset} />
        <div className={styles.metaRow}>
          <span>{getMetaLeftLabel(asset)}</span>
          <span>{getMetaRightLabel(asset)}</span>
        </div>
        <PlatformFitRow publishability={publishability} />
      </div>

      <div className={styles.assetActions}>
        {/* Publish opens the composer HERE, over the Library, with this asset
            attached. Schedule still hands off to the Calendar, which is where a
            date is picked — Phase 3 unifies the two pickers.

            Both are gated on canOpenComposer rather than canPublish, and that is
            deliberate: an asset with nowhere to go still opens the composer,
            because a disabled button can only say THAT it cannot be sent, while
            the composer can say why, per platform. derivePublishability() is the
            single source of that answer (publishability.js:100) — never
            re-derived here. */}
        <Button
          size="sm"
          disabled={Boolean(publishability) && !publishability.canOpenComposer}
          title={publishability?.reason || undefined}
          onClick={(event) => {
            event.stopPropagation();
            onPublish?.(asset);
          }}
        >
          Publish
        </Button>
        <Button
          size="sm"
          variant="subtle"
          disabled={Boolean(publishability) && !publishability.canOpenComposer}
          title={publishability?.reason || undefined}
          onClick={(event) => {
            event.stopPropagation();
            onSchedule?.(asset);
          }}
        >
          Schedule
        </Button>
        <span onClick={(event) => event.stopPropagation()}>
          <Dropdown
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            align="right"
            width="160px"
            trigger={(
              <IconButton
                title={`More actions for ${title}`}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <MoreHorizontal size={14} aria-hidden="true" />
              </IconButton>
            )}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onArchive?.(asset); }}
                style={{ textAlign: "left", padding: "8px 10px", border: "none", background: "transparent", color: "var(--uiv2-text-primary)", fontSize: 13, borderRadius: 6, cursor: "pointer", fontFamily: "inherit" }}
              >
                {asset.status === "archived" ? "Unarchive" : "Archive"}
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onDelete?.(asset); }}
                style={{ textAlign: "left", padding: "8px 10px", border: "none", background: "transparent", color: "var(--uiv2-danger)", fontSize: 13, borderRadius: 6, cursor: "pointer", fontFamily: "inherit" }}
              >
                Delete
              </button>
            </div>
          </Dropdown>
        </span>
      </div>
    </article>
  );
}
