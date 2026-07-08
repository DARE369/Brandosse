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
  isUnused,
} from "../libraryItemUtils";
import styles from "./AssetCard.module.css";

function statusPillFor(asset) {
  if (asset.status === "archived") return <Badge tone="warning" className={styles.statusPill}>Archived</Badge>;
  if (isUnused(asset)) return <Badge tone="neutral" className={styles.statusPill}>Unused</Badge>;
  return <Badge tone="success" className={styles.statusPill}>In use</Badge>;
}

function AssetMedia({ asset, selectable, isSelected, onToggleSelect }) {
  const [failed, setFailed] = useState(false);
  const title = getItemTitle(asset);
  const hasPreview = Boolean(asset.thumbnail_url && !failed);

  return (
    <div className={styles.assetMedia}>
      <span className={styles.mediaBadge}>{getFormatLabel(asset)}</span>
      {statusPillFor(asset)}

      {hasPreview ? (
        asset.media_type === "video" ? (
          <video src={asset.thumbnail_url || asset.file_url} muted playsInline onError={() => setFailed(true)} />
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
  selectable = false,
  isSelected = false,
  onToggleSelect,
  onOpenDrawer,
  onSchedule,
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
      <AssetMedia asset={asset} selectable={selectable} isSelected={isSelected} onToggleSelect={onToggleSelect} />

      <div className={styles.assetBody}>
        <h4 className={styles.assetTitle} title={title}>{title}</h4>
        <div className={styles.sourceRow}>{getSourceLabel(asset)}</div>
        <AssetTags asset={asset} />
        <div className={styles.metaRow}>
          <span>{getMetaLeftLabel(asset)}</span>
          <span>{getMetaRightLabel(asset)}</span>
        </div>
      </div>

      <div className={styles.assetActions}>
        <Button
          size="sm"
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
                Archive
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
