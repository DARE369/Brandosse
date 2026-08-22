import React from "react";
import { useJobRealtime } from "../../hooks/video-engine/useJobRealtime";
import ClipsGallery from "./ClipsGallery";
import JobStatusPipeline from "./JobStatusPipeline";
import { EmptyState, Button } from "../../ui-v2";

const processingStatuses = new Set(["queued", "downloading", "transcribing", "analyzing", "rendering"]);

export default function JobDetailView({ initialJob, initialClips = [], sourceUrl }) {
  const { job, clips, isConnected } = useJobRealtime(initialJob.id, initialJob, initialClips);

  if (job.status === "complete") {
    return (
      <div style={{ height: "calc(100vh - 180px)", minHeight: 520 }}>
        <ClipsGallery clips={clips} jobTitle={job.source_title} jobId={job.id} />
      </div>
    );
  }

  if (processingStatuses.has(job.status) || job.status === "failed") {
    return (
      <JobStatusPipeline
        status={job.status}
        errorMessage={job.error_message}
        errorStage={job.error_stage}
        sourceTitle={job.source_title}
        sourceUrl={sourceUrl || job.source_url}
        isConnected={isConnected}
        downloadProgress={job.download_progress}
        clips={clips}
      />
    );
  }

  return (
    <section className="ve-page">
      <EmptyState
        title="Unknown job state"
        description="This job is in a state we don't have a screen for. Reloading usually resolves it — if not, the job list has the latest status."
        actions={<Button onClick={() => window.location.reload()}>Reload</Button>}
      />
    </section>
  );
}
