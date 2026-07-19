"use client";

// src/pages/Onboarding/OnboardingWizard.jsx
// First-login 4-step wizard (see docs mockup "Onboarding.dc.html"), shown
// once via AppHomeRedirect.jsx (checks user_settings.onboarding_completed_at
// — see supabase/migrations/20260716130000_onboarding_completed.sql and
// markOnboardingCompleted/fetchOnboardingCompleted in userSettingsService.js).
// Dashboard's checklist (PersonalDashboardPage.jsx) remains the safety net
// for anything skipped here.
//
// Every step hands off to the real, already-working feature rather than
// re-implementing it inline:
//  - Step 1 (aspect ratio) persists via saveUserSettings — the exact field
//    StudioPage.jsx already seeds its default from (Settings > Content
//    defaults, built in the same rebuild pass as this wizard). The mockup's
//    "workspace name" field is dropped — there is no real per-user
//    workspace-name column to write it to on a personal account, and this
//    build doesn't fabricate one.
//  - Step 2 (connect) links into the real ConnectAccountFlow.jsx (Phase 2b).
//  - Step 3 (brand kit) links into the real BrandKitPage.jsx setup flow.
//  - Step 4 (first post) seeds Studio's prompt via the existing
//    setPromptSeed/consumePromptSeed cross-page handoff (the same mechanism
//    Library/template/repurpose handoffs already use) and hands off to
//    Studio for the actual generate → review → schedule/publish flow,
//    rather than re-embedding generation + SessionStore.saveDraft/
//    publishContent in a 4th wizard screen.
import { useEffect, useState } from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import PlatformIcon from "../../components/Shared/PlatformIcon";
import { getAllPlatforms } from "../../services/platforms/platformRegistry";
import { ASPECT_RATIOS } from "../../config/mediaGenerationOptions";
import { saveUserSettings, markOnboardingCompleted } from "../../services/userSettingsService";
import useSessionStore from "../../stores/SessionStore";
import { UiV2ThemeProvider, Button, Skeleton } from "../../ui-v2";
import styles from "./OnboardingWizard.module.css";

const STEP_LABELS = ["Preferences", "Connect", "Brand Kit", "First post"];

function StepDots({ step }) {
  return (
    <div className={styles.stepDots}>
      {STEP_LABELS.map((_, i) => (
        <span key={i} className={[styles.stepDot, i + 1 === step ? styles.stepDotActive : i + 1 < step ? styles.stepDotDone : ""].join(" ")} />
      ))}
    </div>
  );
}

export default function OnboardingWizard() {
  return (
    <UiV2ThemeProvider className={styles.shell}>
      <OnboardingWizardBody />
    </UiV2ThemeProvider>
  );
}

