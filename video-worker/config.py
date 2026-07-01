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
    use_mock_anthropic: bool = Field(default=True, alias="WORKER_USE_MOCK_ANTHROPIC")
    use_mock_replicate: bool = Field(default=True, alias="WORKER_USE_MOCK_REPLICATE")
    
    # Security
    webhook_secret: str = Field(..., alias="WORKER_WEBHOOK_SECRET")
    
    # Operational
    temp_dir: str = Field(default="/tmp/video-engine", alias="WORKER_TEMP_DIR")
    max_concurrent_jobs: int = Field(default=2, alias="WORKER_MAX_CONCURRENT_JOBS")
    poll_interval_seconds: int = Field(default=5, alias="WORKER_POLL_INTERVAL_SECONDS")
    stuck_job_threshold_minutes: int = Field(default=45, alias="WORKER_STUCK_JOB_THRESHOLD_MINUTES")
    port: int = Field(default=8001, alias="WORKER_PORT")
    log_level: str = Field(default="INFO", alias="WORKER_LOG_LEVEL")

    class Config:
        populate_by_name = True

# Singleton instance — imported by all other modules
config = WorkerConfig()
