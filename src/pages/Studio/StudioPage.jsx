"use client";

// src/pages/Studio/StudioPage.jsx
// Design-system-v2 rebuild of the Studio screen (see memory design-system-v2 /
// docs mockup "Studio.dc.html"). This ports the state machine that used to
// live in src/components/GenerateStudio/BrandosseGenerateStudio.jsx
// (stage: brief → generating → results → publish → published) — same
// Zustand store, same actions, same real edge functions. Only the
// presentation changed. Mounted by src/pages/GeneratePage/GeneratePageV2.jsx,
// which still owns session-routing/route-state/realtime init (untouched).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Sparkles, Sliders, Clock, History as HistoryIcon, Video as VideoIcon,
  Settings, X,
} from "lucide-react";
import useSessionStore from "../../stores/SessionStore";
import useBrandKitStore from "../../stores/BrandKitStore";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useCreditBalance } from "../../hooks/useCreditBalance";
import useConnectedAccounts from "../../components/GenerateStudio/hooks/useConnectedAccounts";
import {
  CONTENT_TYPES,
  ASPECT_RATIOS,
  IMAGE_MODEL_OPTIONS,
  VIDEO_QUALITY_TIERS,
  estimateGenerationCost,
  getVideoDurations,
} from "../../config/mediaGenerationOptions";
import { PROMPT_LIMIT } from "../../components/GenerateStudio/shared/constants";
import {
  UiV2ThemeProvider, useUiV2Theme, AppHeader, CreditPill, IconButton,
  Card, Badge, Skeleton, EmptyState, Button, Modal, Drawer, Dropdown, MobileNavDrawer,
  NotificationBell, AvatarMenu,
} from "../../ui-v2";
import PostProductionPanel from "./PostProductionPanel";
import SessionHistoryDrawer from "./SessionHistoryDrawer";
import StudioLightbox from "./StudioLightbox";
import styles from "./StudioPage.module.css";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", href: "/app/dashboard" },
  { key: "studio", label: "Studio", href: "/app/generate" },
  { key: "library", label: "Library", href: "/app/library" },
  { key: "calendar", label: "Calendar", href: "/app/calendar" },
  { key: "brand-kit", label: "Brand Kit", href: "/app/settings/brand-kit" },
];

function ThemeToggleButton() {
  const { isDark, toggleTheme } = useUiV2Theme();
  return (
    <IconButton title={isDark ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}>
      {isDark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" strokeLinecap="round" />
          <circle cx="12" cy="12" r="4.5" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 14.5A8.5 8.5 0 119.5 4a7 7 0 0010.5 10.5z" />
        </svg>
      )}
    </IconButton>
  );
}

const MODE_ICON = { image: "🖼", carousel: "▦", video: "▶", edit: "✎", "image-to-video": "✦" };

// Credit cost of regenerating a single image — kept in sync with the cost
// estimator (source of truth: mediaGenerationOptions.js) so the "Regenerate
// (N cr)" label on a quality-flagged card never drifts from what's actually
// charged. 2.2: a hard-failed image offers this as a one-click recovery; the
// spend is the user's explicit choice, never automatic.
const IMAGE_REGEN_COST = estimateGenerationCost({ mediaType: "image", contentType: "single", batchSize: 1 });

// 2.1: renders a subtle quality indicator from metadata.quality (written by
// the quality-gate edge fn). Only surfaces warn/fail — a clean "pass" shows
// nothing, so good images stay uncluttered. Returns null until scored.
function QualityFlag({ quality }) {
  if (!quality || quality.verdict === "pass") return null;
  const isFail = quality.verdict === "fail";
  const title = (quality.flags && quality.flags.length)
    ? quality.flags.join(" · ")
    : (isFail ? "Quality check flagged issues — consider regenerating" : "Quality check found minor issues");
  return (
    <span
      title={title}
      style={{
        position: "absolute", top: 6, left: 6, zIndex: 2,
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 7px", borderRadius: 999, fontSize: 10.5, fontWeight: 600,
        fontFamily: "var(--uiv2-font-mono)",
        background: isFail ? "var(--uiv2-danger, #c0392b)" : "var(--uiv2-warning, #b98900)",
        color: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
      }}
    >
      {isFail ? "⚠ Low quality" : "⚠ Check"}
    </span>
  );
}

