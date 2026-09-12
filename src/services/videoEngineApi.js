import { supabase } from "./supabaseClient";

export async function videoEngineFetch(path, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  const headers = new Headers(options.headers || {});

  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(path, {
    ...options,
    headers,
  });
}

export async function parseApiResponse(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }

  return data;
}

export async function submitVideoJob({ url, platform, ...prefs }) {
  const response = await videoEngineFetch("/api/video/submit", {
    method: "POST",
    body: JSON.stringify({ url, platform, ...prefs }),
  });

  return parseApiResponse(response);
}

/**
 * Get a short-lived signed ticket for uploading source video straight to the
 * worker (LOCK L7.4).
 *
 * The worker's shared secret never reaches the browser — the server signs an
 * HMAC bound to this user and one upload id, and the worker verifies it without
 * calling back here.
 */
export async function requestUploadTicket() {
  const response = await videoEngineFetch("/api/video/upload-ticket", { method: "POST" });
  return parseApiResponse(response);
}

export async function refreshClipUrl(clipId) {
  const response = await videoEngineFetch(`/api/video/clips/${clipId}/refresh-url`);
  return parseApiResponse(response);
}

/**
 * Turn a rendered clip into a draft post the publisher can actually reach.
 *
 * The route this calls has existed and been correct since it was written; it
 * simply had no caller, so every clip this product rendered was unpublishable
 * — downloadable and nothing else. This function is that missing caller.
 *
 * Why it matters mechanically: the publisher resolves media through
 * posts -> generations (publish-post/index.ts:81-88) and cannot see
 * `video_clips` at all. The route writes the adapter row, storing the storage
 * PATH plus bucket rather than a signed URL, so a post scheduled weeks out
 * still resolves at dispatch instead of carrying a signature that died days
 * earlier.
 *
 * Resolves to { postId, generationId, reused, title, durationSeconds,
 * fileSizeBytes }.
 */
export async function publishClipToDraft(clipId) {
  const response = await videoEngineFetch(`/api/video/clips/${clipId}/publish`, {
    method: "POST",
  });
  return parseApiResponse(response);
}

export async function deleteVideoJob(jobId) {
  const response = await videoEngineFetch(`/api/video/jobs/${jobId}`, {
    method: "DELETE",
  });

  return parseApiResponse(response);
}

export async function purchaseCredits(packageId) {
  const response = await videoEngineFetch("/api/credits/purchase", {
    method: "POST",
    body: JSON.stringify({ package_id: packageId }),
  });

  return parseApiResponse(response);
}

export async function fetchCreditBalance() {
  const response = await videoEngineFetch("/api/credits/balance");
  return parseApiResponse(response);
}

// ─── Rerun ───────────────────────────────────────────────────────────────────

/**
 * Run a previous job again with the same source and the same settings.
 *
 * Replaces the old "Try again" behaviour, which navigated to the submit form
 * with only `?url=` prefilled and silently discarded every other choice the
 * person had made. This costs credits again — the caller must say so before
 * calling it.
 */
export async function rerunVideoJob(jobId) {
  const response = await videoEngineFetch(`/api/video/jobs/${jobId}/rerun`, { method: "POST" });
  return parseApiResponse(response);
}

// ─── Job list ────────────────────────────────────────────────────────────────

/**
 * One page of jobs, plus the capacity block (slots, hourly usage, balance,
 * clips expiring soon) the interface needs to state limits BEFORE a person
 * hits them rather than after.
 */
export async function fetchJobsPage({ q = "", status = "all", sort = "newest", page = 1, limit = 25 } = {}) {
  const params = new URLSearchParams({ status, sort, page: String(page), limit: String(limit) });
  if (q.trim()) params.set("q", q.trim());

  const response = await videoEngineFetch(`/api/video/jobs?${params.toString()}`);
  return parseApiResponse(response);
}

// ─── Authenticated downloads ─────────────────────────────────────────────────

/**
 * Download a protected endpoint to the user's disk.
 *
 * ── Why this is not just an <a download> ──────────────────────────────────
 * The browser Supabase client stores its session in localStorage, not cookies
 * (src/services/supabaseClient.js uses createClient, not createBrowserClient),
 * so a plain anchor navigation carries no credentials and the route answers
 * 401. Every download here therefore goes through an authenticated fetch.
 *
 * ── The cost of that, stated plainly ──────────────────────────────────────
 * The bytes land in browser memory before they land on disk. For a job's clips
 * that is roughly 50-150MB, which browsers handle comfortably; it is not a
 * pattern to reuse for arbitrarily large files. `onProgress` receives bytes
 * received so far, because the response is chunked and its total length is
 * genuinely unknown until it ends — so the UI can show movement, but must not
 * claim a percentage.
 */
