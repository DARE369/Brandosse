# Platform publish fields — what each destination actually accepts

Compiled 2026-09-12 for the Library → publish redesign.

**How to read this.** Every row is marked with its evidence grade:

| Grade | Meaning |
|---|---|
| **CODE** | Already implemented in this repo. `file:line` given. This is ground truth. |
| **DOCS** | Read from the platform's official API documentation. Source linked at the bottom. |
| **UNVERIFIED** | Believed true but not confirmed against a primary source. Do not build against it without checking. |

Platform APIs change. Anything **DOCS**-grade should be re-checked before the adapter is written, not trusted from this file alone.

---

## 0. The headline findings

**1. Three of the five platforms have an AI-disclosure field, and we generate AI content.**
YouTube's `status.containsSyntheticMedia` (**CODE** — already implemented, `_shared/youtube.service.ts:276`) and Instagram's `is_ai_generated` (**DOCS**) both exist. TikTok has AI-generated-content labelling too (**UNVERIFIED** — the adapter doesn't set it). For a product whose whole purpose is generating content, this is not an optional checkbox: it is the field most likely to get an account actioned if it is wrong. It should be answered once per asset at generation time and carried to every destination, not asked again in each publish.

**2. "Title" means four different things across four platforms.**
- YouTube: a real, separate, **required** field shown above the player (**CODE**, `youtube.service.ts:263-266`).
- TikTok video: `post_info.title` is the *caption* — there is no separate caption field (**CODE**, `tiktok.service.ts:202,241`).
- TikTok photo: has **both** `title` and `description` (**DOCS**) — the only TikTok surface with two.
- LinkedIn: `commentary` is the post body; `title` exists only as a label on an attached media asset, capped at 200 chars (**CODE**, `linkedin.service.ts:271,282`).

A single "Title" box in the composer would therefore be wrong on three of four. The composer must label per destination.

**3. Media is optional on exactly one platform.**
LinkedIn accepts a text-only post (**CODE** — `linkedin.service.ts:241` only errors when *both* caption and media are missing). YouTube and TikTok are media-mandatory. Facebook text-only is allowed (**DOCS**). Instagram is media-mandatory (**DOCS**).

**4. Two hard blocks are live right now and neither is our bug.**
- YouTube locks every upload from an unverified API project to **private**, not appealable (**CODE**, `youtube.service.ts:30-35`).
- TikTok rejects anything but `SELF_ONLY` from an unaudited client (**CODE**, `tiktok.service.ts:25-30`).

---

## 1. YouTube — `videos.insert`

Adapter: `supabase/functions/_shared/youtube.service.ts`. **Implemented and publishing today.**

| Field | Req? | Grade | Notes |
|---|---|---|---|
| `snippet.title` | **Required** | CODE `:263-266` | Falls back to `"Untitled"`. `<` and `>` rejected by YouTube outright (`:112`); sanitised before send. Truncated to `TITLE_MAX`. |
| `snippet.description` | Optional | CODE `:268` | Byte-truncated, not character-truncated — multi-byte safe. |
| `snippet.tags[]` | Optional | CODE `:283`, `fitTags():187` | **Combined 500-character budget across all tags**, enforced locally. |
| `snippet.categoryId` | Optional | CODE `:175` | Defaults to `DEFAULT_CATEGORY_ID`. **Not currently user-selectable — should be.** |
| `status.privacyStatus` | Optional | CODE `:148,173` | `private` \| `public` \| `unlisted`. Invalid values coerce to `private`. Forced private pre-audit regardless. |
| `status.selfDeclaredMadeForKids` | **Effectively required** | CODE `:244,274` | COPPA statement. Omitted only if explicitly null; the adapter refuses to invent one. |
| `status.containsSyntheticMedia` | Optional | CODE `:276` | AI/altered-content disclosure. Added to the API 2024-10-30 (DOCS). |
| Custom thumbnail | Optional | **DOCS** | **Not implemented.** Separate `thumbnails.set` endpoint, not part of `videos.insert`. Requires a verified channel. |

**Gap to close:** category picker, tag editor, and custom thumbnail. Thumbnail is a second API call after the upload succeeds — design it as a post-publish step, not a blocking field.

---

## 2. TikTok — Content Posting API

Adapter: `supabase/functions/_shared/tiktok.service.ts`. **Video implemented; photo not.**

### Video (`media_type: VIDEO`)

| Field | Req? | Grade | Notes |
|---|---|---|---|
| `post_info.title` | **Required** | CODE `:202,241` | This **is** the caption. Sourced from `post.caption ?? post.title`. |
| `post_info.privacy_level` | **Required** | CODE `:190` | Deliberately **no default** in the adapter. Must be `SELF_ONLY` until the content audit passes, or init returns `403 unaudited_client_can_only_post_to_private_accounts` (`:25-30`). |
| `post_info.disable_comment` | Optional | CODE `:246` | Defaults to **disabled** (`!== false`). |
| `post_info.disable_duet` | Optional | CODE `:247` | Defaults to disabled. |
| `post_info.disable_stitch` | Optional | CODE `:248` | Defaults to disabled. |
| `source_info.source` | **Required** | CODE `:252` | `FILE_UPLOAD` — the only option that works, because our media lives in Supabase storage and `PULL_FROM_URL` needs a verified domain (`:18-22`). |

### Photo (`media_type: PHOTO`) — **not implemented**

| Field | Req? | Grade | Notes |
|---|---|---|---|
| `post_info.title` | **Required** | DOCS | Photo posts have a title **and** a description — unlike video. |
| `post_info.description` | Optional | DOCS | The only TikTok surface with a separate body field. |
| `source_info.photo_images[]` | **Required** | DOCS | Array of image URLs. Single image or multi-image carousel. |
| `source_info.photo_cover_index` | **Required** | DOCS | Which image is the cover. |
| `post_mode` | **Required** | DOCS | `DIRECT_POST` publishes; `MEDIA_UPLOAD` drops into the user's TikTok inbox to finish in-app. |

**Blocker, and it is structural:** photo posts are `PULL_FROM_URL` **only**, and the URL must sit on a verified domain. There is no `FILE_UPLOAD` path for photos. So TikTok images cannot work until domain verification is done — which is exactly why the adapter is video-only. Per the 2026-09-12 decision, the photo fields are designed and shown **locked with the reason**, not hidden.

---

## 3. LinkedIn — Posts API

Adapter: `supabase/functions/_shared/linkedin.service.ts`. **Implemented and publishing today.**

| Field | Req? | Grade | Notes |
|---|---|---|---|
| `commentary` | Conditionally required | CODE `:240-241` | The post body. Required **unless** media is attached. 3,000-character limit (DOCS). |
| `visibility` | **Required** | CODE `:272` | **Hardcoded to `PUBLIC`.** `CONNECTIONS` is also valid (DOCS) and is not offered to the user today. |
| `distribution.feedDistribution` | Required | DOCS | `MAIN_FEED`. |
| `lifecycleState` | Required | DOCS | `PUBLISHED`. |
| `content.media.id` | Optional | CODE `:282` | Image URN from a prior upload step. |
| `content.media.title` | Optional | CODE `:282` | Capped at 200 chars. A label on the media, **not** a post title. |
| `content.media.altText` | Optional | **DOCS** | **Not implemented.** Accessibility text. We already hold `alt_text` on every asset — this is a pure wiring gap. |

**Gaps to close:** visibility choice (public vs connections), and alt text — which we already generate and currently throw away at the boundary.

**Practical note, not an API limit:** only ~140 chars (mobile) / ~210 (desktop) show before the "see more" fold. The composer should mark that line, since it governs whether anyone reads the rest.

---

## 4. Instagram — Content Publishing API (**adapter not built**)

Registry: `is_supported = false`. Credentials exist; nothing is implemented. All **DOCS**-grade.

Two-step everywhere: create a container, then publish it.

| Field | Req? | Applies to | Notes |
|---|---|---|---|
| `image_url` / `video_url` | **Required** | all | Must be a public URL. **JPEG is the only image format supported.** |
| `media_type` | **Required** | video/reels/carousel/stories | `VIDEO` \| `REELS` \| `CAROUSEL` \| `STORIES`. Omit for a single image. |
| `caption` | Optional | feed, carousel, stories | |
| `alt_text` | Optional | **images only** | Accessibility. We already hold this per asset. |
| `user_tags` | Optional | image, video/reels, stories | Tagged accounts. |
| `location_id` | Optional | reels | Location page ID. |
| `collaborators` | Optional | reels | |
| `cover_url` / `thumb_offset` | Optional | reels | Custom cover — the Instagram equivalent of a YouTube thumbnail. |
| `audio_name` | Optional | reels | |
| `children[]` | **Required** | carousel | Up to **10** container IDs. |
| `is_ai_generated` | Optional | image, video/reels, carousel | **AI disclosure.** On a carousel, set on the parent container only. |
| `is_paid_partnership` | Optional | image, video/reels, carousel | |
| `branded_content_sponsor_ids[]` | Optional | image, video/reels, carousel | Max 2. |
| `upload_type: resumable` | Optional | video/reels | For large files. |

**Limits:** 100 API-published posts per rolling 24 hours (a carousel counts as one). Shopping tags and filters are **not supported** via the API. Carousel items are cropped to the first image's ratio, default 1:1.

**Not stated in the docs read** (so **UNVERIFIED**): caption character limit, hashtag cap, alt-text length. Check before enforcing any of them in the UI.

---

## 5. Facebook Pages — Graph API (**adapter not built**)

Registry: `is_supported = false`. All **DOCS**-grade.

| Field | Req? | Notes |
|---|---|---|
| `message` | Conditionally required | Post text. Required if there's no media or link. |
| `link` | Optional | Link posts. |
| `published` | Optional | Set `false` together with `scheduled_publish_time` to schedule. |
| `scheduled_publish_time` | Conditional | UNIX timestamp. **Must be between 10 minutes and 30 days out** — a real constraint the scheduler UI has to enforce. |
| `alt_text` | Optional | UNVERIFIED for the photos endpoint specifically. |

**Endpoints differ by media:** `/{page-id}/feed` for text and links, `/{page-id}/photos` for photos, and a three-step Resumable Upload API for video.

**Permissions:** `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`.

**Worth noting:** Facebook is the only one of the five with **native API-side scheduling**. Everywhere else, "schedule" means we hold the post and publish it ourselves at the right time. The composer should not imply otherwise.

---

## 6. What this means for the composer

1. **Never show one generic field set.** Title, caption and description do not mean the same thing across destinations. Label per platform.
2. **Ask AI-disclosure once, at generation, and carry it.** It maps to `containsSyntheticMedia` (YouTube) and `is_ai_generated` (Instagram). Asking per publish invites an inconsistent answer across platforms for the same file.
3. **Alt text is already generated and is currently dropped.** LinkedIn and Instagram both accept it. Wiring it costs nothing and is the single cheapest accessibility win available.
4. **Surface the two live locks as state, not as errors.** YouTube-forced-private and TikTok `SELF_ONLY` are platform conditions, not failures.
5. **Character counters must be per destination**, against that platform's real limit: LinkedIn 3,000; YouTube description effectively 5,000 (UNVERIFIED — byte-truncated in code, not char-capped); YouTube tags share a 500-char budget; TikTok and Instagram limits UNVERIFIED.
6. **Scheduling is ours, not theirs**, on four of five platforms — so the scheduler owns retry, timezone and failure surfacing.

---

## Sources

- [YouTube Data API — Videos](https://developers.google.com/youtube/v3/docs/videos) · [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) · [Revision history (containsSyntheticMedia, 2024-10-30)](https://developers.google.com/youtube/v3/revision_history)
- [TikTok — Content Posting API overview](https://developers.tiktok.com/products/content-posting-api/) · [Photo post reference](https://developers.tiktok.com/doc/content-posting-api-reference-photo-post) · [Media transfer guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide) · [Direct post get-started](https://developers.tiktok.com/docs/en/content-posting-api-get-started)
- [LinkedIn — Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-06)
- [Instagram — Content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/) · [IG User media reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/) · [IG Container](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-container/)
- Facebook Pages publishing: no single official page was read end-to-end; the fields above came from secondary developer guides and are **DOCS**-grade at best. Re-verify against `developers.facebook.com/docs/pages-api` before building.
