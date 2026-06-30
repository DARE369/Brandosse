import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 30_000;

export function useWorkerHealth() {
  const [status, setStatus] = useState("unknown"); // "healthy" | "unhealthy" | "unknown"

  useEffect(() => {
    let active = true;

    async function check() {
      try {
        const res = await fetch("/api/video/health");
        if (!active) return;
        setStatus(res.ok ? "healthy" : "unhealthy");
      } catch {
        if (active) setStatus("unhealthy");
      }
    }

    check();
    const id = setInterval(check, POLL_INTERVAL_MS);
    return () => { active = false; clearInterval(id); };
  }, []);

  return status;
}
