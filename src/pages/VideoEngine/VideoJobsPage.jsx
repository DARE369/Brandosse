"use client";

import React from "react";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import JobsList from "../../components/video-engine/JobsList";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useAuth } from "../../Context/AuthContext";
import { fetchUserJobs } from "../../services/videoEngineData";
import { AppShell, EmptyState, Button } from "../../ui-v2";

export default function VideoJobsPage() {
  const { navigate } = useAppNavigation();
  const { user } = useAuth();
  const [jobs, setJobs] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  function loadJobs() {
    if (!user?.id) return;
    setLoading(true);
    setError("");

    fetchUserJobs(user.id)
      .then((data) => setJobs(data))
      .catch((loadError) => setError(loadError.message || "Failed to load your videos."))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    loadJobs();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppShell activeKey="video" mainClassName="ve-app-content">
        <section className="ve-page">
          <div className="ve-list-header">
            <div>
              <p className="ve-kicker">Video engine</p>
              <h1>My videos</h1>
              <p>Track active jobs and open completed clips.</p>
            </div>
            <button className="ve-primary-btn" type="button" onClick={() => navigate("/app/video/new")}>
              <Plus size={17} aria-hidden="true" />
              New video
            </button>
          </div>

          {loading ? (
            <div className="ve-page-loading">
              <Loader2 size={28} className="ve-spin ve-loading-icon" aria-hidden="true" />
              <span>Loading your videos…</span>
            </div>
          ) : error ? (
            <EmptyState
              title="Couldn't load your videos"
              description={`${error} Nothing has been lost — this is a loading problem, and your renders keep running.`}
              actions={<Button onClick={loadJobs}><RefreshCw size={15} aria-hidden="true" /> Try again</Button>}
            />
          ) : (
            <JobsList initialJobs={jobs} />
          )}
        </section>
    </AppShell>
  );
}
