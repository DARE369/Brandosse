"use client";

// src/pages/ConnectAccount/ConnectAccountFlow.jsx
// ui-v2 rebuild of the Connect Account flow (see docs mockup
// "Connect Account.dc.html") as a dedicated 6-step route, replacing the
// old 3-step MockOAuthScreen modal for NEW connections. Editing an existing
// connected account's details still uses MockOAuthScreen(mode="edit") —
// that's a different, already-working flow this rebuild doesn't touch.
//
// Steps: platform picker -> heads-up -> mock OAuth popup -> permission
// grant -> profile picker (multi-page platforms only) -> success. The
// backing connection logic (connectAccount / initiateOAuthConnection) is
// untouched — if live OAuth is configured for a platform, step 2's
// Continue button redirects out of the app for real OAuth exactly like
// before; steps 3-6 only run for the mock fallback path, which this whole
// app already discloses as simulated.
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Check, ChevronRight, Loader2, Lock, ShieldCheck, X,
} from "lucide-react";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import PlatformIcon from "../../components/Shared/PlatformIcon";
import { getAllPlatforms } from "../../services/platforms/platformRegistry";
import { getAccountsForUser, connectAccount, initiateOAuthConnection } from "../../services/platforms/connectionService";
import {
  UiV2ThemeProvider, useUiV2Theme, IconButton, Button, Badge, Skeleton,
} from "../../ui-v2";
import styles from "./ConnectAccountFlow.module.css";

// Platforms whose real product genuinely separates a personal profile from
// a Page/Channel you post as — the only ones that get a profile-picker step.
const MULTI_PROFILE_PLATFORMS = new Set(["facebook", "linkedin", "youtube"]);

const SCOPE_COPY = [
  { key: "profile", label: "Read your public profile info", detail: "Name, username, and profile picture." },
  { key: "publish", label: "Publish posts on your behalf", detail: "Only when you schedule or send a post from this app." },
  { key: "insights", label: "Read performance insights", detail: "Views, likes, and engagement for posts published here." },
];

function sanitizeHandle(value) {
  return String(value || "").replace(/^@+/, "").replace(/\s+/g, "_");
}

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

const STEP_LABELS = ["Platform", "Heads up", "Sign in", "Permissions", "Profile", "Done"];

function StepDots({ step, totalSteps }) {
  return (
    <div className={styles.stepDots}>
      {Array.from({ length: totalSteps }, (_, i) => i + 1).map((n) => (
        <span key={n} className={[styles.stepDot, n === step ? styles.stepDotActive : n < step ? styles.stepDotDone : ""].join(" ")} />
      ))}
    </div>
  );
}

export default function ConnectAccountFlow() {
  return (
    <UiV2ThemeProvider className={styles.shell}>
      <ConnectAccountFlowBody />
    </UiV2ThemeProvider>
  );
}

