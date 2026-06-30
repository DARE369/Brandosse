"use client";

import React from "react";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import UserNavbar from "../../components/User/UserNavbar";
import UserSidebar from "../../components/User/UserSidebar";
import JobsList from "../../components/video-engine/JobsList";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useAuth } from "../../Context/AuthContext";
import { fetchUserJobs } from "../../services/videoEngineData";

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
    <div className="dashboard-shell">
      <UserNavbar />
      <UserSidebar />
      <main className="dashboard-content ve-app-content" id="main-content">
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
            <div className="ve-empty-state ve-empty-large">
              <strong>{error}</strong>
              <button className="ve-secondary-btn ve-retry-btn" type="button" onClick={loadJobs}>
                <RefreshCw size={15} aria-hidden="true" />
                Try again
              </button>
            </div>
          ) : (
            <JobsList initialJobs={jobs} />
          )}
        </section>
      </main>
    </div>
  );
}
