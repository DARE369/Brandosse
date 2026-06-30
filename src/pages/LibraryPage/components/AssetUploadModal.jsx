"use client";

// Asset upload modal — net-new component the approved mockup's upload flow
// requires (mockup-gallery.html #upload-flow / #upload-duplicate /
// #upload-ai-tagging / #upload-validation-failure). Modeled on
// src/components/BrandKit/AssetUploader.jsx's real drag-drop + per-file
// progress queue pattern (RESEARCH.md §1, read-only reference — not
// modified), not the org library's weaker single-file modal. Each file
// uploads independently via assetLibraryService.uploadPersonalAsset() (the
// personal-asset-upload edge function) so one failed/invalid file never
// blocks the rest of a multi-file batch (LIBRARY_SPEC.md §11).
import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileImage, Film, Upload, X } from 'lucide-react';
import { UiButton, UiIconButton, UiModal } from '../../../components/Shared/ui';

function makeQueueId(file, index) {
  return `${Date.now()}-${index}-${file.name}`;
}

function QueueItemThumb({ file }) {
  const isVideo = /^video\//.test(file?.type || '') || /\.(mp4|webm|mov)$/i.test(file?.name || '');
  return (
    <span className="upload-queue-item__thumb">
      {isVideo ? <Film size={16} /> : <FileImage size={16} />}
    </span>
  );
}