function ConnectAccountFlowBody() {
  const { navigate, search } = useAppNavigation();
  const { user } = useAuth();
  const searchParams = useMemo(() => new URLSearchParams(search), [search]);
  const preselectedKey = searchParams.get("platform") || "";

  const [platforms, setPlatforms] = useState([]);
  const [platformsLoading, setPlatformsLoading] = useState(true);
  const [connectedKeys, setConnectedKeys] = useState(new Set());
  const [selectedPlatform, setSelectedPlatform] = useState(null);
  const [step, setStep] = useState(1);
  const [checkingRealOAuth, setCheckingRealOAuth] = useState(false);
  const [deniedOnce, setDeniedOnce] = useState(false);
  const [profileChoice, setProfileChoice] = useState("primary");
  const [form, setForm] = useState({ displayName: "", username: "", profileType: "", followerCount: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [savedAccount, setSavedAccount] = useState(null);

  const isMultiProfile = MULTI_PROFILE_PLATFORMS.has(selectedPlatform?.platform_key);
  const totalSteps = 6;

  useEffect(() => {
    let mounted = true;
    Promise.all([getAllPlatforms(), user?.id ? getAccountsForUser(user.id, "personal") : Promise.resolve([])])
      .then(([allPlatforms, accounts]) => {
        if (!mounted) return;
        setPlatforms(allPlatforms || []);
        setConnectedKeys(new Set((accounts || []).map((a) => a.platform)));
        if (preselectedKey) {
          const match = (allPlatforms || []).find((p) => p.platform_key === preselectedKey);
          if (match) {
            setSelectedPlatform(match);
            setStep(2);
          }
        }
      })
      .finally(() => { if (mounted) setPlatformsLoading(false); });
    return () => { mounted = false; };
  }, [user?.id, preselectedKey]);

  useEffect(() => {
    if (selectedPlatform) {
      setForm({
        displayName: "",
        username: "",
        profileType: selectedPlatform.supported_profile_types?.[0] || "Business",
        followerCount: "",
      });
    }
  }, [selectedPlatform]);

  const goBack = () => {
    if (step === 1) { navigate("/app/settings?tab=connected"); return; }
    if (step === 2) { setSelectedPlatform(null); setStep(1); return; }
    setStep((s) => Math.max(1, s - 1));
  };

  const handlePickPlatform = (platform) => {
    setSelectedPlatform(platform);
    setError("");
    setStep(2);
  };

  const handleHeadsUpContinue = async () => {
    setCheckingRealOAuth(true);
    setError("");
    try {
      const result = await initiateOAuthConnection({
        userId: user?.id,
        platform: selectedPlatform.platform_key,
        scope: "personal",
        fallbackToMock: false,
      });
      if (!result?.redirecting) {
        setStep(3);
      }
      // redirecting === true means the browser is navigating away for real
      // OAuth right now — nothing else to do here.
    } catch (err) {
      setError(err.message || "Could not start authorization.");
    } finally {
      setCheckingRealOAuth(false);
    }
  };

  const handleMockLogin = (event) => {
    event.preventDefault();
    setStep(4);
  };

  const handleDeny = () => setDeniedOnce(true);
  const handleAllow = () => {
    setDeniedOnce(false);
    // Step 5 is "confirm your profile" for every platform — the page picker
    // above the form only renders when isMultiProfile is true.
    setStep(5);
  };

  const applyProfileChoice = (choice) => {
    setProfileChoice(choice);
    const base = form.displayName || user?.email?.split("@")[0] || selectedPlatform.display_name;
    if (choice === "page") {
      setForm((f) => ({ ...f, displayName: `${base} Page`, profileType: "Business" }));
    } else {
      setForm((f) => ({ ...f, displayName: base, profileType: selectedPlatform.supported_profile_types?.[0] || "Business" }));
    }
  };

  const handleSubmitProfile = async (event) => {
    event.preventDefault();
    if (!form.displayName.trim() || !form.username.trim()) {
      setError("Account name and username are required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await connectAccount({
        userId: user?.id,
        platform: selectedPlatform.platform_key,
        scope: "personal",
        formData: form,
      });
      setSavedAccount(result);
      setStep(6);
    } catch (err) {
      setError(err.message || "Could not connect this account.");
    } finally {
      setSubmitting(false);
    }
  };

  const accent = selectedPlatform?.brand_color || "var(--uiv2-accent-solid)";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={goBack} aria-label="Back">
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <div className={styles.headerTitle}>Connect an account</div>
        <ThemeToggleButton />
      </header>

      <div className={styles.canvas}>
        {step > 1 ? (
          <div className={styles.stepMeta}>
            <StepDots step={Math.min(step, totalSteps)} totalSteps={totalSteps} />
            <span className={styles.stepLabel}>{STEP_LABELS[Math.min(step, 6) - 1]}</span>
          </div>
        ) : null}

        {error ? <div className={styles.errorBanner}>{error}</div> : null}

        {step === 1 ? (
          <div className={styles.card}>
            <div className={styles.cardTitle}>Choose a platform</div>
            <div className={styles.cardSub}>Pick where you want to publish from Brandosse.</div>
            {platformsLoading ? (
              <div className={styles.platformGrid}>
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height="90px" radius="var(--uiv2-radius-lg)" />)}
              </div>
            ) : (
              <div className={styles.platformGrid}>
                {platforms.map((p) => {
                  const connected = connectedKeys.has(p.platform_key);
                  return (
                    <button
                      key={p.platform_key}
                      type="button"
                      className={styles.platformTile}
                      onClick={() => handlePickPlatform(p)}
                      style={{ "--tile-accent": p.brand_color }}
                    >
                      <span className={styles.platformIconWrap}><PlatformIcon platform={p.platform_key} size="md" /></span>
                      <span className={styles.platformName}>{p.display_name}</span>
                      {connected ? <Badge tone="success">Connected</Badge> : <ChevronRight size={15} className={styles.platformChevron} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {step === 2 && selectedPlatform ? (
          <div className={styles.card} style={{ "--tile-accent": accent }}>
            <div className={styles.iconLg}><PlatformIcon platform={selectedPlatform.platform_key} size="lg" /></div>
            <div className={styles.cardTitle}>Connecting to {selectedPlatform.display_name}</div>
            <div className={styles.cardSub}>{selectedPlatform.mock_login_description}</div>
            <ul className={styles.headsUpList}>
              <li>You&apos;ll sign in and grant Brandosse permission to publish and read insights.</li>
              <li>Brandosse only publishes when you schedule or send a post — never automatically.</li>
              <li>You can disconnect this account at any time from Settings.</li>
            </ul>
            <Button onClick={handleHeadsUpContinue} disabled={checkingRealOAuth}>
              {checkingRealOAuth ? <Loader2 size={14} className={styles.spin} /> : null}
              {checkingRealOAuth ? "Checking…" : `Continue with ${selectedPlatform.display_name}`}
            </Button>
          </div>
        ) : null}

        {step === 3 && selectedPlatform ? (
          <div className={styles.browserFrame}>
            <div className={styles.browserChrome}>
              <span className={styles.browserDot} style={{ background: "#ff5f57" }} />
              <span className={styles.browserDot} style={{ background: "#febc2e" }} />
              <span className={styles.browserDot} style={{ background: "#28c840" }} />
              <div className={styles.browserAddress}>
                <Lock size={11} aria-hidden="true" />
                {selectedPlatform.platform_key}.com/oauth/authorize
              </div>
            </div>
            <form className={styles.mockLoginForm} onSubmit={handleMockLogin}>
              <div className={styles.iconLg}><PlatformIcon platform={selectedPlatform.platform_key} size="lg" /></div>
              <div className={styles.cardTitle}>{selectedPlatform.mock_login_headline}</div>
              <label className={styles.field}>
                <span>Email or username</span>
                <input type="text" required placeholder="you@example.com" autoComplete="off" />
              </label>
              <label className={styles.field}>
                <span>Password</span>
                <input type="password" required placeholder="••••••••" autoComplete="off" />
              </label>
              <Button type="submit">Log in</Button>
              <div className={styles.mockNotice}>This is a simulated login screen — nothing is sent to {selectedPlatform.display_name}.</div>
            </form>
          </div>
        ) : null}

        {step === 4 && selectedPlatform ? (
          <div className={styles.card}>
            <div className={styles.iconLg}><PlatformIcon platform={selectedPlatform.platform_key} size="lg" /></div>
            <div className={styles.cardTitle}>Brandosse would like to</div>
            <div className={styles.scopeList}>
              {SCOPE_COPY.map((s) => (
                <div key={s.key} className={styles.scopeRow}>
                  <ShieldCheck size={15} className={styles.scopeIcon} aria-hidden="true" />
                  <div>
                    <div className={styles.scopeLabel}>{s.label}</div>
                    <div className={styles.scopeDetail}>{s.detail}</div>
                  </div>
                </div>
              ))}
            </div>
            {deniedOnce ? (
              <div className={styles.warnBanner}>
                <X size={14} aria-hidden="true" /> You need to allow access to connect this account. Try again, or go back and choose a different platform.
              </div>
            ) : null}
            <div className={styles.dualActions}>
              <Button variant="ghost" onClick={handleDeny}>Deny</Button>
              <Button onClick={handleAllow}>Allow</Button>
            </div>
          </div>
        ) : null}

        {step === 5 && selectedPlatform ? (
          <div className={styles.card}>
            <div className={styles.cardTitle}>Confirm your profile</div>
            <div className={styles.cardSub}>This mock setup simulates a real connected account inside Brandosse.</div>

            {isMultiProfile ? (
              <div className={styles.profilePicker}>
                <button type="button" className={[styles.profileOption, profileChoice === "primary" ? styles.profileOptionActive : ""].join(" ")} onClick={() => applyProfileChoice("primary")}>
                  <span className={styles.profileOptionTitle}>Your personal profile</span>
                  <span className={styles.profileOptionSub}>Post as yourself</span>
                  {profileChoice === "primary" ? <Check size={15} aria-hidden="true" /> : null}
                </button>
                <button type="button" className={[styles.profileOption, profileChoice === "page" ? styles.profileOptionActive : ""].join(" ")} onClick={() => applyProfileChoice("page")}>
                  <span className={styles.profileOptionTitle}>A Page you manage</span>
                  <span className={styles.profileOptionSub}>Post as a business Page</span>
                  {profileChoice === "page" ? <Check size={15} aria-hidden="true" /> : null}
                </button>
              </div>
            ) : null}

            <form className={styles.profileForm} onSubmit={handleSubmitProfile}>
              <label className={styles.field}>
                <span>Account name</span>
                <input type="text" value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} placeholder="e.g. Nike Official" required />
              </label>
              <label className={styles.field}>
                <span>Username</span>
                <div className={styles.handleInput}>
                  <span>@</span>
                  <input type="text" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: sanitizeHandle(e.target.value) }))} placeholder="yourusername" required />
                </div>
              </label>
              <label className={styles.field}>
                <span>Approximate followers</span>
                <input type="number" min="0" value={form.followerCount} onChange={(e) => setForm((f) => ({ ...f, followerCount: e.target.value }))} placeholder="10000" />
              </label>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 size={14} className={styles.spin} /> : null}
                {submitting ? "Connecting…" : "Connect account"}
              </Button>
            </form>
          </div>
        ) : null}

        {step === 6 && selectedPlatform ? (
          <div className={styles.card}>
            <div className={styles.successIcon}><Check size={28} aria-hidden="true" /></div>
            <div className={styles.cardTitle}>{selectedPlatform.display_name} connected</div>
            <div className={styles.cardSub}>@{savedAccount?.username || form.username} is now available inside Brandosse.</div>
            <div className={styles.simDisclaimer}>
              This is a simulated connection for demonstration — no real {selectedPlatform.display_name} account was accessed, and nothing publishes to the real platform.
            </div>
            <Button onClick={() => navigate("/app/settings?tab=connected")}>Go to Connected Accounts</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
