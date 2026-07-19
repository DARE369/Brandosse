"use client";

// Asset detail drawer — ui-v2 rebuild of
// src/pages/LibraryPage/components/AssetDetailDrawer.jsx (AS_IS_AUDIT.md
// §3.2 — Refactor), built on the real ui-v2 <Drawer> primitive. Preview,
// inline-editable metadata, "Used in" list (deep-links into Calendar,
// LIBRARY_SPEC.md §6/§7), version-history chain
// (superseded_by_asset_id, spec §6.2), and the Schedule/Duplicate/Delete
// footer actions — matches the approved mockup's #assetDrawer 1:1.
import { useEffect, useState } from "react";
import { FileImage, Film, FileText, ArrowRight, Sparkles } from "lucide-react";
import { Badge, Button, Drawer } from "../../../ui-v2";
import {
  getItemTitle,
  getSourceLabel,
  getFormatLabel,
  formatFileSize,
  formatDuration,
  formatDate,
} from "../libraryItemUtils";
import pageStyles from "../LibraryPage.module.css";
import styles from "./AssetDetailDrawer.module.css";

function AssetPreview({ asset }) {
  const [failed, setFailed] = useState(false);
  const hasMedia = Boolean(asset.file_url && !failed);

  if (!hasMedia) {
    return (
      <div className={styles.drawerPreview}>
        {asset.media_type === "video" ? <Film size={28} /> : asset.media_type === "document" ? <FileText size={28} /> : <FileImage size={28} />}
      </div>
    );
  }

  return (
    <div className={styles.drawerPreview}>
      {asset.media_type === "video" ? (
        <video src={asset.file_url} controls onError={() => setFailed(true)} />
      ) : (
        <img src={asset.file_url} alt={asset.alt_text || getItemTitle(asset)} onError={() => setFailed(true)} />
      )}
    </div>
  );
}

