# Video Lab - Complete Technical Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Frontend System](#frontend-system)
4. [Backend System](#backend-system)
5. [Job Processing Pipeline](#job-processing-pipeline)
6. [Real-time Updates](#real-time-updates)
7. [API Endpoints](#api-endpoints)
8. [Data Models](#data-models)
9. [Error Handling](#error-handling)
10. [Complete Flow Walkthrough](#complete-flow-walkthrough)

---

## Overview

The Video Lab is a sophisticated video processing system that allows users to:
- Submit videos from YouTube, Twitter, or direct file uploads
- Automatically extract viral moments and create short-form clips
- Generate AI-powered titles and captions
- Process videos through a multi-stage pipeline (download → transcribe → analyze → render → deliver)

**Key Statistics:**
- Credit system: 1 credit per minute of source video (minimum 5 credits)
- Supported formats: MP4, WebM, MKV, AVI
- Maximum duration: 180 minutes (3 hours)
- Output: Vertical 9:16 clips with face detection and AI captions
- Realtime updates: Live job status via Supabase Realtime + polling fallback
- Processing concurrency: Up to 3 simultaneous jobs

---

## Architecture

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND (React)                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Pages: JobListPage, JobDetailView                    │  │
│  │ Components: SubmitForm, JobCard, JobStatusPipeline   │  │
│  │ Hooks: useJobRealtime (Realtime + Polling)           │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↑ ↓                                │
│                    Supabase Client                          │
└──────────────┬─────────────────────────────────────────────┘
               │
        ┌──────┴──────┐
        ↓             ↓
    ┌───────────┐  ┌─────────────────┐
    │ Supabase  │  │ Next.js API     │
    │ Database  │  │ Routes (/api)   │
    │           │  │                 │
    │ Tables:   │  │ - /video/jobs   │
    │ - jobs    │  │ - /video/clips  │
    │ - clips   │  │ - /video/delete │
    │ - videos  │  │ - /video/health │
    │ - storage │  └─────────────────┘
    └───────────┘       │
                        │ Webhooks
                        ↓
    ┌───────────────────────────────────┐
    │  Python FastAPI Worker (port 8001)│
    │  - Job Polling (every 5 seconds)  │
    │  - Pipeline Execution             │
    │  - Stage Processing               │
    └───────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ↓               ↓               ↓
    ┌─────────┐  ┌────────────┐  ┌──────────┐
    │ YouTube │  │ Supabase   │  │ Replicate│
    │ (yt-dlp)│  │ Storage    │  │ (AI APIs)│
    │         │  │ (video s3) │  │          │
    └─────────┘  └────────────┘  └──────────┘
```

### Technology Stack

**Frontend:**
- React 18 with Hooks
- Next.js 14+ (App Router)
- Supabase JS Client (realtime subscriptions)
- Lucide Icons
- CSS Modules

**Backend:**
- Python 3.14 FastAPI
- Supabase Python SDK
- yt-dlp (video download)
- FFmpeg (video processing)
- OpenCV (face detection)
- Replicate API (mocked for development)
- Anthropic Claude (text generation, mocked)
- structlog (structured logging)

**Infrastructure:**
- Supabase PostgreSQL (jobs, clips, transcripts, storage)
- Supabase Realtime (WebSocket subscriptions)
- Supabase Storage (S3 bucket for video clips)
- Next.js API Routes (webhooks, status checks)

---

## Frontend System

### Page Flow

```
/app/video/
├── page.jsx (redirect to /jobs)
├── jobs/
│   ├── page.jsx → JobListPage
│   │   ├── Fetches all jobs for user
│   │   ├── Shows list of JobCard components
│   │   └── Each card is clickable to view details
│   │
│   └── [id]/
│       └── page.jsx → JobDetailPage
│           ├── Fetches initial job + clips
│           ├── Renders JobDetailView
│           └── JobDetailView handles job status:
│               ├── "processing" → JobStatusPipeline
│               ├── "complete" → ClipsGallery
│               └── "failed" → Error state
│
└── new/
    └── page.jsx → SubmitFormPage
        ├── URL input with platform detection
        ├── File upload handler
        └── Submit button that creates job
```

### Key Components

#### 1. **SubmitForm** (`src/components/video-engine/SubmitForm.jsx`)

**Purpose:** Allow users to submit videos for processing

**Inputs:**
- URL field (YouTube, Twitter, or upload)
- Platform detection via regex matching
- Form validation

**Process:**
1. User enters URL or selects file
2. Platform is detected (youtube, twitter, upload)
3. Credits are shown (estimated from duration or file)
4. On submit: POST to `/api/video/jobs/create`
5. Backend creates job record in `video_jobs` table
6. Job starts in "queued" status
7. Redirect to job detail page

**Key State:**
```javascript
const [url, setUrl] = useState("");
const [platform, setPlatform] = useState(null);
const [file, setFile] = useState(null);
const [isSubmitting, setIsSubmitting] = useState(false);
```

**Worker Health Check:**
- Calls `/api/video/health` to check if worker is online
- Shows warning if worker is unhealthy

#### 2. **JobListPage** (`src/pages/video/jobs/page.jsx`)

**Purpose:** Display all jobs for the current user

**Displays:**
- List of JobCard components
- Job title, status, date, clip count, duration
- Delete button for each job
- Real-time status updates

**Key Data Flow:**
1. Fetch initial jobs: `useEffect` → GET `/api/video/jobs`
2. Subscribe to job changes via `useJobRealtime`
3. Auto-refresh every 3 seconds as fallback
4. Show delete confirmation modal

#### 3. **JobCard** (`src/components/video-engine/JobCard.jsx`)

**Purpose:** Render individual job in list view

**Displays:**
- Video title or "Processing…" if no title yet
- Status badge with live dot indicator
- Metadata: date, clip count, duration
- Delete button with confirmation

**Key Features:**
- Can delete jobs in ANY status (queued, processing, complete, failed)
- Shows delete error if API fails
- Animated loading spinner for active jobs
- Click to navigate to detail page

#### 4. **JobStatusPipeline** (`src/components/video-engine/JobStatusPipeline.jsx`)

**Purpose:** Show real-time progress as job processes through stages

**Displays:**
- Linear pipeline: Queue → Download → Transcribe → Analyze → Render → Complete
- Current stage with animated spinner
- Completed stages with checkmarks
- Failed stage with X icon
- Error message if job failed
- Back button and retry button

**Key Features:**
- **Download Progress Indicator:**
  - Shows pulsing progress bar only during download stage
  - Message: "Downloading video file..."
  - Helps users know something is happening
  
- **Elapsed Time:**
  - Shows how long current stage has been active
  - Format: "5m 23s elapsed"
  - Only for downloading/transcribing/analyzing (not queued/rendering)

- **Live Updates:**
  - Receives status changes from `useJobRealtime` hook
  - Re-renders when job.status changes
  - Shows real-time progression

- **Error Display:**
  - Red error panel with detailed error message
  - Credit refund notice
  - "Try again" button to resubmit

#### 5. **ClipsGallery** (`src/components/video-engine/ClipsGallery.jsx`)

**Purpose:** Display final rendered clips after job completes

**Displays:**
- Grid of clip cards
- Each clip shows:
  - Thumbnail image
  - Title and caption
  - Scores (hook, content, overall)
  - Platform tags (Instagram Reels, TikTok Shorts, YouTube Shorts)
  - Video preview
  - Download button

**Key Feature:**
- Generates signed URLs for clips (48-hour expiry)
- Shows public_url if available
- Falls back to storage_path if URL needs renewal

### Hooks

#### **useJobRealtime** (`src/hooks/video-engine/useJobRealtime.js`)

**Purpose:** Subscribe to real-time job and clip updates

**Implementation:**
1. **Realtime Channel Subscription:**
   - Subscribes to `video_jobs` table UPDATE events
   - Subscribes to `video_clips` table INSERT and UPDATE events
   - Uses Supabase Realtime (WebSocket)
   - Filters by job ID

2. **Polling Fallback:**
   - Polls job and clips every 3 seconds
   - Ensures UI updates even if Realtime drops
   - Makes direct SQL query to Supabase

3. **State Management:**
   - `job`: Current job record (status, error_message, error_stage, etc.)
   - `clips`: Array of clip records for this job
   - `isConnected`: Boolean indicating Realtime connection status

**Return Value:**
```javascript
{
  job: { id, status, source_title, error_message, ... },
  clips: [{ id, clip_index, ai_title, ai_caption, overall_score, ... }],
  isConnected: boolean
}
```

**Key Logic:**
- Updates stop when job reaches "complete" or "failed"
- Clips are sorted by overall_score (descending)
- Deduplicates INSERT events (checks if clip ID already exists)

#### **useWorkerHealth** (`src/hooks/video-engine/useWorkerHealth.js`)

**Purpose:** Check if Python worker is online

**Implementation:**
- Polls `/api/video/health` every 30 seconds
- Returns: "healthy", "unhealthy", or "unknown"
- Used to show warning banner in SubmitForm

---

## Backend System

### API Routes

#### **POST /api/video/jobs/create**

**Purpose:** Create a new video processing job

**Request Body:**
```json
{
  "sourceUrl": "https://www.youtube.com/watch?v=...",
  "platform": "youtube" | "twitter" | "upload"
}
```

**Process:**
1. Authenticate user (from auth context)
2. Validate platform and URL format
3. Check user has credits (estimated: 5 minimum)
4. Create record in `video_jobs` table:
   - status: "queued"
   - source_url: user's input
   - source_platform: detected platform
   - user_id: current user ID
   - created_at: timestamp
5. Trigger webhook to Python worker
6. Return job ID + details

**Response:**
```json
{
  "success": true,
  "job": {
    "id": "uuid",
    "status": "queued",
    "source_url": "...",
    "source_platform": "youtube"
  }
}
```

**Errors:**
- 401: Not authenticated
- 400: Invalid URL or platform
- 400: Insufficient credits
- 500: Database error

#### **GET /api/video/jobs**

**Purpose:** List all jobs for current user

**Query Parameters:**
- None (fetches all jobs)

**Process:**
1. Authenticate user
2. Query `video_jobs` table filtered by user_id
3. Order by created_at DESC (newest first)
4. Include clip_count (aggregate of video_clips)

**Response:**
```json
{
  "jobs": [
    {
      "id": "uuid",
      "status": "complete",
      "source_title": "My Video",
      "created_at": "2026-06-13T10:25:31.000Z",
      "clip_count": 3,
      "source_duration_secs": 677
    },
    ...
  ]
}
```

#### **GET /api/video/jobs/[id]**

**Purpose:** Fetch single job with all its clips

**Process:**
1. Authenticate user
2. Verify job belongs to user (user_id check)
3. Fetch job + nested clips in single query
4. Generate signed URLs for clip storage paths (48-hour expiry)
5. Return with public_url populated

**Response:**
```json
{
  "job": {
    "id": "uuid",
    "status": "complete",
    "source_title": "...",
    "source_url": "...",
    "error_message": null,
    "error_stage": null,
    "clips": [
      {
        "id": "uuid",
        "clip_index": 0,
        "ai_title": "Generated Title",
        "ai_caption": "Generated Caption",
        "hook_score": 0.85,
        "content_score": 0.92,
        "overall_score": 0.88,
        "start_time_secs": 0,
        "end_time_secs": 60,
        "storage_path": "29944d39.../clip_0.mp4",
        "public_url": "https://signed-url...",
        "render_status": "complete"
      },
      ...
    ]
  }
}
```

#### **DELETE /api/video/jobs/[id]**

**Purpose:** Delete a job and all its clips

**Process:**
1. Authenticate user
2. Verify job belongs to user
3. If job is in any ACTIVE_STATUSES (queued, downloading, transcribing, analyzing, rendering):
   - Notify worker to cancel job via `notifyJobCancelled()`
4. Delete all clips from Supabase Storage (`video-clips` bucket)
5. Delete clip records from `video_clips` table
6. Delete job record from `video_jobs` table
7. Credits are automatically refunded by worker when job is cancelled

**Response:**
```json
{
  "success": true,
  "deleted_job_id": "uuid"
}
```

**Errors:**
- 404: Job not found or doesn't belong to user
- 500: Storage cleanup failed (still deletes DB records)

#### **GET /api/video/health**

**Purpose:** Health check for Python worker

**Process:**
1. Call `checkWorkerHealth()` from worker-client
2. This makes a request to `http://localhost:8001/health`
3. Returns worker status

**Response:**
```json
{
  "healthy": true,
  "timestamp": "2026-06-13T10:30:00Z"
}
```

**HTTP Status:**
- 200: Healthy
- 503: Unhealthy/offline

---

## Backend: Python Worker

### Worker Architecture

**File Structure:**
```
video-worker/
├── main.py                 # FastAPI app, webhook receiver
├── config.py               # Environment variables + settings
├── database.py             # Supabase operations (jobs, progress)
├── job_runner.py           # Main job orchestration
├── stages/
│   ├── download.py         # Stage 1: Download video from YouTube/Twitter
│   ├── transcribe.py       # Stage 2: Transcribe audio to text
│   ├── analyze.py          # Stage 3: Identify viral moments, score clips
│   ├── render.py           # Stage 4: Generate final vertical MP4 files
│   └── complete.py         # Stage 5: Finalize and upload
├── utils/
│   ├── ffmpeg_utils.py     # FFmpeg wrapper for video processing
│   ├── url_validator.py    # URL format validation
│   └── ...
├── venv/                   # Python virtual environment
├── requirements.txt        # Python dependencies
└── .env                    # Secrets (SUPABASE_URL, API keys)
```

### Job Polling System

**How it Works:**

1. **Poller runs on schedule (every 5 seconds):**
   ```python
   # In main.py
   poller_task = asyncio.create_task(job_poller())
   
   async def job_poller():
       while True:
           jobs = await query_queued_jobs()  # SQL query
           for job in jobs:
               if can_claim_job(job):
                   claim_job(job)
                   await run_pipeline(job)
           await asyncio.sleep(5)
   ```

2. **Job Claims (max 3 concurrent):**
   - Update job status: "queued" → "downloading"
   - Lock prevents duplicate processing
   - Claim fails if job already claimed

3. **Concurrent Processing:**
   - Up to 3 jobs can be processing simultaneously
   - Each in separate async task
   - Semaphore controls max_concurrent = 3

### Environment Configuration

**`.env` file (video-worker/):**
```bash
# Supabase
WORKER_SUPABASE_URL=https://ujkuwemwlhilzarbrozu.supabase.co
WORKER_SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# API Keys
WORKER_ANTHROPIC_API_KEY=sk-ant-...
WORKER_REPLICATE_API_KEY=...

# Webhook Secret (for verifying requests from Next.js)
WORKER_WEBHOOK_SECRET=d1ae45e2feb84565bb630e65a42670b0

# Mock Mode (for development)
WORKER_USE_MOCK_ANTHROPIC=true
WORKER_USE_MOCK_REPLICATE=true

# FFmpeg & System
WORKER_FFMPEG_PATH=ffmpeg
WORKER_TEMP_DIR=C:/tmp/video-engine

# Logging
WORKER_LOG_LEVEL=info
```

### Key Configuration

**yt-dlp Options** (video-worker/stages/download.py):
```python
YTDLP_BASE_OPTIONS = {
    'format': (
        'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]'
        '/bestvideo[height<=1080]+bestaudio'
        '/best[height<=1080]'
        '/best'
    ),
    'no_playlist': True,           # Only download single video
    'socket_timeout': 30,          # Connection timeout
    'retries': 3,                  # Retry failed downloads 3x
    'fragment_retries': 3,         # Retry fragments 3x
    'quiet': True,                 # Less verbose output
    'no_warnings': False,          # Show warnings
    'extract_flat': False,         # Don't extract playlist
    'merge_output_format': 'mp4',  # Merge to MP4
}
```

**Important:** `max_downloads` was REMOVED because:
- yt-dlp downloads video and audio separately, then merges
- `max_downloads: 1` would trigger after 1st file, blocking audio download
- `no_playlist: True` already prevents playlists

---

## Job Processing Pipeline

### Pipeline Stages

```
┌─────────────────────────────────────────────────────────────┐
│ STAGE 1: DOWNLOAD (video-worker/stages/download.py)        │
├─────────────────────────────────────────────────────────────┤
│ Input:  video URL (YouTube, Twitter) or file upload        │
│ Process:                                                    │
│  1. Validate URL format for platform                        │
│  2. Preflight check (metadata, duration, availability)     │
│  3. Validate duration ≤ 180 minutes                         │
│  4. Calculate credits needed (1 credit/min, min 5)         │
│  5. Deduct credits from user account                        │
│  6. Download full video with yt-dlp                         │
│  7. Extract 16kHz mono WAV audio for transcription         │
│ Output: video_path (MP4), audio_path (WAV)                 │
│ Duration: 10-30 seconds (network dependent)                │
│ Errors: Invalid URL, private video, age restriction, geo   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 2: TRANSCRIBE (video-worker/stages/transcribe.py)    │
├─────────────────────────────────────────────────────────────┤
│ Input:  audio_path (WAV)                                   │
│ Process:                                                    │
│  1. Validate audio file exists and has content              │
│  2. Call WhisperX (mocked in dev) for transcription        │
│  3. WhisperX returns: word segments with timestamps        │
│  4. Parse segments: speaker labels, timing, text           │
│  5. Store in video_transcripts table                        │
│  6. Detect language (from WhisperX response)               │
│ Output: transcript object with word_segments array         │
│         [{ word, start, end, speaker }, ...]               │
│ Duration: 30-60 seconds (depends on audio length)          │
│ Errors: Audio invalid, WhisperX API fail                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 3: ANALYZE (video-worker/stages/analyze.py)          │
├─────────────────────────────────────────────────────────────┤
│ Input:  transcript, source_title                           │
│ Process:                                                    │
│  1. Call Claude to identify viral moments                  │
│  2. Claude analyzes: hook strength, content quality        │
│  3. Claude returns: list of clips with timing + scores     │
│  4. Score scale: 0-1 (0=not viral, 1=highly viral)        │
│  5. Filter out low-scoring clips                           │
│  6. Select final clips (typically 3-5)                     │
│  7. Create video_clips records in DB                        │
│ Output: List of clips with:                                │
│         - clip_index, start_time_secs, end_time_secs      │
│         - ai_title, ai_caption                             │
│         - hook_score, content_score, overall_score         │
│ Duration: 5-15 seconds (API call + parsing)               │
│ Errors: Claude API fail, invalid response                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 4: RENDER (video-worker/stages/render.py)            │
├─────────────────────────────────────────────────────────────┤
│ Input:  video_path (MP4), clips array, transcript          │
│ Process (for each clip):                                   │
│  1. Extract clip timing (start, end seconds)               │
│  2. Run face detection (OpenCV) to find center of face     │
│  3. Calculate 9:16 crop coordinates:                       │
│     - If face detected: center crop on face center         │
│     - If no face: center crop of video                     │
│  4. Generate captions (ASS format with styling)            │
│  5. Run FFmpeg to crop + embed captions + render MP4       │
│  6. Output: vertical clip_X_final.mp4 (9:16 aspect)       │
│  7. Upload to Supabase Storage (video-clips bucket)       │
│  8. Create signed URL (48-hour expiry) for frontend       │
│ Output: List of clip MP4 files in cloud storage           │
│ Duration: 2-5 minutes (FFmpeg rendering is slow)          │
│ Errors: Face detection fail, FFmpeg error, storage fail   │
│ Partial Success: If 1+ clips fail, job completes with     │
│                  successful clips (partial_render_success) │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 5: COMPLETE (job_runner.py)                          │
├─────────────────────────────────────────────────────────────┤
│ Input:  completed clips, job record                         │
│ Process:                                                    │
│  1. Update job.status = "complete"                          │
│  2. Update job.completed_at = now                           │
│  3. Clean temporary files (video, audio, crops)            │
│  4. Release job slot (max_concurrent decremented)          │
│ Output: Job marked complete in database                     │
│ Duration: 1-2 seconds                                      │
└─────────────────────────────────────────────────────────────┘
```

### Error Handling & Partial Success

**Error Path:**

If ANY stage fails:
1. Error is caught in `process_job()` 
2. If credits were deducted, they're refunded
3. Job status → "failed"
4. error_message → user-friendly error text
5. error_stage → which stage failed (e.g., "download")
6. Frontend displays error with retry option

**Partial Success Path:**

If rendering some clips fails:
1. Successful clips are uploaded
2. Failed clips are marked as render_status="failed"
3. Job still completes (with warning)
4. User sees 2/3 clips instead of error
5. Prevents wasting earlier processing stages

---

## Real-time Updates

### How Live Updates Work

**Flow:**

1. **User views job detail page**
   - Page calls `GET /api/video/jobs/[id]`
   - Returns initial job + clips data
   - Creates JobDetailView component

2. **React Hook Subscribes (useJobRealtime)**
   - Creates Supabase channel: `video-engine-job-{jobId}`
   - Subscribes to `video_jobs` UPDATE events (filtered by jobId)
   - Subscribes to `video_clips` INSERT and UPDATE events (filtered by jobId)
   - Sets up polling fallback (every 3 seconds)

3. **Worker Updates Database**
   - When stage completes, worker calls:
     ```python
     await supabase.table('video_jobs').update({
         'status': 'transcribing'
     }).eq('id', job_id).execute()
     ```
   - This triggers a postgres_change event

4. **Supabase Realtime Delivers Update**
   - WebSocket sends payload to connected clients
   - Hook receives: `{ new: { id, status: 'transcribing', ... } }`
   - Calls `setJob(payload.new)`
   - React re-renders with new status

5. **UI Updates**
   - JobStatusPipeline receives new status
   - Next stage icon changes to active (spinner)
   - Previous stage shows checkmark
   - Elapsed time counter updates

### Realtime Connection Failure Recovery

**Problem:** If WebSocket drops (network hiccup, server restart):
- Realtime updates stop arriving
- UI freezes on old status
- User doesn't see progress

**Solution Implemented:**

1. **Polling Fallback:**
   - Every 3 seconds, hook polls the DB directly
   - Makes SQL query: `SELECT * FROM video_jobs WHERE id = ?`
   - Updates state if data changed
   - Ensures UI never gets stuck

2. **Connection Status Indicator:**
   - `isConnected` state tracks Realtime connection
   - If false, shows "Reconnecting…" banner
   - Polling continues regardless

3. **Stop on Terminal States:**
   - Polling stops when job reaches "complete" or "failed"
   - Avoids unnecessary queries once done

**Code:**
```javascript
// From useJobRealtime.js
useEffect(() => {
  // Polling every 3 seconds (always on, not just as fallback)
  const pollIntervalRef = setInterval(async () => {
    const { data } = await supabase
      .from("video_jobs")
      .select("*")
      .eq("id", jobId)
      .single();
    
    if (data) setJob(data);  // Update if changed
  }, 3000);
  
  return () => clearInterval(pollIntervalRef);
}, [jobId]);
```

---

## Data Models

### Database Schema

#### **video_jobs Table**

```sql
CREATE TABLE video_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Input
  source_url TEXT NOT NULL,
  source_platform VARCHAR(20),  -- 'youtube', 'twitter', 'upload'
  
  -- Status
  status VARCHAR(20) DEFAULT 'queued',
    -- 'queued' → job waiting for worker
    -- 'downloading' → downloading video
    -- 'transcribing' → extracting text
    -- 'analyzing' → finding viral moments
    -- 'rendering' → creating clips
    -- 'complete' → done, clips ready
    -- 'failed' → error occurred
  
  -- Job Metadata
  source_title TEXT,            -- Title of video (filled after download)
  source_duration_secs INT,     -- Duration in seconds (filled after download)
  credits_consumed INT,         -- Credits deducted from user
  
  -- Error Tracking
  error_message TEXT,           -- Human-readable error
  error_stage VARCHAR(20),      -- Which stage failed
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Aggregate (denormalized)
  clip_count INT GENERATED ALWAYS AS (
    SELECT COUNT(*) FROM video_clips WHERE job_id = video_jobs.id
  ) STORED
);

CREATE INDEX idx_jobs_user_created 
  ON video_jobs(user_id, created_at DESC);
CREATE INDEX idx_jobs_status 
  ON video_jobs(status);
```

#### **video_clips Table**

```sql
CREATE TABLE video_clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES video_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Clip Content
  clip_index INT,               -- 0, 1, 2, etc.
  start_time_secs FLOAT,        -- Where in source video clip starts
  end_time_secs FLOAT,          -- Where in source video clip ends
  duration_secs FLOAT,          -- Calculated: end - start
  
  -- AI Generated
  ai_title TEXT,                -- Generated title
  ai_caption TEXT,              -- Generated caption for display
  transcript_excerpt TEXT,      -- Text from this time range
  
  -- Scoring (0-1 scale)
  hook_score FLOAT,             -- How catchy/compelling opening is
  content_score FLOAT,          -- How valuable content is
  overall_score FLOAT,          -- Combined score
  
  -- Platform Target
  platform_target VARCHAR(20),  -- 'shorts', 'reels', 'tiktok', 'universal'
  
  -- Storage & Delivery
  storage_path TEXT,            -- Path in Supabase Storage bucket
  public_url TEXT,              -- Signed URL (48-hour expiry)
  thumbnail_path TEXT,          -- Thumbnail image path
  thumbnail_url TEXT,           -- Thumbnail signed URL
  
  -- Rendering Status
  render_status VARCHAR(20) DEFAULT 'pending',
    -- 'pending' → not yet rendered
    -- 'rendering' → in progress
    -- 'complete' → successfully rendered
    -- 'failed' → rendering error
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(job_id, clip_index)
);

CREATE INDEX idx_clips_job ON video_clips(job_id);
```

#### **video_transcripts Table**

```sql
CREATE TABLE video_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES video_jobs(id) ON DELETE CASCADE,
  
  -- Transcript Data
  language VARCHAR(10),         -- 'en', 'es', etc.
  full_text TEXT,              -- Complete transcript
  
  -- Word-level Segments (for timing captions)
  word_segments JSONB,         -- Array of:
    -- [{
    --   "word": "hello",
    --   "start": 0.5,
    --   "end": 0.8,
    --   "speaker": "SPEAKER_00"
    -- }, ...]
  
  -- Metadata
  total_speakers INT,
  hallucination_warning BOOLEAN,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(job_id)
);
```

#### **user_credits Table**

```sql
CREATE TABLE user_credits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  balance INT DEFAULT 0,        -- Current available credits
  lifetime_consumed INT DEFAULT 0,  -- Total used ever
  
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### **credit_transactions Table**

```sql
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  job_id UUID REFERENCES video_jobs(id),
  
  type VARCHAR(20),             -- 'debit' (job) or 'credit' (refund)
  amount INT,
  reason TEXT,                  -- 'job_download', 'job_refund', etc.
  
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Key Field Explanations

**status (video_jobs):**
- Frontend shows different UI based on status
- Backend moves through stages: queued → downloading → transcribing → analyzing → rendering → complete
- If error at any stage: failed

**overall_score (video_clips):**
- Range: 0 to 1
- 0.0 = not viral at all
- 0.5 = moderately interesting
- 0.9+ = highly viral
- Used for sorting clips (highest first in UI)

**storage_path & public_url:**
- storage_path = raw path in bucket (e.g., "user-id/job-id/clip_0.mp4")
- public_url = signed URL generated on-demand
- Signed URLs expire after 48 hours
- Frontend regenerates when needed

**platform_target:**
- 'shorts' = YouTube Shorts (9:16)
- 'reels' = Instagram Reels (9:16)
- 'tiktok' = TikTok native (9:16)
- 'universal' = works on all platforms (9:16)

---

## Error Handling

### Error Categories

#### **1. Download Stage Errors**

| Error | Cause | User Message | Refund? |
|-------|-------|--------------|---------|
| Invalid URL | URL doesn't match platform | "Invalid URL for this platform" | Yes |
| Private video | Video owner disabled sharing | "This video is private and cannot be accessed" | Yes |
| Video unavailable | Video deleted | "This video is unavailable. It may have been deleted" | Yes |
| Age restricted | Mature content | "This video is age-restricted" | Yes |
| Copyright blocked | Copyright claim | "This video has been blocked due to copyright" | Yes |
| Geo-blocked | Not available in region | "This video is not available in the server's region" | Yes |
| Network timeout | Download took too long | "Download failed: timeout after 3 retries" | Yes |
| Insufficient credits | User doesn't have enough | "Insufficient credits. Need X, you have Y" | Yes |

#### **2. Transcription Errors**

| Error | Cause | Recovery |
|-------|-------|----------|
| Audio invalid | WAV extraction failed | Show error, refund credits |
| API timeout | WhisperX unresponsive | Retry 3x, then error |
| Language detection fail | Can't detect language | Assume English, continue |

#### **3. Analysis Errors**

| Error | Cause | Recovery |
|-------|-------|----------|
| Claude API fail | API call rejected | Retry 3x, then error |
| Invalid clip selection | Claude returned bad data | Error, refund all |
| No clips found | No viral moments detected | Complete with 0 clips |

#### **4. Rendering Errors**

| Error | Cause | Recovery |
|-------|-------|----------|
| Face detection fail | OpenCV error | Fall back to center crop |
| FFmpeg error | Encoding failed | Mark individual clip as failed |
| Storage upload fail | Network/bucket error | Retry 3x, then mark failed |
| **Partial success** | Some clips fail | **Complete job with successful clips only** |

### Error Recovery Strategies

**Strategy 1: Retry with Backoff**
```python
for attempt in range(3):
    try:
        result = api_call()
        return result
    except Exception as e:
        if attempt < 2:
            await asyncio.sleep(0.5 * (attempt + 1))  # 0.5s, 1s, 1.5s
        else:
            raise
```

**Strategy 2: Partial Completion**
```python
# In render stage
results = []
for clip in clips:
    try:
        render_clip(clip)
        results.append({'status': 'ok'})
    except RenderError:
        results.append({'status': 'failed'})

if any(r['status'] == 'ok' for r in results):
    log.warning('partial_render_success')
    return  # Job completes anyway
else:
    raise RenderError('All clips failed')
```

**Strategy 3: Credit Refunds**
```python
try:
    await run_download(job)
except DownloadError as e:
    if credits_were_deducted:
        e.credits_to_refund = job.credits_consumed
    raise
```

---

## Complete Flow Walkthrough

### Example: User submits YouTube video, full end-to-end

#### **Time T=0:00 - Frontend: User submits URL**

```javascript
// SubmitForm.jsx
handleSubmit() {
  // User enters: https://www.youtube.com/watch?v=xyz
  const platform = detectPlatform(url);  // → "youtube"
  
  const response = await fetch('/api/video/jobs/create', {
    method: 'POST',
    body: JSON.stringify({
      sourceUrl: url,
      platform: 'youtube'
    })
  });
  
  const { job } = response.json();
  navigate(`/app/video/jobs/${job.id}`);
}
```

#### **T=0:05 - Backend: API creates job record**

```python
# Next.js API: POST /api/video/jobs/create
# 1. Create row in video_jobs table
job = {
  id: 'abc123',
  user_id: 'user789',
  source_url: 'https://www.youtube.com/watch?v=xyz',
  source_platform: 'youtube',
  status: 'queued',
  created_at: now()
}
await db.insert('video_jobs', job)

# 2. Trigger webhook (POST to Python worker)
await webhook_service.notify_job_submitted(job.id)

# 3. Return to frontend
return { job }
```

#### **T=0:05 - Frontend: Redirect to job detail page**

```javascript
// GET /app/video/jobs/abc123
// 1. Fetch initial job data
const { job, clips } = await fetch('/api/video/jobs/abc123')
// job.status = 'queued'
// clips = []

// 2. Render JobDetailView
// 3. useJobRealtime hook subscribes to updates
//    - Supabase Realtime channel opens
//    - Polling starts (every 3 seconds)

// 4. Shows JobStatusPipeline with "In Queue" stage
```

#### **T=0:10 - Worker: Poller picks up job**

```python
# In main.py, job_poller() runs every 5 seconds:
# 1. Query queued jobs
jobs = await db.query(
  "SELECT * FROM video_jobs WHERE status='queued' ORDER BY created_at"
)

# 2. Try to claim job (update status atomically)
result = await db.update_job_status(job.id, 'queued', 'downloading')
# If result.rowcount == 0: job already claimed, skip

# 3. If claimed successfully:
await process_job(job)
```

#### **T=0:12 - Worker Stage 1: DOWNLOAD**

```python
# In stages/download.py
async def run_download(job):
  log.info('download_start', job_id=job.id, url=job.source_url)
  
  # 1. Preflight metadata check (no download yet)
  metadata = await _get_video_metadata(url)  # yt-dlp with skip_download
  # Returns: { title: "...", duration: 851 }
  
  # 2. Validate duration
  if metadata['duration'] > 180 * 60:
    raise DownloadError('Video too long')
  
  # 3. Calculate credits
  credits_needed = ceil(metadata['duration'] / 60)  # min 5
  
  # 4. Deduct credits
  success = deduct_credits(job.user_id, credits_needed)
  if not success:
    raise DownloadError('Insufficient credits')
  
  # 5. Full video download with yt-dlp
  # (Downloads video + audio separately, merges to MP4)
  video_path = await _download_with_ytdlp(url)
  
  # 6. Extract audio
  audio_path = extract_audio_for_transcription(video_path)
  
  # 7. Update job
  await db.update_job({
    id: job.id,
    status: 'transcribing',  # Move to next stage
    source_title: metadata['title'],
    source_duration_secs: metadata['duration'],
    credits_consumed: credits_needed
  })
  
  log.info('stage_complete', stage='download', job_id=job.id)
  
  return { video_path, audio_path, title, duration, credits }
```

**Status in DB now:** "transcribing"

**Frontend sees:** (via Realtime or polling after 3 seconds)
- Stage 1 "In Queue" → checkmark ✅
- Stage 2 "Downloading" → spinner (active)

#### **T=0:25 - Worker Stage 2: TRANSCRIBE**

```python
# In stages/transcribe.py
async def run_transcribe(job, audio_path):
  log.info('transcription_start', job_id=job.id)
  
  # 1. Validate audio file
  if not file_exists(audio_path):
    raise TranscribeError('Audio not found')
  
  # 2. Call WhisperX (mocked for dev)
  transcript = await call_whisper_x(audio_path)
  
  # In MOCK mode:
  transcript = {
    language: 'en',
    word_segments: [
      { word: 'hello', start: 0.5, end: 0.8, speaker: 'SPEAKER_00' },
      { word: 'world', start: 1.0, end: 1.3, speaker: 'SPEAKER_00' },
      ...
    ],
    total_speakers: 2,
    hallucination_warning: False
  }
  
  # 3. Store transcript
  await db.insert('video_transcripts', {
    job_id: job.id,
    language: transcript['language'],
    word_segments: transcript['word_segments'],
    ...
  })
  
  # 4. Update job to next stage
  await db.update_job(id=job.id, status='analyzing')
  
  log.info('stage_complete', stage='transcribe', job_id=job.id)
  
  return transcript
```

**Status in DB now:** "analyzing"

**Frontend sees:**
- Stage 2 "Downloading" → checkmark ✅
- Stage 3 "Transcribing" → spinner

#### **T=0:40 - Worker Stage 3: ANALYZE**

```python
# In stages/analyze.py
async def run_analyze(job, transcript, title):
  log.info('analysis_start', job_id=job.id)
  
  # 1. Prepare prompt for Claude
  prompt = f"""
  Video: {title}
  Transcript: {transcript.full_text}
  
  Identify viral moments (hooks, surprises, valuable tips).
  Return JSON with clips: [{{ 
    start_secs, end_secs, title, caption, 
    hook_score (0-1), content_score (0-1)
  }}]
  """
  
  # 2. Call Claude (mocked for dev)
  response = await call_claude(prompt)
  
  # In MOCK mode, returns:
  clips_analysis = [
    {
      start_secs: 0,
      end_secs: 60,
      title: "Intro Hook",
      caption: "Engaging start",
      hook_score: 0.85,
      content_score: 0.92,
      overall_score: 0.88
    },
    {
      start_secs: 90,
      end_secs: 150,
      title: "Main Point",
      ...
    },
    ...
  ]
  
  # 3. Create clip records
  for clip in clips_analysis:
    await db.insert('video_clips', {
      job_id: job.id,
      clip_index: clips_analysis.index(clip),
      start_time_secs: clip['start_secs'],
      end_time_secs: clip['end_secs'],
      ai_title: clip['title'],
      ai_caption: clip['caption'],
      hook_score: clip['hook_score'],
      content_score: clip['content_score'],
      overall_score: clip['overall_score'],
      render_status: 'pending'
    })
  
  # 4. Update job
  await db.update_job(id=job.id, status='rendering')
  
  log.info('stage_complete', stage='analyze', clips_created=len(clips))
  
  return clips_analysis
```

**Status in DB now:** "rendering"

**Frontend sees:**
- Clips start appearing in ClipsGallery!
- Stage 3 "Analyzing" → checkmark
- Stage 4 "Rendering" → spinner

#### **T=0:55 - Worker Stage 4: RENDER**

```python
# In stages/render.py
async def run_render(job, video_path, transcript, clips):
  log.info('render_start', clips_to_render=len(clips), job_id=job.id)
  
  for clip in clips:
    try:
      # 1. Run face detection
      faces = detect_faces(video_path, clip['start'], clip['end'])
      
      if faces:
        # Center crop on face
        crop_x = int(faces['center_x'] * video_width - 9:16 width / 2)
      else:
        # Center crop
        crop_x = (video_width - 9:16_width) / 2
      
      # 2. Generate captions (ASS subtitle format)
      captions = generate_captions_ass(
        word_segments=transcript['word_segments'],
        clip_start=clip['start'],
        clip_end=clip['end']
      )
      
      # 3. Run FFmpeg to render
      ffmpeg_cmd = [
        'ffmpeg',
        '-i', video_path,
        '-ss', str(clip['start']),        # start time
        '-to', str(clip['end']),          # end time
        '-vf', f'crop=607:1080:{crop_x}:0,subtitles={captions_file}',
        '-c:v', 'libx264',               # video codec
        '-c:a', 'aac',                    # audio codec
        output_path
      ]
      
      await run_ffmpeg(ffmpeg_cmd)
      
      # 4. Upload to Supabase Storage
      storage_path = f"{job.user_id}/{job.id}/clip_{clip_index}.mp4"
      await upload_to_storage(output_path, storage_path)
      
      # 5. Generate signed URL
      public_url = await create_signed_url(storage_path, expires_in=48*3600)
      
      # 6. Update clip record
      await db.update_clip({
        id: clip['id'],
        storage_path: storage_path,
        public_url: public_url,
        render_status: 'complete'
      })
      
      log.info('clip_render_complete', clip_index=clip_index)
      
    except RenderError as e:
      log.error('clip_render_failed', clip_index=clip_index)
      await db.update_clip({
        id: clip['id'],
        render_status: 'failed',
        error: str(e)
      })
  
  # 7. Mark job complete
  await db.update_job({
    id: job.id,
    status: 'complete',
    completed_at: now()
  })
  
  log.info('stage_complete', stage='render', job_id=job.id)
```

**Status in DB now:** "complete"

**Frontend sees:**
- Stage 4 "Rendering" → checkmark
- Stage 5 "Complete" → checkmark
- JobStatusPipeline disappears
- ClipsGallery appears with all 3 clips
- Thumbnails load, videos playable
- Download buttons work

#### **T=5:00 (total) - Job finished!**

**Database state:**
```
video_jobs:
{
  id: 'abc123',
  status: 'complete',
  source_title: 'I Built a Website...',
  source_duration_secs: 677,
  credits_consumed: 12,
  created_at: '2026-06-13T10:25:31Z',
  completed_at: '2026-06-13T10:30:31Z'
}

video_clips:
[
  {
    id: 'clip1',
    clip_index: 0,
    start_time_secs: 0,
    end_time_secs: 60,
    ai_title: 'Intro Hook',
    overall_score: 0.88,
    storage_path: 'user/.../clip_0.mp4',
    public_url: 'https://signed...',
    render_status: 'complete'
  },
  {
    id: 'clip2',
    clip_index: 1,
    ...
    overall_score: 0.85,
    render_status: 'complete'
  },
  {
    id: 'clip3',
    clip_index: 2,
    ...
    overall_score: 0.79,
    render_status: 'complete'
  }
]

video_transcripts:
{
  job_id: 'abc123',
  language: 'en',
  word_segments: [{ word, start, end, speaker }, ...],
  total_speakers: 2
}

user_credits:
{
  user_id: 'user789',
  balance: 878,  # was 890, deducted 12
  lifetime_consumed: 122
}
```

**UI Final State:**
```
My Videos (List View)
├── [Job Card]
│   ├── Title: "I Built a Website..."
│   ├── Status: Complete ✅
│   ├── Date: Jun 13, 2026
│   ├── Clips: 3 clips
│   └── Duration: 11 min
│
└── [Click to view] → ClipsGallery
    ├── [Clip 0]
    │   ├── Thumbnail
    │   ├── Title: "Intro Hook"
    │   ├── Caption: "..."
    │   ├── Scores: Hook 0.85, Content 0.92, Overall 0.88
    │   ├── Video preview (playable)
    │   └── Download button
    │
    ├── [Clip 1]
    │   └── ... similar
    │
    └── [Clip 2]
        └── ... similar
```

---

## Key Takeaways

### Frontend
- **Real-time updates** via Supabase Realtime + polling fallback
- **Three-layer state:** Pages → Components → Hooks
- **Realtime subscription** automatically polls every 3 seconds
- **Progressive UI:** Status → Clips as they arrive

### Backend (Python Worker)
- **Job polling** every 5 seconds (max 3 concurrent)
- **Five-stage pipeline:** Download → Transcribe → Analyze → Render → Complete
- **Partial success** allowed (some clips fail, job completes anyway)
- **Error refunds** automatic if download fails
- **yt-dlp configuration** critical: no max_downloads, separate video/audio download

### Database
- **Denormalized fields** (clip_count, overall_score) for fast queries
- **Signed URLs** generated on-demand (48-hour expiry)
- **Credit transactions** immutable audit trail
- **Cascading deletes** (clip deletion cascades from job)

### Reliability
- **Network resilience:** Polling survives Realtime failures
- **Retry logic:** 3 retries on network errors
- **Partial completion:** Don't fail entire job if 1 clip fails
- **Credit safety:** Always refund on error before job fails

