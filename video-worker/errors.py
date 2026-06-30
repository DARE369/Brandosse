# video-worker/errors.py
# Custom exception classes for the video engine pipeline.
# Each exception maps to a specific failure mode.

class VideoEngineError(Exception):
    """Base exception for all video engine errors."""
    def __init__(
        self,
        message: str,
        stage: str,
        job_id: str,
        should_refund: bool = True,
        credits_to_refund: int = 0,
    ):
        super().__init__(message)
        self.message = message
        self.stage = stage
        self.job_id = job_id
        self.should_refund = should_refund
        self.credits_to_refund = credits_to_refund

class DownloadError(VideoEngineError):
    """Raised when video download fails."""
    def __init__(self, message: str, job_id: str, credits_to_refund: int = 0):
        super().__init__(
            message,
            "downloading",
            job_id,
            should_refund=True,
            credits_to_refund=credits_to_refund,
        )

class TranscriptionError(VideoEngineError):
    """Raised when WhisperX transcription fails."""
    def __init__(self, message: str, job_id: str):
        super().__init__(message, "transcribing", job_id, should_refund=True)

class AnalysisError(VideoEngineError):
    """Raised when LLM scoring fails."""
    def __init__(self, message: str, job_id: str):
        super().__init__(message, "analyzing", job_id, should_refund=True)

class RenderError(VideoEngineError):
    """Raised when FFmpeg rendering fails."""
    def __init__(self, message: str, job_id: str):
        super().__init__(message, "rendering", job_id, should_refund=False)

class ValidationError(VideoEngineError):
    """Raised when job data is invalid before processing starts."""
    def __init__(self, message: str, job_id: str):
        super().__init__(message, "validation", job_id, should_refund=True)

class StitchError(VideoEngineError):
    """Raised when FFmpeg concat or stitched upload fails."""
    def __init__(self, message: str, job_id: str):
        super().__init__(message, "stitching", job_id, should_refund=False)