export default function AssetDetailDrawer({
  asset,
  open,
  onClose,
  onSaveMetadata,
  onSchedule,
  onDelete,
  onDuplicate,
  onArchive,
  usedInPosts = [],
  versionChain = [],
  onOpenVersion,
  onNavigateToPost,
}) {
  const [form, setForm] = useState({ title: "", description: "", altText: "", tagsText: "" });
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!asset) return;
    setForm({
      title: asset.title || "",
      description: asset.description || "",
      altText: asset.alt_text || "",
      tagsText: Array.isArray(asset.tags) ? asset.tags.join(", ") : "",
    });
  }, [asset]);

  if (!asset) return null;

  const title = getItemTitle(asset);
  const aiTags = Array.isArray(asset.ai_tags) ? asset.ai_tags.filter(Boolean) : [];
  const userTags = Array.isArray(asset.tags) ? asset.tags.filter(Boolean) : [];

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveMetadata?.(asset.id, {
        title: form.title,
        description: form.description,
        alt_text: form.altText,
        tags: form.tagsText.split(",").map((t) => t.trim()).filter(Boolean),
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1400);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="min(460px, 94vw)"
      title={(
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          <Badge tone="neutral">{getSourceLabel(asset)}</Badge>
        </span>
      )}
    >
      <div className={styles.drawerSection}>
        <span className={styles.sectionKicker}>Preview</span>
        <AssetPreview asset={asset} />
      </div>

      <div className={styles.drawerSection}>
        <span className={styles.sectionKicker}>Metadata (editable)</span>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Title</span>
          <input
            className={styles.fieldInput}
            type="text"
            value={form.title}
            onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Description</span>
          <textarea
            className={styles.fieldTextarea}
            value={form.description}
            onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Alt text <span className={styles.fieldHint}>(AI-suggested, human-editable)</span></span>
          <input
            className={styles.fieldInput}
            type="text"
            value={form.altText}
            onChange={(event) => setForm((f) => ({ ...f, altText: event.target.value }))}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Tags <span className={styles.fieldHint}>(comma-separated)</span></span>
          <input
            className={styles.fieldInput}
            type="text"
            value={form.tagsText}
            onChange={(event) => setForm((f) => ({ ...f, tagsText: event.target.value }))}
          />
        </label>
        {(userTags.length > 0 || aiTags.length > 0) ? (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Current tags</span>
            <div className={styles.tagRow}>
              {userTags.map((tag) => <span key={`t-${tag}`} className={styles.tagChip}>{tag}</span>)}
              {aiTags.map((tag) => (
                <span key={`a-${tag}`} className={[styles.tagChip, styles.tagChipAi].join(" ")}>
                  <Sparkles size={10} aria-hidden="true" /> {tag}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className={styles.drawerSection}>
        <span className={styles.sectionKicker}>Used in <span className={styles.fieldHint} style={{ textTransform: "none", letterSpacing: 0 }}>(deep-links into Calendar&rsquo;s post detail)</span></span>
        {usedInPosts.length === 0 ? (
          <p className={styles.usedInEmpty}>Not used on any post yet — that&rsquo;s why this card shows the &quot;Unused&quot; badge.</p>
        ) : (
          <div className={styles.usedInList}>
            {usedInPosts.map((post) => (
              <button key={post.id} type="button" className={styles.usedInItem} onClick={() => onNavigateToPost?.(post)}>
                <span className={styles.usedInThumb}><FileText size={14} /></span>
                <span className={styles.usedInBody}>
                  <span className={styles.usedInTitle}>{post.title || post.caption || "Untitled post"}</span>
                  <span className={styles.usedInMeta}>{post.status} &middot; {formatDate(post.scheduled_at)}</span>
                </span>
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.drawerSection}>
        <span className={styles.sectionKicker}>Version history</span>
        {versionChain.length <= 1 ? (
          <p className={styles.fieldHint}>No prior versions — this is the only upload of this asset.</p>
        ) : (
          <div className={pageStyles.versionChain}>
            {versionChain.map((version, index) => (
              <div key={version.id}>
                <div
                  className={[
                    pageStyles.versionItem,
                    version.id === asset.id ? pageStyles.versionItemCurrent : pageStyles.versionItemSuperseded,
                  ].join(" ")}
                >
                  <span className={pageStyles.versionThumb} />
                  <div className={pageStyles.versionBody}>
                    <span className={pageStyles.versionLabel}>
                      {getItemTitle(version)}
                      {version.id === asset.id ? (
                        <Badge tone="accent">Current</Badge>
                      ) : (
                        <span className={styles.fieldHint}>(superseded)</span>
                      )}
                    </span>
                    <span className={pageStyles.versionMeta}>{formatDate(version.created_at)}</span>
                  </div>
                  <Button variant={version.id === asset.id ? "subtle" : "ghost"} size="sm" onClick={() => onOpenVersion?.(version)}>
                    View
                  </Button>
                </div>
                {index < versionChain.length - 1 ? <div className={pageStyles.versionConnector} /> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.drawerSection}>
        <span className={styles.sectionKicker}>Technical</span>
        <p className={styles.fieldHint}>
          {getFormatLabel(asset)}
          {asset.file_size_bytes ? ` · ${formatFileSize(asset.file_size_bytes)}` : ""}
          {asset.dimensions?.width ? ` · ${asset.dimensions.width}×${asset.dimensions.height}` : ""}
          {asset.duration_seconds ? ` · ${formatDuration(asset.duration_seconds)}` : ""}
          {` · uploaded ${formatDate(asset.created_at)}`}
          {asset.checksum ? " · checksum recorded" : ""}
        </p>
      </div>

      <div className={styles.drawerFooter}>
        <div className={styles.drawerFooterRow}>
          <Button variant="subtle" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : savedFlash ? "Saved" : "Save changes"}
          </Button>
          <Button size="sm" onClick={() => onSchedule?.(asset)}>Schedule&hellip;</Button>
        </div>
        <div className={styles.drawerFooterRow}>
          <Button variant="subtle" size="sm" onClick={() => onDuplicate?.(asset)}>Duplicate</Button>
          <Button variant="subtle" size="sm" onClick={() => onArchive?.(asset)}>
            {asset.status === "archived" ? "Unarchive" : "Archive"}
          </Button>
          <Button variant="dangerSolid" size="sm" onClick={() => onDelete?.(asset)}>Delete</Button>
        </div>
      </div>
    </Drawer>
  );
}
