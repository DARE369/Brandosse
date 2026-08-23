import React, { useState } from "react";
import { Plus } from "lucide-react";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import JobCard from "./JobCard";
import { EmptyState, Button } from "../../ui-v2";
export default function JobsList({ initialJobs = [] }) {
  const { navigate } = useAppNavigation();
  const [jobs, setJobs] = useState(initialJobs);

  function handleDeleted(jobId) {
    setJobs((current) => current.filter((job) => job.id !== jobId));
  }

  if (jobs.length === 0) {
    return (
      <EmptyState
        dashed
        title="No videos yet"
        description="Give it a long video and it finds the moments worth clipping. Renders run in the background, so you can leave the page."
        actions={(
          <Button onClick={() => navigate("/app/video/new")}>
            <Plus size={15} aria-hidden="true" /> Process a video
          </Button>
        )}
      />
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
