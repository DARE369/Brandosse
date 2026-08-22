"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import SubmitForm from "../../components/video-engine/SubmitForm";
import { useAuth } from "../../Context/AuthContext";
import { fetchUserCredits } from "../../services/videoEngineData";
import { AppShell } from "../../ui-v2";

export default function VideoSubmitPage() {
  const { user } = useAuth();
  const [credits, setCredits] = React.useState(0);
  const [creditError, setCreditError] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!user?.id) return undefined;

    let active = true;
    fetchUserCredits(user.id)
      .then((data) => {
        if (active) setCredits(data?.balance ?? 0);
      })
      .catch(() => {
        if (active) setCreditError("Could not load your credit balance. Your balance may be displayed as 0.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [user?.id]);

  return (
    <AppShell activeKey="video" mainClassName="ve-app-content">
        {loading ? (
          <div className="ve-page-loading">
            <Loader2 size={28} className="ve-spin ve-loading-icon" aria-hidden="true" />
            <span>Loading…</span>
          </div>
        ) : (
          <SubmitForm initialCredits={credits} creditError={creditError} />
        )}
    </AppShell>
  );
}
