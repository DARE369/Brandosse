// src/pages/VideoEngine/VideoEngineLab.jsx
import React from "react";
import {
  Activity,
  CheckCircle2,
  ClipboardList,
  Database,
  ExternalLink,
  FileText,
  Server,
  Terminal,
  XCircle,
} from "lucide-react";
const WORKER_HEALTH_URL = "http://localhost:8001/health";

const stageRows = [
  {
    label: "Stage 1",
    title: "Database foundation",
    status: "Implemented",
    detail: "Video tables, schema SQL, local scaffolding, and env templates are present.",
  },
  {
    label: "Stage 2",
    title: "Python worker skeleton",
    status: "Implemented",
    detail: "Worker service, poller, job runner, stage stubs, and FastAPI endpoints are present.",
  },
  {
    label: "Stage 3",
    title: "Download and audio extraction",
    status: "Implemented",
    detail: "yt-dlp download flow, FFmpeg utilities, credit deduction, and docs are present.",
  },
];

const readinessRows = [
  {
    label: "Python runtime",
    value: "Use Python 3.12 for the worker venv",
    state: "Manual",
  },
  {
    label: "Worker packages",
    value: "Run pip install -r requirements.txt inside video-worker",
    state: "Manual",
  },
  {
    label: "FFmpeg",
    value: "Install ffmpeg and ffprobe, then add them to PATH",
    state: "Manual",
  },
  {
    label: "Worker environment",
    value: "Create video-worker/.env with Supabase service role values",
    state: "Manual",
  },
  {
    label: "Supabase buckets",
    value: "Confirm private video-clips and video-source-cache buckets",
    state: "Manual",
  },
];

const docLinks = [
  {
    label: "Overview",
    path: "/docs/video-engine/README.md",
    description: "Stage status and documentation map.",
  },
  {
    label: "Setup",
    path: "/docs/video-engine/setup.md",
    description: "Local worker, FFmpeg, and Python 3.12 setup.",
  },
  {
    label: "API keys and mocks",
    path: "/docs/video-engine/api-keys-and-mocks.md",
    description: "Free tools, paid APIs, and mock-mode defaults.",
  },
  {
    label: "Stage 3 notes",
    path: "/docs/video-engine/stage-03-download-audio.md",
    description: "Download/audio pipeline and manual test checklist.",
  },
  {
    label: "Implementation log",
    path: "/docs/video-engine/implementation-log.md",
    description: "What changed, issues, and manual follow-up.",
  },
];

function StatusPill({ state }) {
  const normalized = state.toLowerCase();
  return <span className={`vel-pill vel-pill-${normalized}`}>{state}</span>;
}

export default function VideoEngineLab() {
  const [health, setHealth] = React.useState({
    status: "idle",
    message: "Worker health has not been checked yet.",
  });

  async function checkWorkerHealth() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2500);

    setHealth({
      status: "checking",
      message: "Checking worker health...",
    });

    try {
      const response = await fetch(WORKER_HEALTH_URL, {
        signal: controller.signal,
      });
      const data = await response.json();

      if (!response.ok) {
        setHealth({
          status: "offline",
          message: `Worker responded with ${response.status}.`,
        });
        return;
      }

      setHealth({
        status: data.status === "healthy" ? "online" : "offline",
        message: `${data.service || "worker"} is ${data.status || "reachable"}.`,
      });
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      setHealth({
        status: "offline",
        message: isAbort
          ? "Worker health check timed out."
          : "Worker is not reachable at localhost:8001.",
      });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  React.useEffect(() => {
    checkWorkerHealth();
  }, []);

  const healthIcon =
    health.status === "online" ? (
      <CheckCircle2 aria-hidden="true" />
    ) : health.status === "checking" ? (
      <Activity aria-hidden="true" />
    ) : (
      <XCircle aria-hidden="true" />
    );

  return (
    <main className="video-engine-lab">
      <section className="vel-header" aria-labelledby="video-engine-title">
        <div>
          <p className="vel-kicker">Isolated development route</p>
          <h1 id="video-engine-title">Video Engine Lab</h1>
          <p>
            A separate workspace for checking the video-engine build without
            entering the main protected app.
          </p>
        </div>
        <div className={`vel-health vel-health-${health.status}`} aria-live="polite">
          <span className="vel-health-icon">{healthIcon}</span>
          <div>
            <span>Worker Health</span>
            <strong>{health.message}</strong>
          </div>
          <button type="button" onClick={checkWorkerHealth}>
            Refresh
          </button>
        </div>
      </section>

      <section className="vel-grid" aria-label="Video engine status">
        <div className="vel-panel vel-panel-wide">
          <div className="vel-panel-heading">
            <Database aria-hidden="true" />
            <h2>Build Stages</h2>
          </div>
          <div className="vel-stage-list">
            {stageRows.map((stage) => (
              <article className="vel-stage-row" key={stage.label}>
                <span className="vel-stage-label">{stage.label}</span>
                <div>
                  <h3>{stage.title}</h3>
                  <p>{stage.detail}</p>
                </div>
                <StatusPill state={stage.status} />
              </article>
            ))}
          </div>
        </div>

        <div className="vel-panel">
          <div className="vel-panel-heading">
            <ClipboardList aria-hidden="true" />
            <h2>Readiness</h2>
          </div>
          <ul className="vel-check-list">
            {readinessRows.map((item) => (
              <li key={item.label}>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.value}</small>
                </span>
                <StatusPill state={item.state} />
              </li>
            ))}
          </ul>
        </div>

        <div className="vel-panel">
          <div className="vel-panel-heading">
            <Terminal aria-hidden="true" />
            <h2>Worker Status</h2>
          </div>
          <p className="vel-copy">
            Detailed status is protected by the worker secret. Use PowerShell or
            an API client so the secret stays local.
          </p>
          <pre className="vel-command">
            curl -H "X-Worker-Secret: &lt;secret&gt;" http://localhost:8001/status
          </pre>
        </div>

        <div className="vel-panel vel-panel-wide">
          <div className="vel-panel-heading">
            <FileText aria-hidden="true" />
            <h2>Documentation</h2>
          </div>
          <div className="vel-doc-grid">
            {docLinks.map((doc) => (
              <a className="vel-doc-link" href={doc.path} target="_blank" rel="noreferrer" key={doc.path}>
                <span>
                  <strong>{doc.label}</strong>
                  <small>{doc.description}</small>
                  <code>{doc.path}</code>
                </span>
                <ExternalLink aria-hidden="true" />
              </a>
            ))}
          </div>
        </div>

        <div className="vel-panel vel-panel-accent">
          <div className="vel-panel-heading">
            <Server aria-hidden="true" />
            <h2>Local URLs</h2>
          </div>
          <dl className="vel-url-list">
            <div>
              <dt>Frontend lab</dt>
              <dd>http://localhost:5173/video-engine</dd>
            </div>
            <div>
              <dt>Worker health</dt>
              <dd>http://localhost:8001/health</dd>
            </div>
            <div>
              <dt>Worker status</dt>
              <dd>http://localhost:8001/status</dd>
            </div>
          </dl>
        </div>
      </section>
    </main>
  );
}