function StudioBody({ brandKit }) {
  const { navigate } = useAppNavigation();
  const { user, profile } = useAuth();
  const { accounts, accountsLoading } = useConnectedAccounts();
  const credits = useCreditBalance(user?.id ?? null);

  const {
    activeSession, activeGenerations, selectedGeneration, selectedGenerationId,
    isGenerating, generationProgress, progressLabel, error, settings, postProduction,
    updateSettings, startGeneration, startCarouselGeneration, approveCarousel, cancelPendingCarousel, pendingCarousel, startEditGeneration,
    startVideoGeneration, generateVideoFirstFrame, enhancePrompt, selectGeneration, hydratePostProductionFromGeneration,
    regeneratePostMetadata, optimizeSeo, scoreSeo, updatePostProduction, saveDraft, saveDraftPrompt, publishContent,
    videoJobState, dismissVideoJob, setVideoJobMinimized, promptSeed, consumePromptSeed,
    cancelActiveGeneration, lastBatchOutcome, retryFailedVariants,
    regenerateVariant, regenerateSlides, regeneratingIds, checkScheduleConflict,
    videoJobs, fetchVideoJobs, subscribeToBackgroundJobs, cancelVideoJob,
    sessions, projects, activeProject, createNewSession, updateSessionTitle, deleteSession,
    fetchSessions, fetchProjects, createProject, renameProject, deleteProject, reorderProjects,
    sessionsLoading, projectsLoading,
  } = useSessionStore();

  // The old ProjectSessionBreadcrumb (deleted) was the only place that ever
  // called these — without it `sessions`/`projects` silently stayed empty.
  useEffect(() => {
    fetchSessions();
    fetchProjects();
  }, [fetchSessions, fetchProjects]);

  // Seed Studio's default aspect ratio / video quality / brand-kit-matching
  // from Settings > Content defaults, once per page load. Guarded so it
  // never overwrites a choice the user has already made this session.
  const defaultsSeededRef = useRef(false);
  useEffect(() => {
    if (!user?.id || defaultsSeededRef.current) return;
    defaultsSeededRef.current = true;
    import("../../services/userSettingsService").then(({ fetchUserSettings }) => {
      fetchUserSettings(user.id)
        .then((loaded) => {
          const gen = loaded?.generationDefaults;
          if (!gen) return;
          updateSettings({
            aspectRatio: gen.aspect_ratio || settings.aspectRatio,
            videoQuality: gen.video_quality || settings.videoQuality,
            matchBrandKit: gen.match_brand_kit !== false,
            imageModel: gen.image_model || settings.imageModel,
            // 4.2: restore a persisted style-lock reference set across sessions.
            styleLock: Boolean(gen.style_lock),
            referenceImages: gen.style_lock && Array.isArray(gen.reference_images) ? gen.reference_images : [],
          });
        })
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Week 3 Fix 3: real, persistent video job history — load it once, then
  // subscribe to the user's own background-jobs-<uid> topic for live
  // updates for as long as this page is mounted (independent of which
  // session is active, unlike subscribeToSession).
  useEffect(() => {
    if (!user?.id) return undefined;
    fetchVideoJobs();
    const unsubscribe = subscribeToBackgroundJobs(user.id);
    return unsubscribe;
  }, [user?.id, fetchVideoJobs, subscribeToBackgroundJobs]);

  const [prompt, setPrompt] = useState("");
  const [sourceImageUrl, setSourceImageUrl] = useState("");
  // 5.1: first-frame approval for text-to-video — hold the candidate frame
  // (a still, billed as an image) until the user approves it, then animate
  // (billed as video). null = no pending frame.
  const [pendingFrame, setPendingFrame] = useState(null); // { url }
  const [framePhase, setFramePhase] = useState("idle"); // idle | generating | review | animating
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [sourcePickerItems, setSourcePickerItems] = useState([]);
  const [sourcePickerLoading, setSourcePickerLoading] = useState(false);
  // pickerMode: "source" (3.2, single, for edit/animate) | "reference" (4.1,
  // multi-add, for brand/subject matching). Same modal, different sink.
  const [pickerMode, setPickerMode] = useState("source");
  const [enhancing, setEnhancing] = useState(false);
  const [localError, setLocalError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [studioStage, setStudioStage] = useState("brief"); // brief | generating | results | publish | published
  const [guided, setGuided] = useState(false);
  const [guidedFields, setGuidedFields] = useState({ subject: "", setting: "", style: "", mood: "" });
  const [negativePrompt, setNegativePrompt] = useState("");
  const [applyBrandKit, setApplyBrandKit] = useState(true);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [videoJobsOpen, setVideoJobsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleConflict, setScheduleConflict] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState(null);
  const [slideSelection, setSlideSelection] = useState({});
  // Old generations from a since-removed image provider (Pollinations.ai)
  // have URLs that no longer resolve — track which generation's publish
  // preview failed to load so a placeholder renders instead of a
  // permanently broken img/video element.
  const [publishPreviewFailedId, setPublishPreviewFailedId] = useState(null);
  const [failedThumbIds, setFailedThumbIds] = useState(() => new Set());
  const markThumbFailed = useCallback((id) => {
    setFailedThumbIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  // WEEK 2 FIX 5 (+ ADDENDUM UPGRADE 3): per-action rate-limit countdown —
  // { [actionKey]: epochMsWhenClickableAgain }. Ticks every second while
  // any entry is still in the future so the buttons below can show a real
  // "Retry in Ns" countdown instead of guessing.
  const [rateLimitedUntil, setRateLimitedUntil] = useState({});
  const [rateLimitTick, setRateLimitTick] = useState(0);

  const cancelRequestedRef = useRef(false);
  const promptRef = useRef(null);
  const automationRunRef = useRef(new Set());

  const selectedMode = useMemo(() => {
    if (settings.mediaType === "image-to-video") return "image-to-video";
    if (settings.mediaType === "edit") return "edit";
    if (settings.mediaType === "video") return "video";
    if (settings.contentType === "carousel") return "carousel";
    return "image";
  }, [settings.mediaType, settings.contentType]);

  const cost = useMemo(() => estimateGenerationCost(settings), [settings]);
  const availableCredits = credits.balance;
  const canAfford = !credits.ready || availableCredits >= cost;
  const isCarousel = selectedMode === "carousel";
  const isVideoMode = selectedMode === "video" || selectedMode === "image-to-video";
  const needsSourceImage = selectedMode === "edit" || selectedMode === "image-to-video";

  const completedGenerations = useMemo(
    () => activeGenerations.filter((g) => g.status === "completed"),
    [activeGenerations]
  );
  const lightboxGeneration = completedGenerations[lightboxIndex] || null;
  // 6.3: generations the quality gate hard-flagged — offer a one-click bulk
  // regenerate ("regenerate the losers"). Each regen is charged (uses the same
  // per-variant regenerate path).
  const flaggedGenerations = useMemo(
    () => completedGenerations.filter((g) => g.media_type !== "video" && g.metadata?.quality?.verdict === "fail"),
    [completedGenerations]
  );

  useEffect(() => {
    if (isGenerating && !cancelRequestedRef.current) setStudioStage("generating");
  }, [isGenerating]);

  useEffect(() => {
    if (!isGenerating && completedGenerations.length > 0 && studioStage === "generating" && !cancelRequestedRef.current) {
      setStudioStage("results");
    }
    if (!isGenerating) cancelRequestedRef.current = false;
  }, [isGenerating, completedGenerations.length, studioStage]);

  useEffect(() => {
    if (!guided) return;
    const parts = [guidedFields.subject, guidedFields.setting, guidedFields.style, guidedFields.mood].filter(Boolean);
    if (parts.length) setPrompt(parts.join(", ").slice(0, PROMPT_LIMIT));
  }, [guided, guidedFields]);

  /* WEEK 2 FIX 3 (+ ADDENDUM UPGRADE 2): the automationRunRef guard used to
     be "run once per generation id, ever" — if that one attempt silently
     failed (or the row it wrote got stuck 'in_progress'), leaving and
     re-entering publish stage for the exact same generation would never
     retry automatically, no matter how many times the user came back. It's
     now "once per publish-stage *entry*": the guard set is cleared every
     time studioStage leaves 'publish', so a fresh entry — including
     re-entering the same generation's publish stage after a prior failed
     attempt — always gets one automatic retry. Combined with the server-
     side stale-'in_progress' reconciliation in hydratePostProductionFromGeneration,
     a previously-stuck row is now both recoverable automatically on
     re-entry AND recoverable manually via the Regenerate/Re-score buttons
     below at any time. */
  useEffect(() => {
    if (studioStage !== "publish") {
      automationRunRef.current.clear();
    }
  }, [studioStage]);

  /* Auto-hydrate captions when entering publish stage — same automation the old orchestrator ran. */
  useEffect(() => {
    if (studioStage !== "publish" || !selectedGeneration?.id) return;
    const key = `pub_${selectedGeneration.id}`;
    if (automationRunRef.current.has(key)) return;
    automationRunRef.current.add(key);
    (async () => {
      try {
        await hydratePostProductionFromGeneration(selectedGeneration.id);
        const pp = useSessionStore.getState().postProduction;
        if (!String(pp.caption || "").trim()) {
          await regeneratePostMetadata(["title", "caption", "hashtags"]);
        }
        await optimizeSeo().catch(() => {});
      } catch {
        /* captions/scoring are optional — generation still usable without them */
      }
    })();
  }, [studioStage, selectedGeneration?.id, hydratePostProductionFromGeneration, regeneratePostMetadata, optimizeSeo]);

  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [prompt]);

  const handleModeChange = useCallback(
    (mode, explicitSource) => {
      const next = CONTENT_TYPES.find((t) => t.id === mode) || CONTENT_TYPES[0];
      const isVid = next.mediaType === "video" || next.mediaType === "image-to-video";
      updateSettings({
        mediaType: next.mediaType,
        contentType: next.contentType,
        batchSize: next.id === "image" ? Math.max(1, Number(settings.batchSize) || 1) : 1,
        slideCount: next.id === "carousel" ? settings.slideCount || 6 : "auto",
        duration: isVid ? 5 : settings.duration,
        videoQuality: isVid ? (settings.videoQuality || "standard") : settings.videoQuality,
        // explicitSource lets handleUseAsSource (3.1) pass the just-selected URL
        // directly, avoiding a stale-closure read of sourceImageUrl (which it
        // sets in the same tick). Falls back to current state otherwise.
        referenceImageUrl: explicitSource ?? sourceImageUrl,
      });
    },
    [settings, sourceImageUrl, updateSettings]
  );

  /* Consume a one-shot prompt seed set by GeneratePageV2's route-state
     handoff effect (library asset / template / repurpose-edit arrivals).
     Freeform prompt always wins over guided fields on a seed — guided mode
     is switched off rather than trying to map free text into the
     subject/setting/style/mood fields. */
  useEffect(() => {
    if (!promptSeed) return;
    const seed = consumePromptSeed();
    if (!seed) return;

    const seedText = String(seed.text || "").trim().slice(0, PROMPT_LIMIT);
    setGuided(false);
    if (seedText) setPrompt(seedText);

    if (seed.activateEditMode) {
      if (seed.sourceImageUrl) setSourceImageUrl(seed.sourceImageUrl);
      handleModeChange("edit");
    }

    // ADDENDUM UPGRADE 4: a session-draft seed (source: 'session_draft',
    // from loadSession restoring sessions.metadata.draft_prompt) also
    // carries a settings snapshot — restore mode/aspect ratio/slide count/
    // etc. exactly as they were when the draft was saved, same as the
    // prompt text itself.
    if (seed.settingsSnapshot) {
      updateSettings(seed.settingsSnapshot);
    }
  }, [promptSeed, consumePromptSeed, handleModeChange, updateSettings]);

  useEffect(() => {
    const hasActive = Object.values(rateLimitedUntil).some((until) => until > Date.now());
    if (!hasActive) return undefined;
    const interval = setInterval(() => setRateLimitTick((tick) => tick + 1), 1000);
    return () => clearInterval(interval);
  }, [rateLimitedUntil]);

  /* If the error carries a retryAfterSeconds (a 429 from our own rate
     limiter — see edgeFunctionClient.js/media.service.js), starts a real
     countdown for that action's key and shows the exact wait time instead
     of a generic message. Returns true if it handled the error (so the
     caller skips its normal toast). */
  const applyRateLimit = useCallback((key, err) => {
    const seconds = Number(err?.retryAfterSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return false;
    setRateLimitedUntil((prev) => ({ ...prev, [key]: Date.now() + seconds * 1000 }));
    toast.error(`You're going a bit fast — try again in ${seconds}s.`);
    return true;
  }, []);

  const getRateLimitRemaining = useCallback((key) => {
    const until = rateLimitedUntil[key];
    if (!until) return 0;
    const remaining = Math.ceil((until - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
    // rateLimitTick is read only to force this to recompute every second —
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateLimitedUntil, rateLimitTick]);

  const handleEnhance = useCallback(async () => {
    const src = prompt.trim();
    if (!src) return;
    setEnhancing(true);
    try {
      const result = await enhancePrompt(src);
      if (result?.enhanced) setPrompt(result.enhanced.slice(0, PROMPT_LIMIT));
    } catch (err) {
      if (!applyRateLimit("enhance", err)) {
        toast.error(err?.message || "Could not enhance prompt.");
      }
    } finally {
      setEnhancing(false);
    }
  }, [prompt, enhancePrompt, applyRateLimit]);

  /* WEEK 2 FIX 3 (+ ADDENDUM UPGRADE 2) — manual recovery controls. These
     work regardless of whether the automatic publish-stage hydrate ever
     ran, succeeded, or got stuck: metadataStatus/seoStatus reflect whatever
     the server last wrote (or the stale-reconciled 'failed' from
     hydratePostProductionFromGeneration), so a permanently-stuck row is
     always recoverable from here even without re-entering publish stage. */
  const handleRegenerateMetadata = useCallback(async () => {
    try {
      await regeneratePostMetadata(["title", "caption", "hashtags"]);
    } catch (err) {
      if (!applyRateLimit("regenerateMetadata", err)) {
        toast.error(err?.message || "Could not regenerate caption & title.");
      }
    }
  }, [regeneratePostMetadata, applyRateLimit]);

  const handleRescore = useCallback(async () => {
    try {
      await scoreSeo();
    } catch (err) {
      if (applyRateLimit("rescore", err)) return;
      toast.error(err?.message || "Could not score this post.");
    }
  }, [scoreSeo, applyRateLimit]);

  const validatePreflight = useCallback(() => {
    if (!prompt.trim()) return "Prompt is required.";
    if (prompt.length > PROMPT_LIMIT) return `Prompt must be under ${PROMPT_LIMIT} characters.`;
    if (needsSourceImage && !sourceImageUrl.trim()) return "A source image URL is required for this mode.";
    if (!canAfford) return `This needs ${cost} credits. You have ${availableCredits}.`;
    return "";
  }, [prompt, needsSourceImage, sourceImageUrl, canAfford, cost, availableCredits]);

  const handleGenerate = useCallback(async () => {
    const err = validatePreflight();
    if (err) {
      setLocalError(err);
      toast.error(err);
      return;
    }
    setLocalError("");
    cancelRequestedRef.current = false;
    updateSettings({
      referenceImageUrl: sourceImageUrl.trim(),
      negativePrompt,
      brandKit: applyBrandKit ? brandKit : null,
    });
    try {
      if (isCarousel) await startCarouselGeneration(prompt.trim(), settings.slideCount || 6);
      else if (selectedMode === "edit") await startEditGeneration(sourceImageUrl.trim(), prompt.trim());
      else if (selectedMode === "video" && !sourceImageUrl.trim()) {
        // 5.1: text-to-video → generate a still first frame for approval before
        // spending the (expensive) animate credits. The frame is billed as an
        // image; the animate step is billed separately when the user approves.
        setFramePhase("generating");
        setPendingFrame(null);
        try {
          const frame = await generateVideoFirstFrame(prompt.trim());
          setPendingFrame(frame);
          setFramePhase("review");
        } catch (frameErr) {
          setFramePhase("idle");
          if (!applyRateLimit("generate", frameErr)) {
            toast.error(frameErr?.message || "Could not generate a first frame.");
          }
        }
        return;
      }
      else if (isVideoMode) {
        // image-to-video (source already provided) OR any remaining video path:
        // submits-and-returns; the job lives in the persistent Video Jobs drawer.
        await startVideoGeneration(prompt.trim());
        setStudioStage("brief");
        setVideoJobsOpen(true);
        toast("Video queued — rendering in the background. Track it in Video jobs.");
        return;
      }
      else await startGeneration(prompt.trim());
    } catch (genErr) {
      if (!cancelRequestedRef.current) {
        // WEEK 2 FIX 5: a 429 here still uses the standard error box (per
        // this fix's own instruction — "the standard error box + Retry is
        // fine" for the Generate button specifically), but also starts the
        // countdown so the button itself discourages an immediate re-click.
        applyRateLimit("generate", genErr);
        const msg = genErr?.message || "Generation failed.";
        setLocalError(msg);
        toast.error(msg);
      }
    }
  }, [validatePreflight, isCarousel, selectedMode, isVideoMode, prompt, sourceImageUrl, negativePrompt, applyBrandKit, brandKit, settings, updateSettings, startGeneration, startCarouselGeneration, startEditGeneration, startVideoGeneration, applyRateLimit]);

  /* 5.1: approve the reviewed first frame → animate it (image-to-video). The
     frame was already billed as an image; this is the separate video charge. */
  const handleApproveFrame = useCallback(async () => {
    if (!pendingFrame?.url) return;
    setFramePhase("animating");
    try {
      updateSettings({ mediaType: "image-to-video", referenceImageUrl: pendingFrame.url });
      // startVideoGeneration reads settings.referenceImageUrl for the source.
      await startVideoGeneration(prompt.trim());
      setPendingFrame(null);
      setFramePhase("idle");
      setStudioStage("brief");
      setVideoJobsOpen(true);
      toast("Frame approved — animating in the background. Track it in Video jobs.");
    } catch (err) {
      setFramePhase("review");
      if (!applyRateLimit("generate", err)) toast.error(err?.message || "Could not start the animation.");
    }
  }, [pendingFrame, prompt, updateSettings, startVideoGeneration, applyRateLimit]);

  const handleRegenerateFrame = useCallback(async () => {
    setFramePhase("generating");
    try {
      const frame = await generateVideoFirstFrame(prompt.trim());
      setPendingFrame(frame);
      setFramePhase("review");
    } catch (err) {
      setFramePhase("review");
      if (!applyRateLimit("generate", err)) toast.error(err?.message || "Could not regenerate the frame.");
    }
  }, [prompt, generateVideoFirstFrame, applyRateLimit]);

  const handleCancelFrame = useCallback(() => {
    setPendingFrame(null);
    setFramePhase("idle");
  }, []);

  /* 5.2: approve the carousel storyboard → render (this is where the slide
     credits are actually spent). Cancel discards the plan with no spend. */
  const handleApproveCarousel = useCallback(async () => {
    try {
      await approveCarousel();
      setStudioStage("results");
    } catch (err) {
      if (!applyRateLimit("generate", err)) toast.error(err?.message || "Could not render the carousel.");
    }
  }, [approveCarousel, applyRateLimit]);

  /* Cancel (Week 3 Fix 2 — honest cancel): for image/carousel/edit,
     cancelActiveGeneration() aborts the store's AbortController, which
     reaches the in-flight fetch for whichever variant/slide hasn't already
     passed the point of no return, and skips any not-yet-started
     variants/slides entirely (never billed, never sent to the provider —
     see SessionStore.js/generationPipeline.js). A render already past that
     point (mid-upload, mid-DB-write on the provider's side) will still
     complete and appear in this session, which is why the copy below says
     so rather than claiming a full stop. Video's "cancel" only detaches the
     client from the still-running server-side job (Week 3 Fix 3) — the job
     itself keeps going and is recoverable from the Video Jobs drawer. */
  const handleCancelGenerate = useCallback(() => {
    if (isVideoMode && videoJobState.status) {
      dismissVideoJob();
      toast("Detached from this video job — it keeps rendering in the background and will appear when done.");
    } else {
      cancelRequestedRef.current = true;
      cancelActiveGeneration();
      toast("Cancelled — any renders already in progress will still appear in this session.");
    }
    setStudioStage("brief");
  }, [isVideoMode, videoJobState.status, dismissVideoJob, cancelActiveGeneration]);

  const handleGoToPublish = useCallback(
    (gen) => {
      if (gen) selectGeneration(gen);
      setStudioStage("publish");
    },
    [selectGeneration]
  );

  const openLightbox = useCallback(
    (generation) => {
      selectGeneration(generation);
      const idx = completedGenerations.findIndex((g) => g.id === generation.id);
      setLightboxIndex(Math.max(0, idx));
      setLightboxOpen(true);
    },
    [selectGeneration, completedGenerations]
  );

  const handleRegenerateVariant = useCallback(
    async (generation) => {
      try {
        await regenerateVariant(generation);
      } catch (err) {
        toast.error(err?.message || "Could not regenerate this variant.");
      }
    },
    [regenerateVariant]
  );

  /* 3.1: turn a generated image into the source for an edit / frames-to-video
     run in one click — no more hand-copying a URL into the source box. Feeds
     the generation's stored image straight into sourceImageUrl, flips the
     mode, and scrolls the brief into view. Only images can be a source. */
  const handleUseAsSource = useCallback(
    (generation, targetMode) => {
      const src = generation?.storage_path || generation?.output_url || generation?.thumbnail_url;
      if (!src) {
        toast.error("This image is no longer available to use as a source.");
        return;
      }
      setSourceImageUrl(src);
      handleModeChange(targetMode, src); // 'edit' | 'image-to-video'; pass src explicitly (state not yet committed)
      setStudioStage("brief");
      setLightboxOpen(false);
      toast.success(targetMode === "edit" ? "Loaded as source — describe the edit." : "Loaded as first frame — describe the motion.");
      setTimeout(() => promptRef.current?.focus(), 120);
    },
    [handleModeChange]
  );

  /* 3.2: open the "pick a source from your Library" modal. Loads the user's
     recent completed IMAGE generations — the exact set that makes sense as an
     edit / frames-to-video source — so they don't have to hand-paste a URL. */
  const openSourcePicker = useCallback(async (mode = "source") => {
    setPickerMode(mode);
    setSourcePickerOpen(true);
    setSourcePickerLoading(true);
    try {
      const { data, error } = await supabase
        .from("generations")
        .select("id, storage_path, prompt, media_type, created_at")
        .eq("user_id", user?.id)
        .eq("media_type", "image")
        .eq("status", "completed")
        .is("organization_id", null)
        .not("storage_path", "is", null)
        .order("created_at", { ascending: false })
        .limit(48);
      if (error) throw error;
      setSourcePickerItems(data || []);
    } catch (err) {
      toast.error("Couldn't load your images — you can still paste a URL.");
      setSourcePickerItems([]);
    } finally {
      setSourcePickerLoading(false);
    }
  }, [user?.id]);

  const handlePickSource = useCallback((item) => {
    const src = item?.storage_path;
    if (!src) { setSourcePickerOpen(false); return; }
    if (pickerMode === "reference") {
      // 4.1: multi-add to settings.referenceImages (deduped, cap 6 for UI sanity).
      const current = Array.isArray(settings.referenceImages) ? settings.referenceImages : [];
      if (current.includes(src)) {
        toast("Already added as a reference.");
      } else if (current.length >= 6) {
        toast.error("Up to 6 reference images.");
      } else {
        updateSettings({ referenceImages: [...current, src] });
        toast.success("Added as a reference.");
      }
      // keep the modal open so several can be added in a row
    } else {
      setSourceImageUrl(src);
      toast.success("Source image selected.");
      setSourcePickerOpen(false);
    }
  }, [pickerMode, settings.referenceImages, updateSettings]);

  const removeReferenceImage = useCallback((url) => {
    const current = Array.isArray(settings.referenceImages) ? settings.referenceImages : [];
    updateSettings({ referenceImages: current.filter((u) => u !== url) });
  }, [settings.referenceImages, updateSettings]);

  /* 5.3: upscale / finish a generated image (charged 2 cr by the edge fn).
     Swaps the row's stored image to the higher-res one, then refreshes so the
     grid/lightbox show it. */
  const [upscalingId, setUpscalingId] = useState(null);
  const handleUpscale = useCallback(async (generation) => {
    const src = generation?.storage_path || generation?.output_url;
    if (!src) { toast.error("This image is no longer available."); return; }
    if (generation?.metadata?.upscaled) { toast("Already upscaled."); return; }
    setUpscalingId(generation.id);
    try {
      const { upscaleImage } = await import("../../services/media.service");
      await upscaleImage({ imageUrl: src, generationId: generation.id, requestId: crypto.randomUUID() });
      toast.success("Upscaled — higher resolution and cleaner.");
      if (activeSession?.id) await useSessionStore.getState().fetchGenerations(activeSession.id, { silent: true });
    } catch (err) {
      if (!applyRateLimit("upscale", err)) toast.error(err?.message || "Could not upscale this image.");
    } finally {
      setUpscalingId(null);
    }
  }, [activeSession?.id, applyRateLimit]);

  /* 6.3: regenerate every quality-flagged image in one go. Sequential so the
     per-item regenerating overlay reads correctly; each is charged. */
  const handleRegenerateFlagged = useCallback(async () => {
    for (const g of flaggedGenerations) {
      try {
        await regenerateVariant(g);
      } catch (err) {
        toast.error(err?.message || `Could not regenerate a flagged image.`);
        break; // stop on first failure (likely rate limit / credits)
      }
    }
  }, [flaggedGenerations, regenerateVariant]);

  /* 4.3: pin a generated image as a reference so future generations match it
     (a recurring product / character / style). Adds to the same
     referenceImages sink as 4.1's picker. */
  const handleAddAsReference = useCallback((generation) => {
    const url = generation?.storage_path || generation?.output_url || generation?.thumbnail_url;
    if (!url) { toast.error("This image is no longer available."); return; }
    const current = Array.isArray(settings.referenceImages) ? settings.referenceImages : [];
    if (current.includes(url)) { toast("Already a reference."); return; }
    if (current.length >= 6) { toast.error("Up to 6 reference images — remove one first."); return; }
    updateSettings({ referenceImages: [...current, url] });
    toast.success("Pinned as a reference for future generations.");
  }, [settings.referenceImages, updateSettings]);

  const toggleSlideSelected = useCallback((id) => {
    setSlideSelection((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const selectedSlideIds = useMemo(
    () => Object.keys(slideSelection).filter((id) => slideSelection[id]),
    [slideSelection]
  );

  const handleRegenerateSelectedSlides = useCallback(async () => {
    if (selectedSlideIds.length === 0) return;
    await regenerateSlides(selectedSlideIds);
    setSlideSelection({});
  }, [selectedSlideIds, regenerateSlides]);

  const handleSaveDraft = useCallback(async () => {
    setPublishing(true);
    try {
      const result = await saveDraft();
      toast.success(result?.message || "Saved as draft.");
      setStudioStage("brief");
    } catch (err) {
      toast.error(err?.message || "Could not save draft.");
    } finally {
      setPublishing(false);
    }
  }, [saveDraft]);

  const handleConfirmPublish = useCallback(async () => {
    setPublishing(true);
    try {
      const result = await publishContent();
      toast.success(result?.message || "Post queued (simulated).");
      setPublishConfirmOpen(false);
      setStudioStage("published");
    } catch (err) {
      toast.error(err?.message || "Could not publish post.");
    } finally {
      setPublishing(false);
    }
  }, [publishContent]);

  useEffect(() => {
    if (!scheduleOpen || !scheduleDate || !scheduleTime) {
      setScheduleConflict(false);
      return undefined;
    }
    let cancelled = false;
    checkScheduleConflict(new Date(`${scheduleDate}T${scheduleTime}`).toISOString()).then((hasConflict) => {
      if (!cancelled) setScheduleConflict(hasConflict);
    });
    return () => { cancelled = true; };
  }, [scheduleOpen, scheduleDate, scheduleTime, checkScheduleConflict]);

  const handleConfirmSchedule = useCallback(async () => {
    if (!scheduleDate || !scheduleTime) {
      toast.error("Pick a date and time.");
      return;
    }
    updatePostProduction({ scheduleDate: new Date(`${scheduleDate}T${scheduleTime}`).toISOString() });
    setPublishing(true);
    try {
      const result = await saveDraft();
      toast.success(
        result?.status === "scheduled"
          ? `Scheduled for ${scheduleDate} ${scheduleTime}`
          : result?.message || "Saved as draft."
      );
      setScheduleOpen(false);
      setStudioStage("brief");
    } catch (err) {
      toast.error(err?.message || "Could not schedule post.");
    } finally {
      setPublishing(false);
    }
  }, [scheduleDate, scheduleTime, updatePostProduction, saveDraft]);

  const userInitials = ((profile?.full_name ? profile.full_name[0] : "U") + (profile?.full_name?.split(" ")[1]?.[0] ?? "")).toUpperCase();
  const creditPct = credits.lifetimePurchased > 0 ? Math.max(0, Math.min(100, Math.round((credits.balance / credits.lifetimePurchased) * 100))) : 100;
  const shimmerCount = isCarousel ? (settings.slideCount === "auto" ? 6 : Number(settings.slideCount || 6)) : selectedMode === "image" ? Number(settings.batchSize || 1) : 1;
  const aspectRatio = settings.aspectRatio || "1:1";
  // Week 3 Fix 3: video submits-and-returns, so isGenerating clears within
  // seconds — it no longer reflects "is a video actually rendering." Any
  // job still queued/running (across the whole persistent list, not just
  // the most recently submitted one) keeps this indicator lit.
  const videoJobActive = videoJobs.some((job) => job.status === "queued" || job.status === "running");

  return (
    <>
      <AppHeader
        navItems={NAV_ITEMS}
        activeKey="studio"
        onNavClick={(item) => navigate(item.href)}
        onBurgerClick={() => setMobileNavOpen(true)}
        right={
          <>
            {videoJobActive && (
              <div className={styles.videoIndicator} title="Video renders server-side — safe to navigate away, close this tab, or refresh; it'll still be here in the Video jobs drawer when you come back">
                <span className={styles.loadingDot} />
                <span className={styles.videoIndicatorLabel} style={{ fontFamily: "var(--uiv2-font-mono)", fontSize: 11, color: "var(--uiv2-warning)" }}>
                  Video rendering…
                </span>
              </div>
            )}
            {credits.ready ? (
              <CreditPill pct={`${creditPct}%`} label={`${availableCredits.toLocaleString()} cr`} />
            ) : (
              <Skeleton width="76px" height="26px" radius="999px" />
            )}
            <IconButton title="Video jobs" onClick={() => setVideoJobsOpen(true)}>
              <VideoIcon size={15} />
            </IconButton>
            <ThemeToggleButton />
            <NotificationBell userId={user?.id} onNavigate={navigate} />
            <AvatarMenu initials={userInitials || "U"} name={profile?.full_name} email={user?.email} onNavigate={navigate} />
          </>
        }
      />

      <MobileNavDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        navItems={NAV_ITEMS}
        activeKey="studio"
        onNavClick={(item) => navigate(item.href)}
      />

      <main className={styles.main}>
        <div className={styles.canvas}>
          <div className={styles.studioGrid}>
            {/* ============ BRIEF PANEL ============ */}
            <div className={styles.brief}>
              <Card>
                <div className={styles.sectionLabel}>Mode</div>
                <div className={styles.modeRow}>
                  {CONTENT_TYPES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={[styles.modeChip, selectedMode === m.id ? styles.modeChipActive : ""].join(" ")}
                      onClick={() => handleModeChange(m.id)}
                    >
                      {MODE_ICON[m.id]} {m.label}
                    </button>
                  ))}
                </div>
              </Card>

              <Card>
                <div className={styles.promptHead}>
                  <span className={styles.sectionLabel} style={{ marginBottom: 0 }}>Prompt</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleEnhance}
                    disabled={enhancing || !prompt.trim() || isGenerating || getRateLimitRemaining("enhance") > 0}
                  >
                    <Sliders size={12} />
                    {getRateLimitRemaining("enhance") > 0
                      ? `Retry in ${getRateLimitRemaining("enhance")}s`
                      : enhancing ? "Enhancing…" : "Enhance prompt"}
                  </Button>
                </div>

                {needsSourceImage && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                      {sourceImageUrl ? (
                        <img
                          src={sourceImageUrl}
                          alt="Source"
                          style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover", flexShrink: 0, border: "1px solid var(--uiv2-border)" }}
                          onError={(e) => { e.currentTarget.style.display = "none"; }}
                        />
                      ) : null}
                      <input
                        className={styles.fieldInput}
                        style={{ flex: 1 }}
                        placeholder="Source image URL, or pick from your Library →"
                        value={sourceImageUrl}
                        onChange={(e) => setSourceImageUrl(e.target.value)}
                      />
                      <Button variant="subtle" size="sm" onClick={openSourcePicker} style={{ flexShrink: 0 }}>
                        Pick
                      </Button>
                    </div>
                  </div>
                )}

                {guided ? (
                  <div className={styles.guidedGrid}>
                    {["subject", "setting", "style", "mood"].map((key) => (
                      <label key={key} className={styles.field}>
                        <span className={styles.fieldLabel}>{key[0].toUpperCase() + key.slice(1)}</span>
                        <input
                          className={styles.fieldInput}
                          value={guidedFields[key]}
                          onChange={(e) => setGuidedFields((g) => ({ ...g, [key]: e.target.value }))}
                        />
                      </label>
                    ))}
                  </div>
                ) : (
                  <textarea
                    ref={promptRef}
                    className={styles.textarea}
                    maxLength={PROMPT_LIMIT}
                    placeholder="Describe the post you want — subject, setting, mood."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_LIMIT))}
                  />
                )}
                <div className={styles.promptFoot}>
                  <span className={styles.promptCount}>{prompt.length} / {PROMPT_LIMIT.toLocaleString()}</span>
                  <button type="button" className={styles.linkBtn} onClick={() => setGuided((g) => !g)}>
                    {guided ? "Use freeform prompt" : "Use guided fields"}
                  </button>
                </div>
              </Card>

              <Card>
                <div className={styles.sectionLabel}>Format</div>
                <div className={styles.formatBlock}>
                  <span className={styles.formatSubLabel}>Aspect ratio</span>
                  <div className={styles.formatRow}>
                    {ASPECT_RATIOS.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className={[styles.formatChip, aspectRatio === r.id ? styles.formatChipActive : ""].join(" ")}
                        onClick={() => updateSettings({ aspectRatio: r.id })}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                {(selectedMode === "image" || isCarousel) && (
                  <div className={styles.formatBlock}>
                    <span className={styles.formatSubLabel}>Image style</span>
                    <div className={styles.formatRow}>
                      {IMAGE_MODEL_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          title={opt.hint}
                          className={[styles.formatChip, (settings.imageModel || "auto") === opt.id ? styles.formatChipActive : ""].join(" ")}
                          onClick={() => updateSettings({ imageModel: opt.id })}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <span className={styles.formatSubLabel} style={{ marginTop: 4, opacity: 0.8 }}>
                      {IMAGE_MODEL_OPTIONS.find((o) => o.id === (settings.imageModel || "auto"))?.hint}
                    </span>
                  </div>
                )}

                {selectedMode === "image" && (
                  <div className={styles.formatBlock}>
                    <div className={styles.stepperRow}>
                      <span className={styles.formatSubLabel}>Batch size</span>
                      <div className={styles.stepperCtl}>
                        <button type="button" className={styles.stepperBtn} onClick={() => updateSettings({ batchSize: Math.max(1, (settings.batchSize || 1) - 1) })}>−</button>
                        <span className={styles.stepperVal}>{settings.batchSize || 1}</span>
                        <button type="button" className={styles.stepperBtn} onClick={() => updateSettings({ batchSize: Math.min(4, (settings.batchSize || 1) + 1) })}>+</button>
                      </div>
                    </div>
                  </div>
                )}

                {isCarousel && (
                  <div className={styles.formatBlock}>
                    <div className={styles.stepperRow}>
                      <span className={styles.formatSubLabel}>Slide count</span>
                      <div className={styles.stepperCtl}>
                        <button type="button" className={styles.stepperBtn} onClick={() => updateSettings({ slideCount: Math.max(2, Number(settings.slideCount || 6) - 1) })}>−</button>
                        <span className={styles.stepperVal}>{settings.slideCount === "auto" ? "auto" : settings.slideCount || 6}</span>
                        <button type="button" className={styles.stepperBtn} onClick={() => updateSettings({ slideCount: Math.min(10, Number(settings.slideCount || 6) + 1) })}>+</button>
                      </div>
                    </div>
                  </div>
                )}

                {isVideoMode && (
                  <div className={styles.formatBlock}>
                    <span className={styles.formatSubLabel}>Duration</span>
                    <div className={styles.formatRow}>
                      {getVideoDurations().map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={[styles.formatChip, Number(settings.duration) === d ? styles.formatChipActive : ""].join(" ")}
                          onClick={() => updateSettings({ duration: d })}
                        >
                          {d}s
                        </button>
                      ))}
                    </div>
                    <span className={styles.formatSubLabel} style={{ marginTop: 4 }}>Quality</span>
                    <div className={styles.formatRow}>
                      {VIDEO_QUALITY_TIERS.map((tier) => (
                        <button
                          key={tier.id}
                          type="button"
                          title={tier.hint}
                          className={[styles.formatChip, (settings.videoQuality || "standard") === tier.id ? styles.formatChipActive : ""].join(" ")}
                          onClick={() => updateSettings({ videoQuality: tier.id })}
                        >
                          {tier.label}
                        </button>
                      ))}
                    </div>
                    {(settings.videoQuality || "standard") === "standard" && selectedMode === "video" && !sourceImageUrl && (
                      <span className={styles.formatSubLabel} style={{ marginTop: 4, opacity: 0.8 }}>
                        Standard requires a source image — without one this renders at premium quality and is billed accordingly.
                      </span>
                    )}
                  </div>
                )}
              </Card>

              <Card>
                <label className={styles.toggleRow} onClick={() => setApplyBrandKit((v) => !v)}>
                  <span className={styles.toggleCopy}>
                    <span className={styles.toggleTitle}>Match my brand kit</span>
                    <span className={styles.toggleSub}>Applies your saved voice, colors, and tone</span>
                  </span>
                  <span
                    className={styles.toggleTrack}
                    style={{ background: applyBrandKit ? "var(--uiv2-accent-solid)" : "var(--uiv2-border-strong)" }}
                  >
                    <span className={styles.toggleKnob} style={{ left: applyBrandKit ? "18px" : "2px" }} />
                  </span>
                </label>
                {brandKit?.raw?.brand_colors?.length > 0 && (
                  <div className={styles.swatchRow}>
                    {brandKit.raw.brand_colors.slice(0, 6).map((c, i) => (
                      <span key={i} className={styles.swatch} style={{ background: c }} />
                    ))}
                  </div>
                )}
                {!brandKit?.setup_completed && (
                  <div style={{ marginTop: 10 }}>
                    <button type="button" className={styles.linkBtn} onClick={() => navigate("/app/settings/brand-kit")}>
                      Set up brand kit →
                    </button>
                  </div>
                )}
              </Card>

              {(selectedMode === "image" || isCarousel) && (
                <Card>
                  <div className={styles.sectionLabel}>Reference images</div>
                  <span style={{ fontSize: 11.5, color: "var(--uiv2-text-secondary)", display: "block", marginBottom: 8 }}>
                    Match the look of images you pick — keep a product, character, or style consistent. Renders on the photo engine.
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(settings.referenceImages || []).map((url) => (
                      <div key={url} style={{ position: "relative", width: 52, height: 52 }}>
                        <img src={url} alt="Reference" style={{ width: 52, height: 52, borderRadius: 6, objectFit: "cover", border: "1px solid var(--uiv2-border)" }} onError={(e) => { e.currentTarget.style.opacity = "0.3"; }} />
                        <button
                          type="button"
                          onClick={() => removeReferenceImage(url)}
                          aria-label="Remove reference"
                          style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 999, border: "none", cursor: "pointer", background: "var(--uiv2-surface-raised, #1c1c1e)", color: "var(--uiv2-text-primary)", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", fontSize: 12, lineHeight: "16px" }}
                        >×</button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => openSourcePicker("reference")}
                      style={{ width: 52, height: 52, borderRadius: 6, border: "1px dashed var(--uiv2-border-strong)", background: "transparent", color: "var(--uiv2-text-secondary)", cursor: "pointer", fontSize: 20 }}
                      title="Add a reference image"
                    >+</button>
                  </div>
                  {(settings.referenceImages || []).length > 0 && (
                    <label className={styles.toggleRow} style={{ marginTop: 12 }} onClick={() => {
                      const next = !settings.styleLock;
                      updateSettings({ styleLock: next });
                      // 4.2: persist the reference set so it rides along on every
                      // future generation (style-lock), via Content Defaults.
                      if (user?.id) {
                        import("../../services/userSettingsService").then(({ saveUserSettings }) => {
                          saveUserSettings(user.id, {
                            generationDefaults: {
                              style_lock: next,
                              reference_images: next ? (settings.referenceImages || []) : [],
                            },
                          }).catch(() => {});
                        });
                      }
                    }}>
                      <span className={styles.toggleCopy}>
                        <span className={styles.toggleTitle}>Keep for every generation</span>
                        <span className={styles.toggleSub}>Match my feed — reuse these across sessions</span>
                      </span>
                      <span className={styles.toggleTrack} style={{ background: settings.styleLock ? "var(--uiv2-accent-solid)" : "var(--uiv2-border-strong)" }}>
                        <span className={styles.toggleKnob} style={{ left: settings.styleLock ? "18px" : "2px" }} />
                      </span>
                    </label>
                  )}
                </Card>
              )}

              <Card>
                <div className={styles.sectionLabel}>Target platforms</div>
                {accountsLoading ? (
                  <Skeleton height="30px" />
                ) : accounts.length === 0 ? (
                  <span style={{ fontSize: 12, color: "var(--uiv2-text-secondary)" }}>
                    No accounts connected —{" "}
                    <button type="button" className={styles.linkBtn} onClick={() => navigate("/app/settings")}>connect one</button>.
                  </span>
                ) : (
                  <div className={styles.formatRow}>
                    {accounts.map((a) => {
                      const on = (postProduction.selectedPlatforms || []).includes(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          className={[styles.formatChip, on ? styles.formatChipActive : ""].join(" ")}
                          style={{ fontFamily: "var(--uiv2-font-body)" }}
                          onClick={() => {
                            const cur = postProduction.selectedPlatforms || [];
                            updatePostProduction({ selectedPlatforms: cur.includes(a.id) ? cur.filter((x) => x !== a.id) : [...cur, a.id] });
                          }}
                        >
                          {a.display_name || a.account_name || a.platform}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>

              <Card>
                <div className={styles.costRow}>
                  <span className={styles.costLabel}>This generation</span>
                  <span className={styles.costValue} style={{ color: canAfford ? "var(--uiv2-text-primary)" : "var(--uiv2-danger)" }}>{cost} credits</span>
                </div>
                {!canAfford && (
                  <div className={styles.errorBox} style={{ padding: "9px 10px", marginBottom: 10, gap: 8 }}>
                    <span className={styles.errorText}>Not enough credits — you need {cost} but have {availableCredits}.</span>
                  </div>
                )}
                <Button
                  onClick={handleGenerate}
                  disabled={!prompt.trim() || !canAfford || isGenerating || getRateLimitRemaining("generate") > 0}
                  style={{ width: "100%" }}
                >
                  <Sparkles size={14} aria-hidden="true" />
                  {getRateLimitRemaining("generate") > 0
                    ? `Retry in ${getRateLimitRemaining("generate")}s`
                    : isGenerating ? "Generating…" : `Generate${shimmerCount > 1 ? ` ${shimmerCount} variants` : ""}`}
                </Button>
                {/* ADDENDUM UPGRADE 4: replaces Week 1 Fix 5's disable-only
                    fix. When a generation is selected, behaves exactly as
                    before (saveDraft, a post-level draft). When none is
                    selected, this now genuinely saves the typed prompt +
                    current settings onto the session (saveDraftPrompt) —
                    the promptless "save my brief for later" feature the
                    button's label always implied but never did. Only
                    disabled when there is truly nothing to save either
                    way. */}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!selectedGeneration && !prompt.trim()}
                  title={selectedGeneration || prompt.trim() ? undefined : "Type a prompt or generate first"}
                  onClick={async () => {
                    try {
                      if (selectedGeneration) {
                        await saveDraft();
                        toast.success("Saved as draft");
                      } else {
                        await saveDraftPrompt(prompt);
                        toast.success("Draft saved to this session");
                      }
                    } catch (err) {
                      toast.error(err?.message || "Could not save draft");
                    }
                  }}
                  style={{ width: "100%", marginTop: 4 }}
                >
                  Save as draft without generating
                </Button>
              </Card>
            </div>

            {/* ============ CANVAS PANEL ============ */}
            <div className={styles.canvasCol}>
              <div className={styles.canvasHead}>
                <div style={{ minWidth: 0 }}>
                  <div className={styles.sessionTitle}>{activeSession?.title || "Untitled session"}</div>
                  <div className={styles.sessionMeta}>
                    {CONTENT_TYPES.find((m) => m.id === selectedMode)?.label} · {aspectRatio}
                  </div>
                </div>
                <Button variant="subtle" onClick={() => setHistoryOpen(true)}>
                  <HistoryIcon size={14} aria-hidden="true" /> Session history
                </Button>
              </div>

              {(localError || error) && (
                <div className={styles.errorBox} role="alert">
                  <div style={{ flex: 1 }}>
                    <div className={styles.errorTitle}>Generation failed</div>
                    <div className={styles.errorText}>{localError || error}</div>
                  </div>
                  <Button variant="dangerSolid" size="sm" onClick={handleGenerate}>Retry</Button>
                </div>
              )}

              {studioStage === "generating" && (
                <Card>
                  <div className={styles.loadingHead}>
                    <span className={styles.loadingDot} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{isVideoMode ? "Queued for processing" : "Generating your variants"}</span>
                    <span className={styles.loadingSub}>{progressLabel || (isVideoMode ? "Usually 2–4 minutes" : "Usually about 20 seconds")}</span>
                  </div>
                  <div className={styles.loadingBar}>
                    <div className={styles.loadingBarFill} style={{ width: `${Math.round(generationProgress)}%` }} />
                  </div>
                  <div className={styles.variantGrid}>
                    {Array.from({ length: Math.max(2, Math.min(4, shimmerCount)) }, (_, i) => (
                      <Skeleton key={i} height="168px" radius="8px" style={{ aspectRatio: aspectRatio.replace(":", "/") }} />
                    ))}
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleCancelGenerate} style={{ marginTop: 14 }}>Cancel</Button>
                </Card>
              )}

              {/* 6.3: quality-flagged bulk regenerate */}
              {(studioStage === "brief" || studioStage === "results") && flaggedGenerations.length > 0 && (
                <Card style={{ borderColor: "var(--uiv2-danger, #c0392b)" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {flaggedGenerations.length} image{flaggedGenerations.length > 1 ? "s" : ""} flagged by the quality check
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--uiv2-text-secondary)", marginTop: 4 }}>
                    The quality check found likely issues (garbled text, artifacts, wrong crop). Regenerating re-rolls each one — this spends credits.
                  </div>
                  <Button
                    size="sm"
                    variant="subtle"
                    style={{ marginTop: 10 }}
                    onClick={handleRegenerateFlagged}
                    disabled={flaggedGenerations.some((g) => regeneratingIds.includes(g.id))}
                  >
                    Regenerate {flaggedGenerations.length} flagged
                  </Button>
                </Card>
              )}

              {(studioStage === "brief" || studioStage === "results") && lastBatchOutcome && lastBatchOutcome.failedCount > 0 && (
                <Card style={{ borderColor: "var(--uiv2-warning, #b98900)" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {lastBatchOutcome.succeededCount} of {lastBatchOutcome.totalCount} {lastBatchOutcome.kind === "carousel" ? "slides" : "variants"} completed
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--uiv2-text-secondary)", marginTop: 4 }}>
                    {lastBatchOutcome.failedCount} failed to render. Retrying only re-runs the failed ones — credits already spent on the successful ones are not charged again.
                  </div>
                  {lastBatchOutcome.kind === "image" && lastBatchOutcome.failedSlots?.length > 0 && (
                    <Button
                      size="sm"
                      variant="subtle"
                      style={{ marginTop: 10 }}
                      onClick={() => retryFailedVariants(prompt.trim())}
                    >
                      Retry failed only
                    </Button>
                  )}
                  {lastBatchOutcome.kind === "carousel" && lastBatchOutcome.failedSlots?.length > 0 && (
                    <Button
                      size="sm"
                      variant="subtle"
                      style={{ marginTop: 10 }}
                      onClick={handleGenerate}
                    >
                      Regenerate whole carousel
                    </Button>
                  )}
                </Card>
              )}

              {(studioStage === "brief" || studioStage === "results") && completedGenerations.length > 0 && (
                isCarousel ? (
                  <Card>
                    <div style={{ fontSize: 12.5, color: "var(--uiv2-text-secondary)", marginBottom: 12 }}>
                      Click a slide to preview it full-size. Check the ones you want redone.
                    </div>
                    <div className={styles.filmstrip}>
                      {completedGenerations.map((g, i) => (
                        <div key={g.id} className={styles.filmSlide}>
                          <div
                            className={[styles.filmThumb, selectedGenerationId === g.id ? styles.filmThumbSelected : ""].join(" ")}
                            onClick={() => openLightbox(g)}
                          >
                            {(g.storage_path || g.output_url || g.thumbnail_url) && !failedThumbIds.has(g.id) ? (
                              <img className={styles.variantImg} src={g.storage_path || g.output_url || g.thumbnail_url} alt="" onError={() => markThumbFailed(g.id)} />
                            ) : (
                              <span className={styles.variantLabel}>Slide {i + 1}</span>
                            )}
                            <QualityFlag quality={g.metadata?.quality} />
                            <button
                              type="button"
                              className={[styles.filmCheck, slideSelection[g.id] ? styles.filmCheckOn : ""].join(" ")}
                              onClick={(e) => { e.stopPropagation(); toggleSlideSelected(g.id); }}
                              aria-label={slideSelection[g.id] ? `Deselect slide ${i + 1}` : `Select slide ${i + 1} for regeneration`}
                            >
                              {slideSelection[g.id] && (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#17181B" strokeWidth="3.4"><path d="M5 12l5 5 9-11" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              )}
                            </button>
                            {regeneratingIds.includes(g.id) && (
                              <div className={styles.regeneratingOverlay}><span className={styles.regeneratingDot} /></div>
                            )}
                          </div>
                          <div className={styles.filmCaption}>Slide {i + 1}</div>
                        </div>
                      ))}
                    </div>
                    <div className={styles.searchRow}>
                      <Button
                        variant="subtle"
                        onClick={handleRegenerateSelectedSlides}
                        disabled={selectedSlideIds.length === 0 || isGenerating || selectedSlideIds.some((id) => regeneratingIds.includes(id))}
                      >
                        {selectedSlideIds.length > 0 ? `Regenerate ${selectedSlideIds.length} selected slide${selectedSlideIds.length > 1 ? "s" : ""}` : "Regenerate selected slides"}
                      </Button>
                      <Button
                        variant="subtle"
                        onClick={handleGenerate}
                        disabled={!prompt.trim() || !canAfford || isGenerating || getRateLimitRemaining("generate") > 0}
                      >
                        {getRateLimitRemaining("generate") > 0
                          ? `Retry in ${getRateLimitRemaining("generate")}s`
                          : `Regenerate whole carousel · ${cost} credits`}
                      </Button>
                      <Button style={{ marginLeft: "auto" }} onClick={() => handleGoToPublish(completedGenerations[0])}>Use this carousel</Button>
                    </div>
                  </Card>
                ) : (
                  <div className={styles.variantGrid}>
                    {completedGenerations.map((g, i) => (
                      <div
                        key={g.id}
                        className={[styles.variantCard, selectedGenerationId === g.id ? styles.variantCardSelected : ""].join(" ")}
                        style={{ aspectRatio: aspectRatio.replace(":", "/") }}
                        onClick={() => selectGeneration(g)}
                      >
                        {(g.storage_path || g.output_url || g.thumbnail_url) && !failedThumbIds.has(g.id) ? (
                          g.media_type === "video" ? (
                            <video className={styles.variantImg} src={g.storage_path || g.output_url} muted onError={() => markThumbFailed(g.id)} />
                          ) : (
                            <img className={styles.variantImg} src={g.storage_path || g.output_url || g.thumbnail_url} alt="" onError={() => markThumbFailed(g.id)} />
                          )
                        ) : (
                          <span className={styles.variantLabel}>V{i + 1}</span>
                        )}
                        <QualityFlag quality={g.metadata?.quality} />
                        {selectedGenerationId === g.id && (
                          <span className={styles.variantBadge}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#17181B" strokeWidth="3"><path d="M5 12l5 5 9-11" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </span>
                        )}
                        <div className={styles.variantHover}>
                          <span className={styles.variantChip}>Use this</span>
                          <span style={{ display: "flex", gap: 5 }}>
                            <button type="button" className={styles.variantIconBtn} onClick={(e) => { e.stopPropagation(); openLightbox(g); }} title="View maximized">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>
                            <button
                              type="button"
                              className={styles.variantIconBtn}
                              onClick={(e) => { e.stopPropagation(); handleRegenerateVariant(g); }}
                              disabled={regeneratingIds.includes(g.id)}
                              title="Regenerate this variant"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-7 3L3 8" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>
                            {g.media_type !== "video" && (
                              <>
                                <button type="button" className={styles.variantIconBtn} onClick={(e) => { e.stopPropagation(); handleUseAsSource(g, "edit"); }} title="Edit this image with a prompt">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" strokeLinecap="round" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                </button>
                                <button type="button" className={styles.variantIconBtn} onClick={(e) => { e.stopPropagation(); handleUseAsSource(g, "image-to-video"); }} title="Animate this image into a video">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3" strokeLinejoin="round" /></svg>
                                </button>
                              </>
                            )}
                          </span>
                        </div>
                        {g.metadata?.quality?.verdict === "fail" && !regeneratingIds.includes(g.id) && (
                          <button
                            type="button"
                            className={styles.qualityRegenBar}
                            onClick={(e) => { e.stopPropagation(); handleRegenerateVariant(g); }}
                            title={(g.metadata.quality.flags || []).join(" · ") || "Quality check flagged issues"}
                            style={{
                              position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 3,
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                              padding: "7px 10px", border: "none", cursor: "pointer",
                              fontSize: 11.5, fontWeight: 600, color: "#fff",
                              background: "linear-gradient(to top, rgba(192,57,43,0.96), rgba(192,57,43,0.82))",
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-7 3L3 8" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            Regenerate ({IMAGE_REGEN_COST} cr)
                          </button>
                        )}
                        {regeneratingIds.includes(g.id) && (
                          <div className={styles.regeneratingOverlay}><span className={styles.regeneratingDot} /></div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}

              {studioStage !== "generating" && completedGenerations.length > 0 && studioStage !== "publish" && studioStage !== "published" && (
                <Button onClick={() => handleGoToPublish(selectedGeneration || completedGenerations[0])} style={{ alignSelf: "flex-start" }}>
                  Continue to post production →
                </Button>
              )}

              {completedGenerations.length === 0 && studioStage === "brief" && (
                <EmptyState title="Nothing generated yet" description="Describe what you want on the left, then hit Generate." dashed />
              )}

              {(studioStage === "publish" || studioStage === "published") && (selectedGeneration || completedGenerations[0]) && (
                <Card padding="none" style={{ overflow: "hidden" }}>
                  {(() => {
                    const gen = selectedGeneration || completedGenerations[0];
                    const src = gen?.storage_path || gen?.output_url || gen?.thumbnail_url;
                    const failed = gen && publishPreviewFailedId === gen.id;
                    if (!src || failed) {
                      return (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "64px 24px", color: "var(--uiv2-text-secondary)", fontSize: 13, textAlign: "center" }}>
                          {src ? "This media is no longer available" : "No media for this generation"}
                        </div>
                      );
                    }
                    return gen.media_type === "video" ? (
                      <video src={src} controls style={{ width: "100%", maxHeight: 480, display: "block", background: "#000" }} onError={() => setPublishPreviewFailedId(gen.id)} />
                    ) : (
                      <img src={src} alt="Selected generation" style={{ width: "100%", maxHeight: 480, objectFit: "contain", display: "block" }} onError={() => setPublishPreviewFailedId(gen.id)} />
                    );
                  })()}
                </Card>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Post production / publish */}
      {(studioStage === "publish" || studioStage === "published") && (
        <PostProductionPanel
          published={studioStage === "published"}
          selectedGeneration={selectedGeneration || completedGenerations[0]}
          postProduction={postProduction}
          updatePostProduction={updatePostProduction}
          publishing={publishing}
          accounts={accounts}
          onSaveDraft={handleSaveDraft}
          onOpenSchedule={() => setScheduleOpen(true)}
          onOpenPublishConfirm={() => setPublishConfirmOpen(true)}
          onClose={() => setStudioStage("results")}
          onGenerateAnother={() => setStudioStage("brief")}
          onRegenerateMetadata={handleRegenerateMetadata}
          onRescore={handleRescore}
          metadataRetryAfter={getRateLimitRemaining("regenerateMetadata")}
          seoRetryAfter={getRateLimitRemaining("rescore")}
        />
      )}

      {/* Schedule dialog */}
      <Modal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        size="md"
        title="Schedule this post"
        description="It'll appear on your calendar and publish automatically at the chosen time."
        actions={
          <>
            <Button variant="ghost" onClick={() => setScheduleOpen(false)}>Cancel</Button>
            <Button
              onClick={handleConfirmSchedule}
              disabled={publishing || (postProduction.selectedPlatforms || []).length === 0}
              title={(postProduction.selectedPlatforms || []).length === 0 ? "Pick a target platform in the brief panel first" : undefined}
            >
              Confirm schedule
            </Button>
          </>
        }
      >
        <div className={styles.dialogFieldRow}>
          <label className={styles.dialogField}>
            <span className={styles.fieldLabel}>Date</span>
            <input type="date" className={styles.dialogInput} value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
          </label>
          <label className={styles.dialogField}>
            <span className={styles.fieldLabel}>Time</span>
            <input type="time" className={styles.dialogInput} value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
          </label>
        </div>
        {(postProduction.selectedPlatforms || []).length === 0 && (
          <div className={styles.errorBox} style={{ marginTop: 12 }}>
            <span className={styles.errorText}>
              No target platform selected — go back and pick one in "Target platforms" first, or this post can never actually publish.
            </span>
          </div>
        )}
        {scheduleConflict && (
          <div className={styles.errorBox} style={{ marginTop: 12, background: "var(--uiv2-warning-wash)", borderColor: "var(--uiv2-warning-border)" }}>
            <span className={styles.errorText}>
              This account already has a post scheduled at this time. You can still schedule this one — nothing will be overwritten.
            </span>
          </div>
        )}
      </Modal>

      {/* Publish confirm */}
      <Modal
        open={publishConfirmOpen}
        onClose={() => setPublishConfirmOpen(false)}
        size="sm"
        title="Publish now?"
        description="This posts immediately (simulated). Unlike a draft, this can't be undone from here."
        actions={
          <>
            <Button variant="ghost" onClick={() => setPublishConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirmPublish} disabled={publishing}>{publishing ? "Publishing…" : "Publish now"}</Button>
          </>
        }
      />

      {/* Video jobs panel — Week 3 Fix 3: real, persistent, multi-job history
          (background_jobs table, survives refresh/tab-close), not the old
          single in-memory slot. */}
      <Drawer open={videoJobsOpen} onClose={() => setVideoJobsOpen(false)} title="Video jobs" width="min(380px, 92vw)">
        <div style={{ fontSize: 11.5, color: "var(--uiv2-text-tertiary)", marginBottom: 8 }}>
          Video jobs keep processing here even if you leave Studio or close this tab — reopen later and they'll still be here.
        </div>
        {videoJobs.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {videoJobs.map((job) => (
              <div key={job.id} className={styles.videoJobRow}>
                <div className={styles.videoJobHead}>
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{(job.prompt || "Video job").slice(0, 40)}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--uiv2-font-mono)", fontSize: 10.5, color: job.status === "failed" ? "var(--uiv2-danger)" : "var(--uiv2-warning)" }}>
                    <span className={styles.statusDot} style={{ background: job.status === "completed" ? "var(--uiv2-success, #2a9d5c)" : job.status === "failed" ? "var(--uiv2-danger)" : "var(--uiv2-warning)" }} />
                    {job.status}
                  </span>
                </div>
                {(job.status === "queued" || job.status === "running") && (
                  <>
                    <div
                      className={styles.videoJobBarTrack}
                      title={job.status === "queued" ? "Queued" : "Rendering — the provider doesn't report a percentage"}
                    >
                      <span className={styles.videoJobBarIndeterminate} style={{ opacity: job.status === "running" ? 1 : 0.4 }} />
                    </div>
                    <Button size="sm" variant="subtle" onClick={() => cancelVideoJob(job.id)}>Cancel job</Button>
                  </>
                )}
                {job.status === "failed" && (
                  <div style={{ fontSize: 11.5, color: "var(--uiv2-text-secondary)" }}>{job.errorMessage || "Failed — credits were refunded."}</div>
                )}
                {job.status === "completed" && (
                  <Button size="sm" onClick={() => setVideoJobsOpen(false)}>View result</Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No video jobs" description="Video runs will show up here while processing." />
        )}
      </Drawer>

      {/* Floating minimized pill — shown when a video job is active but the
          drawer isn't open and the tab isn't otherwise on it. Now meaningful
          (the drawer is real), unlike the old dead setVideoJobMinimized. */}
      {videoJobState.isMinimized && (videoJobState.status === "processing" || videoJobState.status === "submitting") && !videoJobsOpen && (
        <button
          type="button"
          onClick={() => { setVideoJobMinimized(false); setVideoJobsOpen(true); }}
          style={{
            position: "fixed", bottom: 20, right: 20, zIndex: 40,
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 16px", borderRadius: 999,
            background: "var(--uiv2-surface-raised, #1c1c1e)", color: "var(--uiv2-text-primary)",
            border: "1px solid var(--uiv2-border)", boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
            cursor: "pointer", fontSize: 12.5,
          }}
        >
          <span className={styles.statusDot} style={{ background: "var(--uiv2-warning)" }} />
          Video rendering…
        </button>
      )}

      {/* Session history */}
      <SessionHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessions={sessions}
        projects={projects}
        activeSession={activeSession}
        loading={sessionsLoading || projectsLoading}
        onResume={(s) => {
          // URL is the source of truth for the active session — navigate
          // and let GeneratePageV2's URL-driven init effect perform the
          // load, rather than loading here directly. Keeps exactly one
          // session-loading mechanism and keeps the URL in sync so a
          // refresh lands on the same session.
          navigate(`/app/generate/${s.id}`);
          setHistoryOpen(false);
        }}
        onNewSession={async (projectId) => {
          const created = await createNewSession("New session", { projectId });
          setHistoryOpen(false);
          setStudioStage("brief");
          if (created?.id) navigate(`/app/generate/${created.id}`);
        }}
        onRenameSession={(id, title) => updateSessionTitle(id, title)}
        onRequestDeleteSession={(s) => setDeleteSessionTarget(s)}
        onCreateProject={async (name, color) => {
          try {
            return await createProject(name, color);
          } catch (err) {
            toast.error(err?.message || "Could not create project");
            return null;
          }
        }}
        onRenameProject={async (id, name) => {
          try {
            await renameProject(id, name);
          } catch (err) {
            toast.error(err?.message || "Could not rename project");
          }
        }}
        onRequestDeleteProject={(p) => setDeleteProjectTarget(p)}
        onReorderProjects={async (orderedIds) => {
          try {
            await reorderProjects(orderedIds);
          } catch (err) {
            toast.error(err?.message || "Could not reorder projects");
          }
        }}
      />

      <Modal
        open={!!deleteSessionTarget}
        onClose={() => setDeleteSessionTarget(null)}
        size="sm"
        title="Delete this session?"
        description={`"${deleteSessionTarget?.title || "Untitled session"}" and its generations will be removed. This can't be undone.`}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleteSessionTarget(null)}>Cancel</Button>
            <Button
              variant="dangerSolid"
              onClick={async () => {
                const wasActive = activeSession?.id === deleteSessionTarget.id;
                await deleteSession(deleteSessionTarget.id);
                setDeleteSessionTarget(null);
                toast.success("Session deleted");
                // Keep the URL in sync — deleting the session currently open
                // (the store already clears activeSession/activeGenerations
                // for this case) must not leave the address bar pointing at
                // a session that no longer exists.
                if (wasActive) navigate("/app/generate");
              }}
            >
              Delete session
            </Button>
          </>
        }
      />

      <Modal
        open={!!deleteProjectTarget}
        onClose={() => setDeleteProjectTarget(null)}
        size="sm"
        title="Delete this project?"
        description={`Sessions in "${deleteProjectTarget?.name || "this project"}" will move to General — nothing is deleted. This can't be undone.`}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleteProjectTarget(null)}>Cancel</Button>
            <Button
              variant="dangerSolid"
              onClick={async () => {
                try {
                  await deleteProject(deleteProjectTarget.id);
                  toast.success("Project deleted");
                } catch (err) {
                  toast.error(err?.message || "Could not delete project");
                } finally {
                  setDeleteProjectTarget(null);
                }
              }}
            >
              Delete project
            </Button>
          </>
        }
      />

      {/* 5.1: first-frame approval for text-to-video */}
      <Modal
        open={framePhase === "generating" || framePhase === "review" || framePhase === "animating"}
        onClose={framePhase === "review" ? handleCancelFrame : undefined}
        size="md"
        title="Approve the first frame"
        description="This still is the frame your video animates from. Approve it or regenerate before spending the video credits."
        actions={framePhase === "review" ? (
          <>
            <Button variant="ghost" onClick={handleCancelFrame}>Cancel</Button>
            <Button variant="subtle" onClick={handleRegenerateFrame}>Regenerate frame</Button>
            <Button onClick={handleApproveFrame}>Approve &amp; animate</Button>
          </>
        ) : undefined}
      >
        <div style={{ display: "flex", justifyContent: "center", minHeight: 200 }}>
          {framePhase === "generating" ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "40px 0" }}>
              <span className={styles.loadingDot} />
              <span style={{ fontSize: 13, color: "var(--uiv2-text-secondary)" }}>Rendering the first frame…</span>
            </div>
          ) : framePhase === "animating" ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "40px 0" }}>
              <span className={styles.loadingDot} />
              <span style={{ fontSize: 13, color: "var(--uiv2-text-secondary)" }}>Queuing the animation…</span>
            </div>
          ) : pendingFrame?.url ? (
            <img src={pendingFrame.url} alt="First frame" style={{ maxWidth: "100%", maxHeight: "48vh", borderRadius: 8, objectFit: "contain" }} />
          ) : null}
        </div>
      </Modal>

      {/* 5.2: carousel storyboard approval */}
      <Modal
        open={Boolean(pendingCarousel)}
        onClose={cancelPendingCarousel}
        size="lg"
        title="Review your carousel plan"
        description={`${pendingCarousel?.storyboard?.length || 0} slides · ${cost} credits to render. Approve to generate, or cancel — nothing is charged until you approve.`}
        actions={
          <>
            <Button variant="ghost" onClick={cancelPendingCarousel}>Cancel</Button>
            <Button onClick={handleApproveCarousel} disabled={isGenerating}>
              {isGenerating ? "Rendering…" : `Approve & render · ${cost} cr`}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "56vh", overflowY: "auto" }}>
          {(pendingCarousel?.storyboard || []).map((slide) => (
            <div key={slide.index} style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 8, background: "var(--uiv2-surface-sunken, rgba(255,255,255,0.03))", border: "1px solid var(--uiv2-border)" }}>
              <span style={{ fontFamily: "var(--uiv2-font-mono)", fontSize: 12, color: "var(--uiv2-text-tertiary)", flexShrink: 0, width: 20 }}>{slide.index}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{slide.headline}</span>
                  {slide.purpose && <span style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--uiv2-accent-solid, #d97757)" }}>{slide.purpose}</span>}
                </div>
                {slide.body && <div style={{ fontSize: 12, color: "var(--uiv2-text-secondary)", marginTop: 3 }}>{slide.body}</div>}
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* 3.2: Library source picker */}
      <Modal
        open={sourcePickerOpen}
        onClose={() => setSourcePickerOpen(false)}
        size="lg"
        title={pickerMode === "reference" ? "Add reference images" : "Pick a source image"}
        description={pickerMode === "reference"
          ? "Tap images to match their look. Add several, then close when done."
          : "Choose one of your generated images to edit or animate."}
        actions={pickerMode === "reference" ? (
          <Button onClick={() => setSourcePickerOpen(false)}>Done</Button>
        ) : undefined}
      >
        {sourcePickerLoading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
            {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} height="96px" radius="8px" />)}
          </div>
        ) : sourcePickerItems.length === 0 ? (
          <EmptyState title="No images yet" description="Generate an image first, then you can edit or animate it." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8, maxHeight: "56vh", overflowY: "auto" }}>
            {sourcePickerItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handlePickSource(item)}
                title={item.prompt || "Use this image"}
                style={{
                  padding: 0, border: "1px solid var(--uiv2-border)", borderRadius: 8,
                  overflow: "hidden", cursor: "pointer", aspectRatio: "1/1", background: "var(--uiv2-surface-sunken, #1a1a1c)",
                }}
              >
                <img src={item.storage_path} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={(e) => { e.currentTarget.style.opacity = "0.2"; }} />
              </button>
            ))}
          </div>
        )}
      </Modal>

      {lightboxOpen && lightboxGeneration && (
        <StudioLightbox
          generation={lightboxGeneration}
          index={lightboxIndex}
          count={completedGenerations.length}
          onClose={() => setLightboxOpen(false)}
          onPrev={() => setLightboxIndex((i) => Math.max(0, i - 1))}
          onNext={() => setLightboxIndex((i) => Math.min(completedGenerations.length - 1, i + 1))}
          onSelect={() => { selectGeneration(lightboxGeneration); setLightboxOpen(false); }}
          onUseForPost={() => { setLightboxOpen(false); handleGoToPublish(lightboxGeneration); }}
          onRegenerate={() => handleRegenerateVariant(lightboxGeneration)}
          onEdit={() => handleUseAsSource(lightboxGeneration, "edit")}
          onAnimate={() => handleUseAsSource(lightboxGeneration, "image-to-video")}
          onAddReference={() => handleAddAsReference(lightboxGeneration)}
          onUpscale={() => handleUpscale(lightboxGeneration)}
          upscaling={upscalingId === lightboxGeneration.id}
          regenerating={regeneratingIds.includes(lightboxGeneration.id)}
        />
      )}
    </>
  );
}

export default function StudioPage() {
  const brandKit = useBrandKitStore((s) => s.brandKit);
  return (
    <UiV2ThemeProvider className={styles.shell}>
      <StudioBody brandKit={brandKit} />
    </UiV2ThemeProvider>
  );
}