function OnboardingWizardBody() {
  const { navigate } = useAppNavigation();
  const { user } = useAuth();
  const setPromptSeed = useSessionStore((s) => s.setPromptSeed);

  const [step, setStep] = useState(1);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [saving, setSaving] = useState(false);
  const [platforms, setPlatforms] = useState([]);
  const [platformsLoading, setPlatformsLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    getAllPlatforms().then((p) => { setPlatforms(p || []); setPlatformsLoading(false); }).catch(() => setPlatformsLoading(false));
  }, []);

  const finish = async (nextRoute) => {
    setFinishing(true);
    try {
      if (user?.id) await markOnboardingCompleted(user.id);
    } catch {
      // Non-blocking — worst case the wizard shows again next login, which
      // is far better than trapping the user here on a write failure.
    } finally {
      navigate(nextRoute);
    }
  };

  const handleStep1Continue = async () => {
    setSaving(true);
    try {
      if (user?.id) await saveUserSettings(user.id, { generationDefaults: { aspect_ratio: aspectRatio } });
    } catch {
      // Same non-blocking reasoning — the choice just won't be persisted.
    } finally {
      setSaving(false);
      setStep(2);
    }
  };

  const handleConnectPlatform = (platform) => {
    finish(`/app/settings/connect?platform=${encodeURIComponent(platform.platform_key)}`);
  };

  const handleBrandKitSetup = () => finish("/app/settings/brand-kit");

  const handleCreateFirstPost = () => {
    if (prompt.trim()) {
      setPromptSeed({ text: prompt.trim(), source: "onboarding" });
    }
    finish("/app/generate");
  };

  const handleSkipToEnd = () => finish("/app/dashboard");

  return (
    <div className={styles.page}>
      <div className={styles.canvas}>
        <div className={styles.stepMeta}>
          <StepDots step={step} />
          <span className={styles.stepLabel}>Step {step} of 4 · {STEP_LABELS[step - 1]}</span>
        </div>

        {step === 1 ? (
          <div className={styles.card}>
            <div className={styles.iconLg}><Sparkles size={22} aria-hidden="true" /></div>
            <div className={styles.cardTitle}>Welcome to Brandosse</div>
            <div className={styles.cardSub}>Let&apos;s get your workspace set up — this takes about a minute.</div>

            <div className={styles.blockLabel}>Default aspect ratio</div>
            <div className={styles.chipRow}>
              {ASPECT_RATIOS.map((ar) => (
                <button
                  key={ar.id}
                  type="button"
                  className={[styles.chip, aspectRatio === ar.id ? styles.chipActive : ""].join(" ")}
                  onClick={() => setAspectRatio(ar.id)}
                  title={ar.hint}
                >
                  {ar.label}
                </button>
              ))}
            </div>

            <Button onClick={handleStep1Continue} disabled={saving}>
              {saving ? "Saving…" : "Continue"} <ArrowRight size={14} aria-hidden="true" />
            </Button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className={styles.card}>
            <div className={styles.cardTitle}>Connect a platform</div>
            <div className={styles.cardSub}>Connect an account now so you can schedule and publish right away. You can always do this later from Settings.</div>
            {platformsLoading ? (
              <div className={styles.platformGrid}>
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height="80px" radius="var(--uiv2-radius-lg)" />)}
              </div>
            ) : (
              <div className={styles.platformGrid}>
                {platforms.map((p) => (
                  <button key={p.platform_key} type="button" className={styles.platformTile} onClick={() => handleConnectPlatform(p)} style={{ "--tile-accent": p.brand_color }}>
                    <span className={styles.platformIconWrap}><PlatformIcon platform={p.platform_key} size="md" /></span>
                    <span className={styles.platformName}>{p.display_name}</span>
                  </button>
                ))}
              </div>
            )}
            <button type="button" className={styles.skipLink} onClick={() => setStep(3)} disabled={finishing}>Skip for now</button>
          </div>
        ) : null}

        {step === 3 ? (
          <div className={styles.card}>
            <div className={styles.cardTitle}>Set up your Brand Kit</div>
            <div className={styles.cardSub}>
              Teach the AI your brand voice, colors, and guardrails once — every generation reflects it automatically after that.
            </div>
            <Button onClick={handleBrandKitSetup} disabled={finishing}>Set up Brand Kit <ArrowRight size={14} aria-hidden="true" /></Button>
            <button type="button" className={styles.skipLink} onClick={() => setStep(4)} disabled={finishing}>Skip for now</button>
          </div>
        ) : null}

        {step === 4 ? (
          <div className={styles.card}>
            <div className={styles.cardTitle}>Create your first post</div>
            <div className={styles.cardSub}>Describe what you want, and we&apos;ll take you into Studio to generate, review, and publish it.</div>
            <textarea
              className={styles.promptArea}
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. A bright, energetic announcement post for our summer sale"
            />
            <Button onClick={handleCreateFirstPost} disabled={finishing}>
              {finishing ? "Opening Studio…" : "Create my first post"} <ArrowRight size={14} aria-hidden="true" />
            </Button>
            <button type="button" className={styles.skipLink} onClick={handleSkipToEnd} disabled={finishing}>Skip — take me to my dashboard</button>
          </div>
        ) : null}

        {step > 1 ? (
          <button type="button" className={styles.doneNote} onClick={handleSkipToEnd} disabled={finishing}>
            <Check size={12} aria-hidden="true" /> Finish setup later
          </button>
        ) : null}
      </div>
    </div>
  );
}
