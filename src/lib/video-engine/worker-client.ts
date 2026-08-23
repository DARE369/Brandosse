// src/lib/video-engine/worker-client.ts
// HTTP client for communicating with the Python worker service.
// Worker calls are best-effort and must not create user-facing failures.

const WORKER_URL = process.env.WORKER_WEBHOOK_URL || 'http://localhost:8001';
const WORKER_SECRET = process.env.VIDEO_WORKER_WEBHOOK_SECRET || '';
// The worker scales to zero to stay inside a $5/month budget (video-worker/
// fly.toml). A stopped Fly machine takes ~25s to answer its first request —
// measured 2026-08-23 — so a single 3s timeout, which is what this used to be,
// aborted EVERY call whenever the worker was asleep.
//
// Three different jobs, three different budgets:
const WORKER_TIMEOUT_MS = 3000;        // cancel: user is waiting, fail fast
const WORKER_WAKE_TIMEOUT_MS = 40000;  // submit: this call's PURPOSE is to wake it
const WORKER_HEALTH_TIMEOUT_MS = 35000; // health: a sleeping worker is not a broken one

function workerHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Worker-Secret': WORKER_SECRET,
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = WORKER_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function notifyJobSubmitted(jobId: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`${WORKER_URL}/webhook/job-submitted`, {
      method: 'POST',
      headers: workerHeaders(),
      body: JSON.stringify({ job_id: jobId }),
    }, WORKER_WAKE_TIMEOUT_MS);

    return response.ok;
  } catch (error) {
    console.warn('[WorkerClient] Failed to notify worker of new job:', jobId, error);
    return false;
  }
}

export async function notifyJobCancelled(
  jobId: string,
  userId: string,
  creditsToRefund: number,
): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`${WORKER_URL}/webhook/cancel-job`, {
      method: 'POST',
      headers: workerHeaders(),
      body: JSON.stringify({
        job_id: jobId,
        user_id: userId,
        credits_to_refund: creditsToRefund,
      }),
    });

    return response.ok;
  } catch (error) {
    console.warn('[WorkerClient] Failed to notify worker of job cancellation:', jobId, error);
    return false;
  }
}

export async function checkWorkerHealth(): Promise<{ healthy: boolean; details: string }> {
  try {
    const response = await fetchWithTimeout(`${WORKER_URL}/health`, {
      method: 'GET',
    }, WORKER_HEALTH_TIMEOUT_MS);

    if (!response.ok) {
      return { healthy: false, details: `Worker returned HTTP ${response.status}` };
    }

    const data = await response.json().catch(() => ({}));
    return { healthy: true, details: data.status || 'healthy' };
  } catch (error) {
    return {
      healthy: false,
      details: `Worker unreachable: ${String(error).slice(0, 100)}`,
    };
  }
}
