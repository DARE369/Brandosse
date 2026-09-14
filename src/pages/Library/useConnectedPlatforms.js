"use client";

// Which platforms this user can actually publish to, right now.
//
// Reads connected_accounts_health_summary, not connected_accounts: that view
// computes can_publish from the provider registry PLUS evidence of a live
// credential (migration 20260904140000), so an account whose token failed to
// save or has since expired is correctly excluded. RLS scopes it to the caller.
//
// This is the same source QuickPostComposer uses, deliberately — two different
// answers to "where can I publish?" on two screens of the same flow is how a
// user ends up trusting neither.
//
// RETURNS null, NOT [], while loading or on error. The distinction carries real
// meaning downstream: derivePublishability() renders an empty array as "there
// is nowhere to send this", which is a claim about the user's account setup. If
// we simply could not reach the view, making that claim tells them their
// connected accounts have vanished. null means "unknown", and the gates stay
// permissive until we actually know.
import { useEffect, useState } from "react";
import { supabase } from "../../services/supabaseClient";

export default function useConnectedPlatforms() {
  const [platforms, setPlatforms] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("connected_accounts_health_summary")
        .select("platform, can_publish")
        .eq("scope", "personal");

      if (cancelled) return;

      if (error) {
        // Stay null. A failed lookup must not be reported as "nothing connected".
        console.error("[library] could not load connected accounts:", error.message);
        return;
      }

      const keys = [...new Set(
        (data || [])
          .filter((row) => row.can_publish)
          .map((row) => String(row.platform || "").toLowerCase())
          .filter(Boolean),
      )];

      setPlatforms(keys);
    })();

    return () => { cancelled = true; };
  }, []);

  return platforms;
}
