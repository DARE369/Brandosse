import { useState } from "react";
import { refreshClipUrl } from "../../services/videoEngineApi";

function safeFileName(value) {
  return String(value || "clip")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function useClipDownload() {
  const [downloadState, setDownloadState] = useState({});

  async function downloadClip(clipId, clipTitle, clipIndex) {
    setDownloadState((current) => ({ ...current, [clipId]: "refreshing" }));

    try {
      const { url } = await refreshClipUrl(clipId);
      setDownloadState((current) => ({ ...current, [clipId]: "downloading" }));

      const link = document.createElement("a");
      link.href = url;
      link.download = `clip_${Number(clipIndex ?? 0) + 1}_${safeFileName(clipTitle)}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      window.setTimeout(() => {
        setDownloadState((current) => ({ ...current, [clipId]: "idle" }));
      }, 1800);
    } catch (error) {
      console.error("[useClipDownload] Download failed:", error);
      setDownloadState((current) => ({ ...current, [clipId]: "error" }));
      window.setTimeout(() => {
        setDownloadState((current) => ({ ...current, [clipId]: "idle" }));
      }, 3000);
    }
  }

  function getStateForClip(clipId) {
    return downloadState[clipId] || "idle";
  }

  return { downloadClip, getStateForClip };
}
