"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../services/supabaseClient";

const SIGNED_URL_EXPIRY_SECONDS = 3600;
const STORAGE_BUCKET = "video-clips";

export function useSignedUrls(initialClips) {
  const [clips, setClips] = useState(initialClips || []);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setClips(initialClips || []);
  }, [initialClips]);

  useEffect(() => {
    if (!initialClips || initialClips.length === 0) return;

    const refreshableClips = initialClips.filter(
      (c) => c.storage_path && c.render_status === "complete"
    );

    if (refreshableClips.length === 0) return;

    let cancelled = false;

    async function refreshAll() {
      setIsRefreshing(true);

      const refreshed = await Promise.all(
        initialClips.map(async (clip) => {
          if (!clip.storage_path || clip.render_status !== "complete") {
            return clip;
          }

          try {
            const { data, error } = await supabase.storage
              .from(STORAGE_BUCKET)
              .createSignedUrl(clip.storage_path, SIGNED_URL_EXPIRY_SECONDS);

            if (error || !data?.signedUrl) {
              return clip;
            }

            let freshThumbnailUrl = clip.thumbnail_url;
            if (clip.thumbnail_path) {
              const { data: thumbData } = await supabase.storage
                .from(STORAGE_BUCKET)
                .createSignedUrl(clip.thumbnail_path, SIGNED_URL_EXPIRY_SECONDS);
              freshThumbnailUrl = thumbData?.signedUrl || clip.thumbnail_url;
            }

            return {
              ...clip,
              public_url:    data.signedUrl,
              thumbnail_url: freshThumbnailUrl,
            };
          } catch {
            return clip;
          }
        })
      );

      if (!cancelled) {
        setClips(refreshed);
        setIsRefreshing(false);
      }
    }

    refreshAll();

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshClip = useCallback(async (clipId) => {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip || !clip.storage_path) return;

    try {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(clip.storage_path, SIGNED_URL_EXPIRY_SECONDS);

      if (error || !data?.signedUrl) return;

      setClips((prev) =>
        prev.map((c) =>
          c.id === clipId ? { ...c, public_url: data.signedUrl } : c
        )
      );
    } catch {
      // Silently fail
    }
  }, [clips]);

  return { clips, refreshClip, isRefreshing };
}
