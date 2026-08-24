# Video clipping — what it takes to scale

**Written 2026-08-23. Analysis only — none of this is scheduled work.** The
pipeline is currently sized for one user and a $5/month ceiling, deliberately
(`video-worker/fly.toml:61`). This document exists so the decisions are already
mapped when volume arrives, rather than discovered under load.

## The render bottleneck is CPU steal, not code (measured 2026-08-24)

Rendering was tuned hard — `veryfast` encoding (7x faster than `fast`), half
the MediaPipe sampling, fewer and shorter clips — and a 20-minute source still
took 36.8 minutes and lost 2 of 5 clips to a 10-minute-per-clip render timeout.

The cause is the machine, and `/proc/stat` on the running worker names it:

    user 1056 | system 176 | idle 5246 | steal 10824

**Steal time is ~9x the time we actually get to compute.** The hypervisor is
handing the physical core to other tenants; `shared-cpu-1x` is burstable, and
sustained video encoding is exactly the workload that exhausts a burst
allowance and then runs at a fraction of a core.

It shows up as wild variance rather than consistent slowness. The identical
crop+scale+encode measured:

    45s of video in 24s   (0.5x realtime — when CPU was available)
    20s of video in 98s   (4.9x realtime — while being starved)

Same code, same machine, same day. That variance is why clips time out
unpredictably rather than all failing or all passing, and it is why no further
code tuning will fix it — the work is already about as small as it can be
without cutting quality.

**What actually changes it:** a `performance` (dedicated-core) machine. Under
scale-to-zero the cost shape is favourable — billing is per second, so a
machine that is several times faster runs for proportionally fewer seconds and
the cost PER JOB stays close, while wall-clock drops sharply. It does raise the
floor if the machine ever idles, so it should be paired with keeping
scale-to-zero on.

**Founder decision, not an engineering one.** Verify current per-second pricing
on Fly before committing; the principle is that burst workloads on a
dedicated core cost roughly the same per job and finish far sooner.

## Today's actual ceiling

One machine, one job at a time, roughly four minutes per job:

    1 job × ~4 min  ->  ~15 jobs/hour  ->  ~360/day at 100% utilisation

Utilisation is never 100%, so treat **~200 jobs/day** as the real ceiling.
For reference, 1M users at 0.1% daily-active submitting one video each is
**1,000 jobs/day** — about 5× beyond this. The constraint is
`WORKER_MAX_CONCURRENT_JOBS = "1"` (`video-worker/fly.toml:61`) and
`MAX_CONCURRENT_RENDERS = 1` (`video-worker/stages/render.py:819`), both sized
for a 1GB machine.

## What already scales (no rewrite needed)

**Job claiming is atomic.** `claim_next_job` (`video-worker/database.py:23`)
does a compare-and-swap — update the row *only if* it is still `queued` — and
logs `job_claim_race` when it loses. Two workers cannot take the same job. This
is the single most important scaling property, and it is already correct: **more
machines is a config change, not a rewrite.**

**Vercel** is serverless and scales on its own. **Postgres** handles this
workload comfortably; Supabase's pooler is already in front of it.

**Per-clip commits.** Each clip uploads and marks itself complete as it
finishes, so a machine dying mid-job costs one clip, not the whole job.

## The genuine blockers, in the order they will bite

### 1. Uploads are machine-local — the real architectural blocker

Browser uploads are written to the machine's own Fly volume
(`video-worker/uploads.py:126`). With one machine that is optimal: no download
hop. With **two or more**, Fly's proxy may route the upload to machine A while
machine B claims the job — and B cannot see A's disk. The job fails on a file
that genuinely exists.

This does not fail gracefully and it does not warn. **Any move to multiple
workers must change this first.** Options: put uploads in object storage (S3 /
Cloudflare R2) and have the claiming worker fetch them; or route uploads to a
single dedicated ingest machine. Object storage is the durable answer and also
fixes item 3.

### 2. Polling instead of a queue

Every worker polls Postgres on an interval (`video-worker/poller.py:54`). Fine
to roughly a dozen workers. Beyond that the polling itself becomes load, and
claim races waste cycles. The upgrade path is Postgres `LISTEN/NOTIFY` (no new
infrastructure) or a real queue (Redis/SQS) if worker count goes into the
hundreds.

### 3. Storage volume and egress

At ~5MB/clip and 3 clips/job, 1,000 jobs/day is **~15GB/day** written. Supabase's
free tier is 1GB total. Two separate costs matter:

- **Storage** — 7-day retention already bounds the total to recent activity, not
  lifetime activity, which is what makes this survivable at all.
- **Egress** — serving video is where storage bills actually explode. Cloudflare
  R2 charges zero egress and is the standard answer; a CDN in front is
  mandatory at scale, not an optimisation.

### 4. External API limits and per-job cost

Groq (transcription) and Anthropic (analysis) are per-job marginal costs with
per-minute rate limits. At volume these need: request budgeting, backoff on 429,
and a place in the unit-economics model. They are the floor on cost-per-clip —
compute can be optimised, these cannot.

### 5. YouTube ingestion does not scale as built

One IP and one cookie set. Guest sessions throttle at roughly 300 videos/hour,
and a flagged IP degrades everything at once. At volume this becomes a
residential proxy pool plus rotating cookie sets — a real operational cost and
an ongoing maintenance burden, since YouTube changes the rules deliberately.
**The upload path has none of these problems**, which is a strong argument for
treating upload as the primary ingestion route commercially and YouTube links as
a convenience.

### 6. Cost shape changes with scale-to-zero

Scale-to-zero is correct at low volume and pointless at high volume — a machine
that never idles should never sleep. Above roughly 20 jobs/day, always-on plus
a bigger machine is both faster and simpler, and the 25s cold start disappears.

## Rough sizing when the time comes

| daily jobs | shape |
|---|---|
| < 50 | today's config; consider always-on to kill cold starts |
| 50–500 | 2–4 workers, uploads moved to object storage (blocker 1), bigger machines |
| 500–5k | queue instead of polling, CDN in front of storage, proxy pool if YouTube matters |
| 5k+ | autoscaling worker pool, regional workers, storage lifecycle policies |

## The one-line summary

**The architecture scales; the deployment does not.** Job claiming, per-clip
commits, and stateless workers are the hard parts, and they are already right.
The blocking work is machine-local uploads, then polling, then storage economics
— in that order.
