"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ImageOff } from "lucide-react";
import { Button } from "../../ui-v2";
import styles from "./StudioLightbox.module.css";

export default function StudioLightbox({ generation, index, count, onClose, onPrev, onNext, onSelect, onUseForPost, onRegenerate, regenerating = false }) {
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
        <div className={styles.actions}>
          <span className={styles.position}>{index + 1} / {count}</span>
          {onRegenerate && (
            <Button variant="ghost" onClick={onRegenerate} disabled={regenerating}>
              {regenerating ? "Regenerating…" : "Regenerate this"}
            </Button>
          )}
          <Button variant="ghost" onClick={onSelect}>Select this</Button>
          <Button onClick={onUseForPost}>Use for post</Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
