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
  MAGNIFIC_CONTENT_TYPES,
  MAGNIFIC_ASPECT_RATIOS,
  MAGNIFIC_VIDEO_FPS,
  estimateMagnificCost,
  getMagnificModelsForMode,
  getVideoDurationsForModel,
} from "../../config/magnificModels";
import { PROMPT_LIMIT } from "../../components/GenerateStudio/shared/constants";
import {
  UiV2ThemeProvider, useUiV2Theme, AppHeader, CreditPill, Avatar, IconButton,
  Card, Badge, Skeleton, EmptyState, Button, Modal, Drawer, Dropdown, MobileNavDrawer,
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

function StudioBody({ brandKit }) {
  const { navigate } = useAppNavigation();
  const { user, profile } = useAuth();
  const { accounts, accountsLoading } = useConnectedAccounts();
  const credits = useCreditBalance(user?.id ?? null);

  const {
    activeSession, activeGenerations, selectedGeneration, selectedGenerationId,
    isGenerating, generationProgress, progressLabel, error, settings, postProduction,
    updateSettings, startGeneration, startCarouselGeneration, startEditGeneration,
    startVideoGeneration, enhancePrompt, selectGeneration, hydratePostProductionFromGeneration,
    regeneratePostMetadata, optimizeSeo, updatePostProduction, saveDraft, publishContent,
    videoJobState, dismissVideoJob, setVideoJobMinimized,
    sessions, projects, activeProject, createNewSession, loadSession, updateSessionTitle, deleteSession,
    fetchSessions, fetchProjects, createProject, renameProject, deleteProject, reorderProjects,
    sessionsLoading, projectsLoading,
  } = useSessionStore();

  // The old ProjectSessionBreadcrumb (deleted) was the only place that ever
  // called these — without it `sessions`/`projects` silently stayed empty.
  useEffect(() => {
    fetchSessions();
    fetchProjects();
  }, [fetchSessions, fetchProjects]);

  const [prompt, setPrompt] = useState("");
  const [sourceImageUrl, setSourceImageUrl] = useState("");
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
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState(null);
  const [slideSelection, setSlideSelection] = useState({});

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

  const cost = useMemo(() => estimateMagnificCost(settings), [settings]);
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
    (mode) => {
      const next = MAGNIFIC_CONTENT_TYPES.find((t) => t.id === mode) || MAGNIFIC_CONTENT_TYPES[0];
      const nextModel = getMagnificModelsForMode(next.id)[0]?.id || "realism";
      const isVid = next.mediaType === "video" || next.mediaType === "image-to-video";
      updateSettings({
        mediaType: next.mediaType,
        contentType: next.contentType,
        model: nextModel,
        batchSize: next.id === "image" ? Math.max(1, Number(settings.batchSize) || 1) : 1,
        slideCount: next.id === "carousel" ? settings.slideCount || 6 : "auto",
        resolution: isVid ? "1080p" : "2k",
        duration: isVid ? (nextModel === "kling-v2-6-pro" ? 5 : 6) : settings.duration,
        referenceImageUrl: sourceImageUrl,
      });
    },
    [settings, sourceImageUrl, updateSettings]
  );

  const handleEnhance = useCallback(async () => {
    const src = prompt.trim();
    if (!src) return;
    setEnhancing(true);
    try {
      const result = await enhancePrompt(src);
      if (result?.enhanced) setPrompt(result.enhanced.slice(0, PROMPT_LIMIT));
    } catch (err) {
      toast.error(err?.message || "Could not enhance prompt.");
    } finally {
      setEnhancing(false);
    }
  }, [prompt, enhancePrompt]);

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
      else if (isVideoMode) await startVideoGeneration(prompt.trim());
      else await startGeneration(prompt.trim());
    } catch (genErr) {
      const msg = genErr?.message || "Generation failed.";
      if (!cancelRequestedRef.current) {
        setLocalError(msg);
        toast.error(msg);
      }
    }
  }, [validatePreflight, isCarousel, selectedMode, isVideoMode, prompt, sourceImageUrl, negativePrompt, applyBrandKit, brandKit, settings, updateSettings, startGeneration, startCarouselGeneration, startEditGeneration, startVideoGeneration]);

  /* Cancel: video has a real interruption path (stop polling — job keeps
     running server-side, matching "safe to navigate away"). Sync modes
     (image/carousel/edit) have no server-side abort available in the store,
     so — same as the mockup's own reference behavior — this returns the UI
     to the brief and discards the in-flight result when it lands; it does
     not stop the request or refund credits. */
  const handleCancelGenerate = useCallback(() => {
    if (isVideoMode && videoJobState.status) {
      dismissVideoJob();
    } else {
      cancelRequestedRef.current = true;
    }
    setStudioStage("brief");
    toast("Generation cancelled");
  }, [isVideoMode, videoJobState.status, dismissVideoJob]);

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

  const handleConfirmSchedule = useCallback(async () => {
    if (!scheduleDate || !scheduleTime) {
      toast.error("Pick a date and time.");
      return;
    }
    updatePostProduction({ scheduleDate: new Date(`${scheduleDate}T${scheduleTime}`).toISOString() });
    setPublishing(true);
    try {
      const result = await saveDraft();
      toast.success(result?.message || `Scheduled for ${scheduleDate} ${scheduleTime}`);
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
  const videoJobActive = isGenerating && isVideoMode;

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
              <div className={styles.videoIndicator} title="Video jobs keep processing in the background — safe to navigate anywhere">
                <span className={styles.loadingDot} />
                <span className={styles.videoIndicatorLabel} style={{ fontFamily: "var(--uiv2-font-mono)", fontSize: 11, color: "var(--uiv2-warning)" }}>
                  Video processing {Math.round(generationProgress)}%
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
            <Avatar initials={userInitials || "U"} onClick={() => navigate("/app/profile")} />
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
                  {MAGNIFIC_CONTENT_TYPES.map((m) => (
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
                  <Button variant="ghost" size="sm" onClick={handleEnhance} disabled={enhancing || !prompt.trim() || isGenerating}>
                    <Sliders size={12} /> {enhancing ? "Enhancing…" : "Enhance prompt"}
                  </Button>
                </div>

                {needsSourceImage && (
                  <input
                    className={styles.fieldInput}
                    style={{ width: "100%", marginBottom: 8 }}
                    placeholder="Source image URL (from Library or a generated asset)"
                    value={sourceImageUrl}
                    onChange={(e) => setSourceImageUrl(e.target.value)}
                  />
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
                    {MAGNIFIC_ASPECT_RATIOS.map((r) => (
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
                      {getVideoDurationsForModel(settings.model).map((d) => (
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
                    <span className={styles.formatSubLabel} style={{ marginTop: 4 }}>FPS</span>
                    <div className={styles.formatRow}>
                      {MAGNIFIC_VIDEO_FPS.map((f) => (
                        <button
                          key={f}
                          type="button"
                          className={[styles.formatChip, Number(settings.fps) === f ? styles.formatChipActive : ""].join(" ")}
                          onClick={() => updateSettings({ fps: f })}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
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
                  disabled={!prompt.trim() || !canAfford || isGenerating}
                  style={{ width: "100%" }}
                >
                  <Sparkles size={14} aria-hidden="true" />
                  {isGenerating ? "Generating…" : `Generate${shimmerCount > 1 ? ` ${shimmerCount} variants` : ""}`}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      await saveDraft();
                      toast.success("Saved as draft");
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
                    {MAGNIFIC_CONTENT_TYPES.find((m) => m.id === selectedMode)?.label} · {aspectRatio}
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

              {(studioStage === "brief" || studioStage === "results") && completedGenerations.length > 0 && (
                isCarousel ? (
                  <Card>
                    <div style={{ fontSize: 12.5, color: "var(--uiv2-text-secondary)", marginBottom: 12 }}>
                      Click a slide to preview it full-size.
                    </div>
                    <div className={styles.filmstrip}>
                      {completedGenerations.map((g, i) => (
                        <div key={g.id} className={styles.filmSlide}>
                          <div
                            className={[styles.filmThumb, selectedGenerationId === g.id ? styles.filmThumbSelected : ""].join(" ")}
                            onClick={() => openLightbox(g)}
                          >
                            {g.storage_path || g.output_url || g.thumbnail_url ? (
                              <img className={styles.variantImg} src={g.storage_path || g.output_url || g.thumbnail_url} alt="" />
                            ) : (
                              <span className={styles.variantLabel}>Slide {i + 1}</span>
                            )}
                          </div>
                          <div className={styles.filmCaption}>Slide {i + 1}</div>
                        </div>
                      ))}
                    </div>
                    <div className={styles.searchRow}>
                      <Button variant="subtle" onClick={() => handleModeChange("carousel")}>Regenerate whole carousel</Button>
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
                        {g.storage_path || g.output_url || g.thumbnail_url ? (
                          g.media_type === "video" ? (
                            <video className={styles.variantImg} src={g.storage_path || g.output_url} muted />
                          ) : (
                            <img className={styles.variantImg} src={g.storage_path || g.output_url || g.thumbnail_url} alt="" />
                          )
                        ) : (
                          <span className={styles.variantLabel}>V{i + 1}</span>
                        )}
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
                          </span>
                        </div>
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
                    return src ? (
                      gen.media_type === "video" ? (
                        <video src={src} controls style={{ width: "100%", maxHeight: 480, display: "block", background: "#000" }} />
                      ) : (
                        <img src={src} alt="Selected generation" style={{ width: "100%", maxHeight: 480, objectFit: "contain", display: "block" }} />
                      )
                    ) : null;
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
            <Button onClick={handleConfirmSchedule} disabled={publishing}>Confirm schedule</Button>
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

      {/* Video jobs panel */}
      <Drawer open={videoJobsOpen} onClose={() => setVideoJobsOpen(false)} title="Video jobs" width="min(380px, 92vw)">
        <div style={{ fontSize: 11.5, color: "var(--uiv2-text-tertiary)", marginBottom: 8 }}>
          Video runs keep processing here even if you leave Studio.
        </div>
        {videoJobState.status ? (
          <div className={styles.videoJobRow}>
            <div className={styles.videoJobHead}>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{videoJobState.prompt?.slice(0, 40) || "Video job"}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--uiv2-font-mono)", fontSize: 10.5, color: videoJobState.status === "failed" ? "var(--uiv2-danger)" : "var(--uiv2-warning)" }}>
                <span className={styles.statusDot} style={{ background: videoJobState.status === "failed" ? "var(--uiv2-danger)" : "var(--uiv2-warning)" }} />
                {videoJobState.status}
              </span>
            </div>
            {videoJobState.status === "processing" && (
              <div className={styles.videoJobBar}><div className={styles.videoJobBarFill} style={{ width: `${videoJobState.progress}%` }} /></div>
            )}
            {videoJobState.status === "failed" && (
              <Button size="sm" variant="subtle" onClick={() => { dismissVideoJob(); setVideoJobsOpen(false); handleGenerate(); }}>Retry</Button>
            )}
            {videoJobState.status === "completed" && (
              <Button size="sm" onClick={() => { setVideoJobsOpen(false); }}>View result</Button>
            )}
          </div>
        ) : (
          <EmptyState title="No video jobs" description="Video runs will show up here while processing." />
        )}
      </Drawer>

      {/* Session history */}
      <SessionHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessions={sessions}
        projects={projects}
        activeSession={activeSession}
        loading={sessionsLoading || projectsLoading}
        onResume={async (s) => { await loadSession(s.id); setHistoryOpen(false); }}
        onNewSession={async (projectId) => {
          await createNewSession("New session", { projectId });
          setHistoryOpen(false);
          setStudioStage("brief");
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
                await deleteSession(deleteSessionTarget.id);
                setDeleteSessionTarget(null);
                toast.success("Session deleted");
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
