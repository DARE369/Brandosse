# video-worker/config.py
# Loads and validates all environment variables on startup.
# If a required variable is missing, the worker refuses to start.

import os
from pydantic_settings import BaseSettings
from pydantic import Field
from dotenv import load_dotenv

load_dotenv()

class WorkerConfig(BaseSettings):
    # Supabase
    supabase_url: str = Field(..., alias="WORKER_SUPABASE_URL")
    supabase_service_key: str = Field(..., alias="WORKER_SUPABASE_SERVICE_KEY")
    
    # External APIs (optional at this stage, validated in later stages)
    groq_api_key: str = Field(default="", alias="WORKER_GROQ_API_KEY")
    anthropic_api_key: str = Field(default="", alias="WORKER_ANTHROPIC_API_KEY")
    replicate_api_token: str = Field(default="", alias="WORKER_REPLICATE_API_TOKEN")
    # Google Fonts Developer API. Optional by design: without it the renderer
    # falls back to its default face and logs that brand typography was
    # requested but not applied. It is not required to boot.
    google_fonts_api_key: str = Field(default="", alias="WORKER_GOOGLE_FONTS_API_KEY")
    # Commit this image was built from. Baked in by the Dockerfile at build
    # time; "unknown" means a local build or a deploy that did not pass it.
    git_sha: str = Field(default="unknown", alias="WORKER_GIT_SHA")

    # Mock switches — MUST default to False (LOCK L1.4).
    # These previously defaulted to True, which meant any environment that
    # simply omitted the variable ran in mock mode: the worker produced
    # fabricated AI output (hardcoded clip scores and timestamps) while
    # reporting itself healthy. That is fail-open in the wrong direction — a
    # missing config value must never silently downgrade real AI to simulation.
    # Mock mode is now opt-in, for local development only.
    use_mock_anthropic: bool = Field(default=False, alias="WORKER_USE_MOCK_ANTHROPIC")
    use_mock_replicate: bool = Field(default=False, alias="WORKER_USE_MOCK_REPLICATE")
    
    # YouTube cookies (Netscape format) — paste content of cookies.txt exported
    # from a logged-in browser. Prevents bot detection on server IPs.
    youtube_cookies: str = Field(default="", alias="WORKER_YOUTUBE_COOKIES")

    # Security
    webhook_secret: str = Field(..., alias="WORKER_WEBHOOK_SECRET")
    
    # Operational
    temp_dir: str = Field(default="/tmp/video-engine", alias="WORKER_TEMP_DIR")
    max_concurrent_jobs: int = Field(default=2, alias="WORKER_MAX_CONCURRENT_JOBS")
    poll_interval_seconds: int = Field(default=5, alias="WORKER_POLL_INTERVAL_SECONDS")
    # 45 minutes was chosen when updated_at only moved on stage changes, so it
    # had to exceed the longest possible SILENT stage or it would reset healthy
    # jobs. process_job now heartbeats every 60s (job_runner._heartbeat), so a
    # job that has said nothing for 10 minutes genuinely has no worker behind it.
    # The cost of this number is how long a stranded job waits before rescue.
    stuck_job_threshold_minutes: int = Field(default=10, alias="WORKER_STUCK_JOB_THRESHOLD_MINUTES")
    # How often the reaper re-runs while the worker is up. Startup-only recovery
    # cannot rescue a job stranded by a machine stop whose restart happened
    # before the threshold elapsed — which is exactly what happened to job
    # 2cdf61cd on 2026-09-04.
    reaper_interval_seconds: int = Field(default=180, alias="WORKER_REAPER_INTERVAL_SECONDS")
    port: int = Field(default=8001, alias="WORKER_PORT")
    log_level: str = Field(default="INFO", alias="WORKER_LOG_LEVEL")

    class Config:
        populate_by_name = True

    def validate_runtime_credentials(self) -> None:
        """
        Fail fast at startup when a credential required by an ENABLED stage is
        missing (LOCK L1.4 / L0.6).

        Previously these keys were only checked at job runtime, so a worker with
        no Groq key would boot cleanly, accept jobs, and fail every one of them
        at stage 2 (transcription). The audit found exactly that state:
        WORKER_GROQ_API_KEY absent, so no job could ever complete.

        This mirrors the strictness already applied to supabase_url,
        supabase_service_key and webhook_secret, which are required fields —
        the pattern existed, it just was not applied to the API keys.
        """
        missing = []

        # Transcription (stages/transcribe.py) always runs and always needs Groq.
        if not self.groq_api_key:
            missing.append(
                "WORKER_GROQ_API_KEY — required by stages/transcribe.py; "
                "without it no job can progress past transcription"
            )

        # Clip analysis (stages/analyze.py) needs Anthropic unless mocked.
        if not self.use_mock_anthropic and not self.anthropic_api_key:
            missing.append(
                "WORKER_ANTHROPIC_API_KEY — required by stages/analyze.py "
                "when WORKER_USE_MOCK_ANTHROPIC is false"
            )

        # NOTE: WORKER_REPLICATE_API_TOKEN is deliberately NOT fatal. The audit
        # could not establish that any live worker stage calls Replicate (the
        # video path goes through fal.ai), so refusing to boot without it would
        # block startup on a credential that may not be needed. It is reported
        # as a warning below instead. Promote it to fatal if a Replicate-backed
        # stage is confirmed.

        if missing:
            raise RuntimeError(
                "Worker refusing to start — missing required credentials:\n  - "
                + "\n  - ".join(missing)
                + "\n\nSet them in the environment, or explicitly enable mock mode "
                  "for local development (WORKER_USE_MOCK_ANTHROPIC=true)."
            )

    def warn_on_degraded_config(self) -> list[str]:
        """
        Non-fatal warnings for configuration that does not stop the worker but
        is known to cause a high failure rate in production.
        """
        warnings = []

        # The audit found 10 of 15 lifetime jobs failed on YouTube bot
        # detection, which this variable exists specifically to mitigate.
        if not self.youtube_cookies:
            warnings.append(
                "WORKER_YOUTUBE_COOKIES is not set — YouTube ingestion will be "
                "blocked by bot detection on datacenter IPs for most videos."
            )

        if self.use_mock_anthropic:
            warnings.append(
                "WORKER_USE_MOCK_ANTHROPIC is TRUE — clip analysis will return "
                "FABRICATED scores and timestamps. Never enable this in production."
            )

        if not self.use_mock_replicate and not self.replicate_api_token:
            warnings.append(
                "WORKER_REPLICATE_API_TOKEN is not set — any Replicate-backed "
                "stage will fail at runtime. Non-fatal: no live worker stage is "
                "known to call Replicate."
            )

        return warnings


# Singleton instance — imported by all other modules
config = WorkerConfig()
