# video-worker/Dockerfile
# Used for deployment in Stage 11.
# Not needed for local development.

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies needed for later stages (ffmpeg, etc.)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create temp directory
RUN mkdir -p /tmp/video-engine

EXPOSE 8001

CMD ["python", "main.py"]
