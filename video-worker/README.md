# Video Engine Worker

Standalone Python service that processes video jobs for the repurposing engine.

## Local Development

1. Copy environment template:
   cp .env.template .env

2. Fill in .env values (Supabase service key, webhook secret, etc.)

3. Create and activate virtual environment:
   python3 -m venv venv
   source venv/bin/activate  # Mac/Linux

4. Install dependencies:
   pip install -r requirements.txt

5. Run the worker:
   python main.py

Worker runs on http://localhost:8001

Stage 3 requires FFmpeg and ffprobe on PATH before startup.

## Endpoints

- GET  /health              — Public health check
- GET  /status              — Authenticated status (requires X-Worker-Secret header)
- POST /webhook/job-submitted  — Called by Next.js after job creation
- POST /webhook/cancel-job     — Called by Next.js when user cancels

## Environment Variables

See .env.template for full documentation.

## Stage Status

- Stage 2: Worker skeleton ✅
- Stage 3: Download ✅
- Stage 4: Transcription ⏳
- Stage 5: LLM Analysis ⏳
- Stage 6: Render ⏳

See ../docs/video-engine/ for setup, mock-mode, and implementation notes.
