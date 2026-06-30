import React, { useState } from "react";
import { Plus, Video } from "lucide-react";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import JobCard from "./JobCard";
export default function JobsList({ initialJobs = [] }) {
  const { navigate } = useAppNavigation();
  const [jobs, setJobs] = useState(initialJobs);

  function handleDeleted(jobId) {
    setJobs((current) => current.filter((job) => job.id !== jobId));
  }

  if (jobs.length === 0) {
    return (
      <div className="ve-empty-state ve-empty-large">
        <Video size={36} aria-hidden="true" />
        <strong>You haven't processed any videos yet.</strong>
        <span>Submit your first video to get started.</span>
        <button className="ve-primary-btn" type="button" onClick={() => navigate("/app/video/new")}>
          <Plus size={17} aria-hidden="true" />
          Process a video
        </button>
      </div>
    );
  }

  return (
    <div className="ve-jobs-list">
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} onDeleted={handleDeleted} />
      ))}
    </div>
  );
}
