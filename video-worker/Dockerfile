# video-worker/Dockerfile
# Used for deployment in Stage 11.
# Not needed for local development.

FROM python:3.11-slim

WORKDIR /app

# ffmpeg  - rendering and audio extraction (stages/render.py, ffmpeg_utils.py)
# nodejs  - NOT optional. YouTube requires a JavaScript signature / "n parameter"
#           challenge to be solved before it releases format URLs, and yt-dlp
#           needs a JS runtime to do it. Without one, extraction returns
#           "Signature solving failed ... Only images are available for download",
#           and every job dies at the download stage reporting "Requested format
#           is not available" - which reads as a format-selector bug and is not.
#           Diagnosed on Fly 2026-08-22: cookies cleared bot detection, and every
#           video still failed until this was installed.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create temp directory
RUN mkdir -p /tmp/video-engine

EXPOSE 8001

CMD ["python", "main.py"]
