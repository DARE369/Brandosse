# Stage 6 - Video Rendering, Captions, Reframing, And Upload

Last updated: 2026-05-09 13:56 +01:00

Stage 6 turns scored clip metadata into actual deliverable MP4 files. It generates captions, calculates a 9:16 crop, renders each clip, extracts thumbnails, uploads files to Supabase Storage, and updates `video_clips` rows.

## What Was Implemented

- Added `opencv-python-headless==4.10.0.84` and `numpy==1.26.4` to worker requirements.
- Added `utils/caption_generator.py` for ASS captions from word-level transcript data.
- Added `utils/video_reframer.py` for static 9:16 crop coordinates with OpenCV face-detection fallback.
- Added `utils/storage_uploader.py` for Supabase Storage upload and 48-hour signed URLs.
- Added `render_clip_to_file()` to `utils/ffmpeg_utils.py`.
- Added clip lookup and render-failure helpers to `database.py`.
- Replaced `stages/render.py` with the per-clip resilient rendering pipeline.

## Render Flow

For each clip:

1. Load the clip row from `video_clips`.
2. Generate ASS captions from `video_transcripts.word_segments`.
3. Calculate crop coordinates for 9:16 output.
4. Render a 1080x1920 MP4 with FFmpeg.
5. Extract a JPEG thumbnail.
6. Upload the MP4 and thumbnail to the private `video-clips` bucket.
7. Generate signed URLs that expire after 48 hours.
8. Mark the clip `complete` or `failed` in the database.

## Resilience Model

Each clip renders inside its own guarded path. One failed clip does not stop the others.

- If at least one clip succeeds, the stage returns normally.
- Failed clips are marked `render_status = failed`.
- Successful clips are marked `render_status = complete`.
- If every clip fails, `RenderError` is raised.

## Important Operational Notes

- FFmpeg must include `libass` for burned captions.
- Arial may not exist on Linux servers. Use DejaVu Sans later if captions render with a fallback font.
- OpenCV face detection is good enough for MVP but not a full dynamic tracker.
- Supabase bucket `video-clips` must remain private.
- Signed URLs expire after 48 hours and must be refreshed by frontend/API work in a later stage.

## Known Limits

- Live FFmpeg rendering was not run on this machine.
- OpenCV dependencies have not been installed locally yet.
- Supabase Storage upload was not live-tested.
- Per-frame dynamic tracking is deferred.
- Parallel clip rendering is deferred.

## Lightweight Tests

Syntax check:

```powershell
cd video-worker
python -m py_compile stages\render.py utils\caption_generator.py utils\video_reframer.py utils\storage_uploader.py utils\ffmpeg_utils.py
```

Caption test:

```powershell
cd video-worker
python -c "import tempfile, os; from utils.caption_generator import generate_ass_captions, _format_ass_time; assert _format_ass_time(65.5) == '0:01:05.50'; words=[{'word':'Hello','start':100,'end':100.5},{'word':'world','start':100.6,'end':101},{'word':'test','start':101.1,'end':101.5}]; d=tempfile.mkdtemp(); p=generate_ass_captions(words,100,110,0,d); assert p and os.path.exists(p); print('caption ok')"
```

Reframer fallback test:

```powershell
cd video-worker
python -c "from utils.video_reframer import calculate_crop_coordinates; r=calculate_crop_coordinates('/missing.mp4',0,60,'.'); assert r['crop_w'] > 0 and r['crop_h'] > 0; print(r)"
```