export async function downloadAuthedFile(path, fallbackFilename, { onProgress, signal } = {}) {
  const response = await videoEngineFetch(path, { signal });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `Download failed with status ${response.status}`);
  }

  const filename = filenameFromDisposition(response.headers.get("Content-Disposition")) || fallbackFilename;

  let blob;
  if (response.body && typeof onProgress === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(received);
    }

    blob = new Blob(chunks, { type: response.headers.get("Content-Type") || "application/octet-stream" });
  } else {
    blob = await response.blob();
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoked on the next tick: revoking synchronously can cancel the download
    // in some browsers before it has committed the blob to disk.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }

  return { filename, clipCount: Number(response.headers.get("X-Clip-Count")) || null };
}

/** Pull the server's filename out of Content-Disposition, preferring the
 *  RFC 5987 `filename*` form so non-ASCII titles survive. */
function filenameFromDisposition(header) {
  if (!header) return null;

  const extended = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      /* fall through to the plain form */
    }
  }

  const plain = /filename="([^"]+)"/i.exec(header);
  return plain ? plain[1] : null;
}

/**
 * Every rendered clip in one ZIP — or just the ones asked for.
 *
 * `clipIds` exists because the bulk bar offers "Download" over a selection, and
 * firing one browser download per clip does not work: browsers block the third
 * onwards as unsolicited, leaving an incomplete set and no error. One response
 * is one download either way.
 */
export function downloadJobArchive(jobId, fallback = "clips.zip", { clipIds, ...options } = {}) {
  const ids = Array.isArray(clipIds) ? clipIds.filter(Boolean) : null;
  const query = ids && ids.length > 0 ? `?clips=${ids.map(encodeURIComponent).join(",")}` : "";
  return downloadAuthedFile(`/api/video/jobs/${jobId}/archive${query}`, fallback, options);
}

/** The job's transcript as timestamped plain text. */
export function downloadJobTranscript(jobId, fallback = "transcript.txt", options) {
  return downloadAuthedFile(`/api/video/jobs/${jobId}/transcript`, fallback, options);
}

// ─── Source upload, with real progress ───────────────────────────────────────

/**
 * Send a source file straight to the worker's volume, reporting progress.
 *
 * ── Why XHR and not fetch ─────────────────────────────────────────────────
 * `fetch` has no upload-progress event. There is a streaming-request form
 * (duplex: 'half') but it is not supported across the browsers this ships to,
 * and it still reports nothing useful about how much has left the machine. XHR
 * has exposed `upload.onprogress` for fifteen years and is the correct tool.
 *
 * This is the reason the old form could only ever display the word
 * "Uploading…": not an oversight in the UI, a limitation of the transport it
 * was built on. Up to 4GB moved behind a single word with no bytes, no rate, no
 * estimate, and no way to stop — a multi-minute silence during the one wait
 * that happens before the pipeline has even started.
 *
 * @param {File} file
 * @param {{ upload_url: string, user_id: string, upload_id: string, expires_at: number, signature: string, source_url: string }} ticket
 * @param {{ onProgress?: (p: {loaded:number,total:number,ratio:number}) => void, signal?: AbortSignal }} [options]
 * @returns {Promise<string>} the `worker://` reference to store on the job
 */
export function uploadSourceToWorker(file, ticket, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", ticket.upload_url, true);

    const ext = (file.name.split(".").pop() || "mp4").toLowerCase().slice(0, 5);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.setRequestHeader("X-Upload-User", ticket.user_id);
    xhr.setRequestHeader("X-Upload-Id", ticket.upload_id);
    xhr.setRequestHeader("X-Upload-Expires", String(ticket.expires_at));
    xhr.setRequestHeader("X-Upload-Signature", ticket.signature);
    xhr.setRequestHeader("X-Upload-Ext", ext);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || typeof onProgress !== "function") return;
      onProgress({
        loaded: event.loaded,
        total: event.total,
        ratio: event.total > 0 ? event.loaded / event.total : 0,
      });
    };

    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = () => signal?.removeEventListener("abort", onAbort);

    xhr.onload = () => {
      cleanup();

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(ticket.source_url);
        return;
      }

      // The worker's own message is preferred over ours wherever it sends one —
      // it knows things this side cannot, like how much disk is left.
      let detail = "";
      try {
        detail = JSON.parse(xhr.responseText)?.detail || "";
      } catch {
        detail = (xhr.responseText || "").slice(0, 300);
      }

      if (xhr.status === 507) {
        reject(new Error(detail || "The processor is out of disk space. Try again once current jobs finish."));
      } else if (xhr.status === 413) {
        reject(new Error(detail || "That file is over the size limit."));
      } else if (xhr.status === 403) {
        reject(new Error("That upload window expired. Reload the page and try again."));
      } else {
        reject(new Error(detail || `Upload failed (HTTP ${xhr.status}).`));
      }
    };

    xhr.onerror = () => {
      cleanup();
      reject(new Error("The upload connection dropped. Nothing was charged — try again."));
    };

    xhr.ontimeout = () => {
      cleanup();
      reject(new Error("The upload timed out. Nothing was charged — try again."));
    };

    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("Upload cancelled", "AbortError"));
    };

    xhr.send(file);
  });
}
