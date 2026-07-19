"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ImageOff } from "lucide-react";
import { Button } from "../../ui-v2";
import styles from "./StudioLightbox.module.css";

// 3.3: human-readable label for the model that produced this generation.
const MODEL_LABELS = { flux: "Photo · FLUX.2 Pro", ideogram: "Text · Ideogram v3", recraft: "Design · Recraft v3" };
function modelLabel(meta) {
  const m = meta?.image_model;
  return MODEL_LABELS[m] || (meta?.provider_model ? String(meta.provider_model).split("/").pop() : null);
}

export default function StudioLightbox({ generation, index, count, onClose, onPrev, onNext, onSelect, onUseForPost, onRegenerate, onEdit, onAnimate, onAddReference, onUpscale, upscaling = false, regenerating = false }) {
  const [mediaFailed, setMediaFailed] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  // Reset per generation — old rows from a since-removed image provider
  // (Pollinations.ai) have URLs that no longer resolve at all; this shows a
  // plain placeholder instead of a permanently broken image/video element.
  useEffect(() => { setMediaFailed(false); }, [generation?.id]);

  if (typeof document === "undefined") return null;
  const src = generation?.storage_path || generation?.output_url || generation?.thumbnail_url;
  const meta = generation?.metadata || {};
  const isImage = generation?.media_type !== "video";
  const model = modelLabel(meta);
  const seed = meta.seed;
  const quality = meta.quality;
  const promptUsed = meta.enhanced_prompt || generation?.prompt;

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
      </button>
      <button type="button" className={[styles.navBtn, styles.navPrev].join(" ")} onClick={(e) => { e.stopPropagation(); onPrev(); }} aria-label="Previous">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button type="button" className={[styles.navBtn, styles.navNext].join(" ")} onClick={(e) => { e.stopPropagation(); onNext(); }} aria-label="Next">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div className={styles.body} onClick={(e) => e.stopPropagation()}>
        <div className={styles.mediaWrap}>
          {src && !mediaFailed ? (
            generation?.media_type === "video" ? (
              <video className={styles.media} src={src} controls onError={() => setMediaFailed(true)} />
            ) : (
              <img className={styles.media} src={src} alt="" onError={() => setMediaFailed(true)} />
            )
          ) : (
            <div className={styles.mediaFallback}>
              <ImageOff size={28} aria-hidden="true" />
              <span>{src ? "This media is no longer available" : "No media for this generation"}</span>
            </div>
          )}
        </div>
        {/* 3.3: "shot" info — the reproducibility data 0.2 now stores. */}
        {(model || seed != null || quality || promptUsed) && (
          <div className={styles.shotInfo}>
            <div className={styles.shotMeta}>
              {model && <span className={styles.shotTag}>{model}</span>}
              {seed != null && <span className={styles.shotTag} title="Seed — reuse to reproduce">seed {seed}</span>}
              {quality?.quality_score != null && (
                <span
                  className={styles.shotTag}
                  title={(quality.flags || []).join(" · ") || "Quality score"}
                  style={{ color: quality.verdict === "fail" ? "#e06a5a" : quality.verdict === "warn" ? "#d6a53a" : undefined }}
                >
                  quality {quality.quality_score}
                </span>
              )}
              {/* 6.4: complete the recipe — references + upscale finish. */}
              {meta.reference_count > 0 && <span className={styles.shotTag} title="Reference images guided this render">{meta.reference_count} ref{meta.reference_count > 1 ? "s" : ""}</span>}
              {meta.upscaled && <span className={styles.shotTag} title="Upscaled / finished">upscaled</span>}
            </div>
            {promptUsed && <p className={styles.shotPrompt} title={promptUsed}>{promptUsed}</p>}
          </div>
        )}
        <div className={styles.actions}>
          <span className={styles.position}>{index + 1} / {count}</span>
          {onRegenerate && (
            <Button variant="ghost" onClick={onRegenerate} disabled={regenerating}>
              {regenerating ? "Regenerating…" : "Regenerate this"}
            </Button>
          )}
          {isImage && onEdit && <Button variant="ghost" onClick={onEdit}>Edit</Button>}
          {isImage && onAnimate && <Button variant="ghost" onClick={onAnimate}>Animate</Button>}
          {isImage && onAddReference && <Button variant="ghost" onClick={onAddReference}>Pin as reference</Button>}
          {isImage && onUpscale && !meta.upscaled && (
            <Button variant="ghost" onClick={onUpscale} disabled={upscaling}>{upscaling ? "Upscaling…" : "Upscale"}</Button>
          )}
          {meta.upscaled && <span className={styles.shotTag}>upscaled</span>}
          <Button variant="ghost" onClick={onSelect}>Select this</Button>
          <Button onClick={onUseForPost}>Use for post</Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
