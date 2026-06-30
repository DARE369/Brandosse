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

export async function refreshClipUrl(clipId) {
  const response = await videoEngineFetch(`/api/video/clips/${clipId}/refresh-url`);
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
