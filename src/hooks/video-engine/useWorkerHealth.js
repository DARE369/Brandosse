import { useEffect, useState } from "react";
import { videoEngineFetch } from "../../services/videoEngineApi";

const POLL_INTERVAL_MS = 30_000;

/**
 * Worker liveness, as three states rather than two.
 *
 * ── Why "unknown" exists ────────────────────────────────────────────────────
 * This hook used to map any non-OK response to "unhealthy". `/api/video/health`
 * did not exist, so every poll 404'd and the answer was permanently "asleep" —
 * the submit screen warned about a 30-second wake-up delay on every visit, true
 * or not. The route exists now (app/api/video/health/route.ts), but the two-state
 * model was the deeper bug: it could not tell "the worker is asleep" from "I
 * could not find out."
 *
 * ── Why this goes through videoEngineFetch ─────────────────────────────────
 * The session lives in localStorage, not a cookie, so a bare fetch() sends no
 * credentials and /api/video/health answered 401 to every poll. The hook did
 * exactly what it promises — reported "unknown" — so nothing broke loudly and
 * the advisory simply never appeared again, including the times the worker
 * really was asleep. A permanently-silent warning is the same defect as the
 * permanently-on one this file was written to fix, wearing the other mask.
 * videoEngineFetch attaches the bearer token every other video route already
 * relies on (src/services/videoEngineApi.js:3).
 *
 * Callers must show the wake-up advisory ONLY on "asleep". "unknown" means say
 * nothing — an unverified warning is worse than silence, because it trains
 * people to ignore the one that matters.
 *
 * @returns {"healthy"|"asleep"|"unknown"}
 */
export function useWorkerHealth() {
  const [status, setStatus] = useState("unknown");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function check() {
      try {
        const res = await videoEngineFetch("/api/video/health", { signal: controller.signal });
        if (!active) return;

        if (!res.ok) {
          // The route is unreachable or refused us. That is a fact about this
          // request, not about the worker.
          setStatus("unknown");
          return;
        }

        const body = await res.json().catch(() => null);
        if (!active) return;

        if (typeof body?.healthy !== "boolean") {
          setStatus("unknown");
          return;
        }

        setStatus(body.healthy ? "healthy" : "asleep");
      } catch {
        // Aborted, offline, or a network fault — again, unknown, not asleep.
        if (active) setStatus("unknown");
      }
    }

    check();
    const id = setInterval(check, POLL_INTERVAL_MS);

    return () => {
      active = false;
      controller.abort();
      clearInterval(id);
    };
  }, []);

  return status;
}