export default function AssetUploadModal({ open, onClose, onUploadOne, onMarkAsVersion }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  // queue: [{ id, file, name, progress, status: 'uploading'|'done'|'failed',
  //           errorText, duplicateOf, asset }]
  const [queue, setQueue] = useState([]);

  const setQueueItem = (id, patch) => {
    setQueue((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const close = () => {
    onClose?.();
    // Clear the queue only after the close animation's tick — leaving it
    // visible while the modal is open even across re-opens within the same
    // session is fine, but starting fresh next time avoids stale rows.
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
      status: 'uploading',
      errorText: null,
      duplicateOf: null,
    }));
    setQueue((items) => [...items, ...newItems]);

    // Each file uploads independently — Promise.allSettled-equivalent via
    // individual try/catch per item, so one rejection never aborts siblings
    // still in flight (LIBRARY_SPEC.md §11's explicit requirement).
    newItems.forEach((item) => {
      onUploadOne({
        file: item.file,
        onProgress: (pct) => setQueueItem(item.id, { progress: pct }),
      }).then((result) => {
        setQueueItem(item.id, {
          progress: 100,
          status: 'done',
          duplicateOf: result?.duplicate_of || null,
          asset: result?.asset || null,
        });
      }).catch((error) => {
        setQueueItem(item.id, {
          progress: 100,
          status: 'failed',
          errorText: error?.message || 'Upload failed — try again.',
        });
      });
    });
  };

  const triggerBrowse = () => inputRef.current?.click();

  return (
    <UiModal
      open={open}
      onClose={close}
      title="Upload assets"
      size="lg"
      className="lib-modal"
      footer={(
        <UiButton type="button" variant="secondary" onClick={close}>Done</UiButton>
      )}
    >
      <div
        className={`upload-dropzone${dragging ? ' is-dragging' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Upload assets — drop files here or activate to browse"
        aria-describedby="upload-dropzone-hint"
        onClick={triggerBrowse}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
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
        <span className="upload-dropzone__icon"><Upload size={22} /></span>
        <p className="upload-dropzone__title">Drop files here or click to upload</p>
        <p className="upload-dropzone__hint" id="upload-dropzone-hint">
          Images, video, PDFs &middot; up to 50MB each &middot; multiple files at once
        </p>
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
            event.target.value = '';
          }}
        />
      </div>

      {queue.length > 0 ? (
        <div className="upload-queue" aria-live="polite">
          {queue.map((item) => (
            <UploadQueueRow
              key={item.id}
              item={item}
              onDismissDuplicate={() => setQueueItem(item.id, { duplicateOf: null, dismissedDuplicate: 'separate' })}
              onMarkVersion={async () => {
                // Actually link the new upload to the asset it superseded
                // (LIBRARY_SPEC.md §6.2) — the old row gets
                // superseded_by_asset_id pointed at this new row's id, via
                // the real store/service call, not just a local label swap.
                if (!item.asset?.id || !item.duplicateOf?.id) return;
                setQueueItem(item.id, { linkingVersion: true });
                try {
                  await onMarkAsVersion?.({ oldAssetId: item.duplicateOf.id, newAssetId: item.asset.id });
                  setQueueItem(item.id, { duplicateOf: null, dismissedDuplicate: 'version', linkingVersion: false });
                } catch (error) {
                  setQueueItem(item.id, {
                    linkingVersion: false,
                    versionLinkError: error?.message || 'Could not link this as a new version — try again.',
                  });
                }
              }}
            />
          ))}
        </div>
      ) : null}
    </UiModal>
  );
}

function UploadQueueRow({ item, onDismissDuplicate, onMarkVersion }) {
  const showShimmer = item.status === 'done' && !item.duplicateOf && item.asset?.ai_tagging_status === 'pending';

  return (
    <div>
      <div className={`upload-queue-item${item.status === 'done' ? ' is-done' : ''}${item.status === 'failed' ? ' is-failed' : ''}`}>
        <QueueItemThumb file={item.file} />
        <div className="upload-queue-item__body">
          <div className="upload-queue-item__name-row">
            <span className="upload-queue-item__name">{item.name}</span>
            <span className="upload-queue-item__pct">{item.status === 'failed' ? 'Failed' : `${item.progress}%`}</span>
          </div>
          <div className="upload-queue-item__track">
            <div className="upload-queue-item__fill" style={{ width: `${item.progress}%` }} />
          </div>
          {item.status === 'failed' && item.errorText ? (
            <p className="upload-queue-item__error-text">{item.errorText}</p>
          ) : null}
        </div>
        {item.status === 'done' ? (
          <span className="upload-queue-item__status-icon tone-success"><CheckCircle2 size={14} /></span>
        ) : item.status === 'failed' ? (
          <span className="upload-queue-item__status-icon tone-danger"><X size={14} /></span>
        ) : null}
      </div>

      {item.duplicateOf ? (
        <div className="duplicate-warning">
          <span className="duplicate-warning__icon"><AlertTriangle size={16} /></span>
          <div>
            <strong>This looks like a duplicate of &quot;{item.duplicateOf.title || 'an existing asset'}&quot;</strong>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
              Some duplicates are intentional re-uploads of an edited version.
            </p>
            <div className="duplicate-warning__actions">
              <button
                type="button"
                className="ui-button ui-button-secondary sm"
                onClick={onMarkVersion}
                disabled={item.linkingVersion}
              >
                {item.linkingVersion ? 'Linking…' : 'This is a new version'}
              </button>
              <button type="button" className="ui-button ui-button-ghost sm" onClick={onDismissDuplicate} disabled={item.linkingVersion}>
                It&rsquo;s a separate asset
              </button>
            </div>
            {item.versionLinkError ? (
              <p className="upload-queue-item__error-text" style={{ marginTop: 6 }}>{item.versionLinkError}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {item.dismissedDuplicate ? (
        <p className="ui-field-hint" style={{ marginTop: 6 }}>
          {item.dismissedDuplicate === 'version'
            ? 'Linked as a new version — the previous upload is now superseded.'
            : 'Kept as a separate asset.'}
        </p>
      ) : null}

      {showShimmer ? (
        <div className="asset-card__ai-shimmer-row" style={{ paddingLeft: 56 }}>
          <span className="skel ai-shimmer-line w1" />
          <span className="skel ai-shimmer-line w2" />
        </div>
      ) : null}
    </div>
  );
}
