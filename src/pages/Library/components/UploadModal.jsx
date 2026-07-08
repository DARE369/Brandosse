"use client";

// Asset upload modal — ui-v2 rebuild of
// src/pages/LibraryPage/components/AssetUploadModal.jsx (AS_IS_AUDIT.md
// §3.2 — Refactor). Each file uploads independently via the real
// LibraryStore.uploadAsset()/assetLibraryService.uploadPersonalAsset() path
// (personal-asset-upload edge function), so one failed/invalid file never
// blocks the rest of a multi-file batch (LIBRARY_SPEC.md §11). Duplicate
// detection + "mark as new version" flow ported 1:1 from the approved
// mockup's #uploadDupOverlay state.
import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileImage, Film, Upload, X } from "lucide-react";
import { Button, Modal } from "../../../ui-v2";
import styles from "./UploadModal.module.css";

function makeQueueId(file, index) {
  return `${Date.now()}-${index}-${file.name}`;
}

function QueueItemThumb({ file }) {
  const isVideo = /^video\//.test(file?.type || "") || /\.(mp4|webm|mov)$/i.test(file?.name || "");
  return (
    <span className={styles.queueThumb}>
      {isVideo ? <Film size={16} /> : <FileImage size={16} />}
    </span>
  );
}

function UploadQueueRow({ item, onDismissDuplicate, onMarkVersion }) {
  return (
    <div>
      <div className={[styles.queueItem, item.status === "failed" ? styles.queueItemFailed : ""].filter(Boolean).join(" ")}>
        <QueueItemThumb file={item.file} />
        <div className={styles.queueBody}>
          <div className={styles.queueNameRow}>
            <span className={styles.queueName}>{item.name}</span>
            <span className={styles.queuePct}>{item.status === "failed" ? "Failed" : `${item.progress}%`}</span>
          </div>
          <div className={styles.queueTrack}>
            <div className={styles.queueFill} style={{ width: `${item.progress}%` }} />
          </div>
          {item.status === "failed" && item.errorText ? (
            <p className={styles.queueErrorText}>{item.errorText}</p>
          ) : null}
        </div>
        {item.status === "done" ? (
          <span className={[styles.queueStatusIcon, styles.toneSuccess].join(" ")}><CheckCircle2 size={14} /></span>
        ) : item.status === "failed" ? (
          <span className={[styles.queueStatusIcon, styles.toneDanger].join(" ")}><X size={14} /></span>
        ) : null}
      </div>

      {item.duplicateOf ? (
        <div className={styles.duplicateWarning}>
          <span className={styles.dwIcon}><AlertTriangle size={16} /></span>
          <div>
            <strong>This looks like a duplicate of &quot;{item.duplicateOf.title || "an existing asset"}&quot;</strong>
            <p>Some duplicates are intentional re-uploads of an edited version.</p>
            <div className={styles.dwActions}>
              <Button variant="subtle" size="sm" onClick={onMarkVersion} disabled={item.linkingVersion}>
                {item.linkingVersion ? "Linking…" : "This is a new version"}
              </Button>
              <Button variant="ghost" size="sm" onClick={onDismissDuplicate} disabled={item.linkingVersion}>
                It&rsquo;s a separate asset
              </Button>
            </div>
            {item.versionLinkError ? (
              <p className={styles.queueErrorText} style={{ marginTop: 6 }}>{item.versionLinkError}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {item.dismissedDuplicate ? (
        <p style={{ fontSize: 11, color: "var(--uiv2-text-tertiary)", marginTop: 6, marginLeft: 46 }}>
          {item.dismissedDuplicate === "version"
            ? "Linked as a new version — the previous upload is now superseded."
            : "Kept as a separate asset."}
        </p>
      ) : null}

      {item.status === "done" && !item.duplicateOf && item.asset?.ai_tagging_status === "pending" ? (
        <div className={styles.aiShimmerRow}>
          <span className={[styles.shimmerLine, styles.shimmerLineW1].join(" ")} />
          <span className={[styles.shimmerLine, styles.shimmerLineW2].join(" ")} />
        </div>
      ) : null}
    </div>
  );
}

export default function UploadModal({ open, onClose, onUploadOne, onMarkAsVersion }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState([]);

  const setQueueItem = (id, patch) => {
    setQueue((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const close = () => {
    onClose?.();
    setQueue([]);
  };

  const handleFiles = async (fileList) => {
    if (!fileList?.length) return;
    const files = Array.from(fileList);
    const newItems = files.map((file, index) => ({
      id: makeQueueId(file, index),
      file,
      name: file.name,
      progress: 0,
      status: "uploading",
      errorText: null,
      duplicateOf: null,
    }));
    setQueue((items) => [...items, ...newItems]);

    newItems.forEach((item) => {
      onUploadOne({
        file: item.file,
        onProgress: (pct) => setQueueItem(item.id, { progress: pct }),
      }).then((result) => {
        setQueueItem(item.id, {
          progress: 100,
          status: "done",
          duplicateOf: result?.duplicate_of || null,
          asset: result?.asset || null,
        });
      }).catch((error) => {
        setQueueItem(item.id, {
          progress: 100,
          status: "failed",
          errorText: error?.message || "Upload failed — try again.",
        });
      });
    });
  };

  const triggerBrowse = () => inputRef.current?.click();

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Upload assets"
      description="Images, video, PDFs. Up to 50MB each — multiple files at once."
      actions={<Button variant="subtle" onClick={close} style={{ flex: "none" }}>Done</Button>}
    >
      <div
        className={[styles.dropzone, dragging ? styles.dropzoneDragging : ""].filter(Boolean).join(" ")}
        role="button"
        tabIndex={0}
        aria-label="Upload assets — drop files here or activate to browse"
        onClick={triggerBrowse}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            triggerBrowse();
          }
        }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer?.files);
        }}
      >
        <div className={styles.dzIcon}><Upload size={22} /></div>
        <p className={styles.dzTitle}>Drop files here or click to upload</p>
        <p className={styles.dzHint}>Images, video, PDFs &middot; up to 50MB each &middot; multiple files at once</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept="image/*,video/*,application/pdf"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {queue.length > 0 ? (
        <div className={styles.uploadQueue} aria-live="polite">
          {queue.map((item) => (
            <UploadQueueRow
              key={item.id}
              item={item}
              onDismissDuplicate={() => setQueueItem(item.id, { duplicateOf: null, dismissedDuplicate: "separate" })}
              onMarkVersion={async () => {
                if (!item.asset?.id || !item.duplicateOf?.id) return;
                setQueueItem(item.id, { linkingVersion: true });
                try {
                  await onMarkAsVersion?.({ oldAssetId: item.duplicateOf.id, newAssetId: item.asset.id });
                  setQueueItem(item.id, { duplicateOf: null, dismissedDuplicate: "version", linkingVersion: false });
                } catch (error) {
                  setQueueItem(item.id, {
                    linkingVersion: false,
                    versionLinkError: error?.message || "Could not link this as a new version — try again.",
                  });
                }
              }}
            />
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
