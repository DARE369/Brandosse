# video-worker/Dockerfile
# Used for deployment in Stage 11.
# Not needed for local development.

FROM python:3.11-slim

WORKDIR /app

# ffmpeg  - rendering and audio extraction (stages/render.py, ffmpeg_utils.py)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ffmpeg \
    curl \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Node 22, and it must be 22 or newer.
#
# YouTube will not release format URLs until a JavaScript signature / "n
# parameter" challenge is solved, and yt-dlp needs a JS runtime to solve it.
# yt-dlp/utils/_jsruntime.py pins NodeJsRuntime.MIN_SUPPORTED_VERSION = (22,0,0),
# so Debian's nodejs (v20) is detected and then rejected as unsupported — which
# surfaces only as `JS runtimes: none` and, downstream, as "Requested format is
# not available". Diagnosed on Fly 2026-08-22 by reading that source directly
# after v20 silently failed.
#
# Installed from the official tarball rather than apt because no Debian release
# ships 22 yet, and the version is the entire point.
ENV NODE_VERSION=22.14.0
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
        --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md \
    && rm /tmp/node.tar.xz \
    && node --version

# -- PO-token generator (BotGuard) -------------------------------------------
# YouTube flags datacenter IPs after a handful of requests and then withholds
# formats even from a client that solves the JS challenge. PO tokens are the
# attestation YouTube's own web client presents; minting them restores guest
# access from flagged IPs in most cases. This clones and builds the Node half
# of bgutil-ytdlp-pot-provider; the pip plugin in requirements.txt invokes
# build/generate_once.js per download ("script mode" - no extra daemon).
RUN git clone --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil \
    && cd /opt/bgutil/server \
    && npm install --no-audit --no-fund \
    && npx tsc \
    && test -f build/generate_once.js

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create temp directory
RUN mkdir -p /tmp/video-engine

EXPOSE 8001

CMD ["python", "main.py"]
