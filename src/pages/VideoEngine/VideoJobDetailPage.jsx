"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import UserNavbar from "../../components/User/UserNavbar";
import UserSidebar from "../../components/User/UserSidebar";
import JobDetailView from "../../components/video-engine/JobDetailView";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useAuth } from "../../Context/AuthContext";
import { fetchJobDetail } from "../../services/videoEngineData";

export default function VideoJobDetailPage({ jobId = null }) {
  const { navigate, pathname } = useAppNavigation();
  const fallbackJobId = pathname.split("/").filter(Boolean).slice(-1)[0] || null;
  const id = jobId ?? fallbackJobId;
  const { user } = useAuth();
  const [detail, setDetail] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!user?.id || !id) return undefined;

    let active = true;
    fetchJobDetail(user.id, id)
      .then((data) => { if (active) setDetail(data); })
      .catch(() => { if (active) setError("Job not found or you don't have access to it."); })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [id, user?.id]);

  return (
    <div className="dashboard-shell">
      <UserNavbar />
      <UserSidebar />
      <main className="dashboard-content ve-app-content" id="main-content">
        {loading ? (
          <div className="ve-page-loading">
            <Loader2 size={28} className="ve-spin ve-loading-icon" aria-hidden="true" />
            <span>Loading job…</span>
          </div>
        ) : error ? (
          <section className="ve-page">
            <div className="ve-empty-state ve-empty-large">
              <strong>{error}</strong>
              <button className="ve-primary-btn" type="button" onClick={() => navigate("/app/video/jobs")}>
                Back to My videos
              </button>
            </div>
          </section>
        ) : detail ? (
          <JobDetailView
            initialJob={detail.job}
            initialClips={detail.clips}
            sourceUrl={detail.job?.source_url}
          />
        ) : null}
      </main>
    </div>
  );
}
