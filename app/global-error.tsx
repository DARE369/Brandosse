"use client";

// app/global-error.tsx — LOCK L0.4
//
// Next.js renders this when a React error escapes every other boundary. Without
// it those errors never reach Sentry: they happen during render, so no route
// handler and no server action is involved, and onRequestError never fires.
//
// This is the difference between "we log server failures" and "we know when the
// app is white-screening for a user" — the second is what a user actually
// experiences and the one nobody was seeing.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", minHeight: "100vh", gap: "1rem",
          fontFamily: "system-ui, sans-serif", padding: "2rem", textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", margin: 0 }}>Something went wrong</h1>
        {/* Say what happened without leaking a stack trace to the user — the
            same rule applied to job failures under LOCK L2.7. */}
        <p style={{ margin: 0, opacity: 0.7, maxWidth: "40ch" }}>
          This has been reported automatically. Trying again often works.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: "0.5rem 1rem", borderRadius: 6, border: "1px solid currentColor",
            background: "transparent", cursor: "pointer", font: "inherit",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
