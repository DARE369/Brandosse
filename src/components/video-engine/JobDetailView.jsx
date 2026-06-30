import React from "react";
import { useJobRealtime } from "../../hooks/video-engine/useJobRealtime";
import ClipsGallery from "./ClipsGallery";
import JobStatusPipeline from "./JobStatusPipeline";

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
      <div className="ve-empty-state">
        <strong>Unknown job state</strong>
        <span>Refresh the page to check the latest status.</span>
      </div>
    </section>
  );
}
