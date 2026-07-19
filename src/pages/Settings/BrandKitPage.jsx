"use client";

// src/pages/Settings/BrandKitPage.jsx
// ui-v2 rebuild of the personal Brand Kit feature (see
// docs/brand-kit-rebuild/AS_IS_AUDIT.md + DECISIONS_LOG.md). Same pattern
// already used for Studio/Dashboard/Library/Calendar: legacy `bk-*` classes
// + src/styles/BrandKit.css swapped for src/ui-v2 primitives + CSS Modules
// scoped to --uiv2-* tokens. Data layer (BrandKitStore, extractBrandKit,
// brandKitConversation) is untouched — only the presentation layer and the
// screens listed in the task brief (empty state, error state, signed-out
// guard, multi-kit dashboard) changed or were added.
import React, { useEffect, useMemo, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { AlertCircle, Lock, Sparkles } from 'lucide-react';
import { useAuth } from '../../Context/AuthContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import useBrandKitStore from '../../stores/BrandKitStore';
import {
  UiV2ThemeProvider, useUiV2Theme, AppHeader, MobileNavDrawer, CreditPill, Avatar,
  IconButton, Button, Skeleton,
} from '../../ui-v2';
import { useCreditBalance } from '../../hooks/useCreditBalance';
import BrandKitSetupChoice from '../../components/BrandKit/BrandKitSetupChoice';
import BrandKitExtractLoader from '../../components/BrandKit/BrandKitExtractLoader';
import BrandKitConversation from '../../components/BrandKit/BrandKitConversation';
import BrandKitReviewForm from '../../components/BrandKit/BrandKitReviewForm';
import BrandKitDashboard from '../../components/BrandKit/BrandKitDashboard';
import BrandKitDiffModal from '../../components/BrandKit/BrandKitDiffModal';
import styles from '../../components/BrandKit/BrandKit.module.css';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', href: '/app/dashboard' },
  { key: 'studio', label: 'Studio', href: '/app/generate' },
  { key: 'library', label: 'Library', href: '/app/library' },
  { key: 'calendar', label: 'Calendar', href: '/app/calendar' },
  { key: 'brand-kit', label: 'Brand Kit', href: '/app/settings/brand-kit' },
];

// No established "Contact support" mechanism exists elsewhere in this app
// (grepped — no mailto:/support constant anywhere). Logged as a judgment
// call in DECISIONS_LOG.md: a plain mailto link, easy to swap for a real
// support flow later.
const SUPPORT_EMAIL = 'support@brandosse.com';

function ThemeToggleButton() {
  const { isDark, toggleTheme } = useUiV2Theme();
  return (
    <IconButton title={isDark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>
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

function BrandKitBody() {
  const { user, profile, loading: authLoading } = useAuth();
  const { navigate } = useAppNavigation();
  const credits = useCreditBalance(user?.id ?? null);

  const {
    kits, brandKit, assets, isLoading, error,
    loadKits, createKit, setExtractedDraft, clearExtractedDraft,
    openDiffModal, closeDiffModal, applyDiff, diffData, isDiffModalOpen,
  } = useBrandKitStore();

  const [screen, setScreen] = useState('choice');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [importUrl, setImportUrl] = useState('');
  const [extractMode, setExtractMode] = useState('setup');
  const [reviewMode, setReviewMode] = useState('manual');
  const [conversationPrefilled, setConversationPrefilled] = useState({});
  const [conversationMissingFields, setConversationMissingFields] = useState([]);
  const [initialReviewTab, setInitialReviewTab] = useState('Basics');

  const [emptyUrl, setEmptyUrl] = useState('');
  const [emptyError, setEmptyError] = useState('');

  useEffect(() => {
    if (user?.id) loadKits(user.id);
  }, [user?.id, loadKits]);

  // Once a kit is being viewed, route between the choice screen (setup
  // incomplete) and the dashboard (setup complete) — same behavior as
  // before, just driven by whichever kit is currently selected.
  useEffect(() => {
    if (!brandKit) return;
    if (brandKit.setup_completed) {
      if (screen === 'choice') setScreen('dashboard');
      return;
    }
    if (!brandKit.setup_completed && screen === 'dashboard') setScreen('choice');
  }, [brandKit, screen]);

  const userInitials = ((profile?.full_name ? profile.full_name[0] : 'U') + (profile?.full_name?.split(' ')[1]?.[0] ?? '')).toUpperCase();
  const creditPct = credits.lifetimePurchased > 0 ? Math.max(0, Math.min(100, Math.round((credits.balance / credits.lifetimePurchased) * 100))) : 100;

  const headerRight = (
    <>
      {credits.ready ? (
        <CreditPill pct={`${creditPct}%`} label={`${credits.balance.toLocaleString()} cr`} />
      ) : (
        <Skeleton width="76px" height="26px" radius="999px" />
      )}
      <ThemeToggleButton />
      <Avatar initials={userInitials || 'U'} onClick={() => navigate('/app/profile')} />
    </>
  );

  // ---- Auth resolving / signed-out guard ----
  // While AuthContext is still resolving, show a lightweight loading shell
  // rather than assuming `user` is present (every screen below reads
  // `user.id` directly). Once resolved, an unauthenticated visitor gets an
  // in-page guard (per DECISIONS_LOG.md — replaces the old
  // auto-redirect-to-/login behavior) instead of being bounced off-page.
  if (authLoading) {
    return (
      <>
        <AppHeader navItems={[]} right={null} />
        <main className={styles.main}>
          <div className={styles.loadingWrap}>
            <Skeleton height="120px" radius="12px" />
            <Skeleton height="220px" radius="12px" />
          </div>
        </main>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <AppHeader navItems={[]} right={null} />
        <main className={styles.main}>
          <div className={styles.guardWrap}>
            <span className={styles.guardIcon} aria-hidden="true"><Lock size={22} /></span>
            <h1 className={styles.guardTitle}>Sign in to view your brand kit</h1>
            <p className={styles.guardDesc}>Your brand identity is tied to your account.</p>
            <div className={styles.guardActions}>
              <Button onClick={() => navigate('/login')}>Sign in</Button>
            </div>
          </div>
        </main>
      </>
    );
  }

  const handleSelectPath = (path, payload = null) => {
    if (path === 'upload') {
      setExtractMode('setup');
      setUploadedFile(payload);
      setImportUrl('');
      setScreen('extracting');
      return;
    }
    if (path === 'conversational') {
      clearExtractedDraft();
      setReviewMode('conversational');
      setConversationPrefilled({});
      setConversationMissingFields([]);
      setScreen('conversational');
      return;
    }
    if (path === 'manual') {
      clearExtractedDraft();
      setReviewMode('manual');
      setInitialReviewTab('Basics');
      setScreen('review');
      return;
    }
    if (path === 'import' && payload) {
      setExtractedDraft(payload, {}, []);
      setReviewMode('manual');
      setInitialReviewTab('Basics');
      setScreen('review');
    }
  };

  const handleExtractionComplete = (extractedData, confidenceMap = {}) => {
    if (extractMode === 'update') {
      openDiffModal(brandKit || {}, extractedData || {}, confidenceMap || {});
      setScreen('dashboard');
      setUploadedFile(null);
      setImportUrl('');
      return;
    }
    setReviewMode('extracted');
    setInitialReviewTab('Basics');
    setScreen('review');
    setUploadedFile(null);
    setImportUrl('');
  };

  const handleFallbackToConversation = (missingFields = [], prefilled = {}) => {
    setReviewMode('conversational');
    setConversationMissingFields(missingFields);
    setConversationPrefilled(prefilled || {});
    setScreen('conversational');
    setUploadedFile(null);
    setImportUrl('');
  };

  const handleConversationComplete = (collectedData = {}, confidenceMap = {}) => {
    setExtractedDraft(collectedData, confidenceMap, []);
    setReviewMode('conversational');
    setInitialReviewTab('Basics');
    setScreen('review');
  };

  const handleSaved = () => {
    clearExtractedDraft();
    setScreen('dashboard');
  };

  const handleEmptyImport = () => {
    const url = emptyUrl.trim();
    if (!url) { setEmptyError('Enter a website URL first.'); return; }
    setEmptyError('');
    setExtractMode('setup');
    setUploadedFile(null);
    setImportUrl(url);
    setScreen('extracting');
  };

  const handleStartFromScratch = () => {
    setScreen('choice');
  };

  const handleNewKit = async () => {
    try {
      await createKit(user.id, { kit_name: 'New Brand Kit' });
      setReviewMode('manual');
      setInitialReviewTab('Basics');
      setScreen('choice');
    } catch (_err) {
      /* store already surfaces `error` for the inline banner */
    }
  };

  const isFullLoadFailure = Boolean(error) && !isLoading && kits.length === 0;

  const renderScreen = () => {
    if (isLoading && kits.length === 0) {
      return (
        <div className={styles.loadingWrap}>
          <Skeleton height="120px" radius="12px" />
          <Skeleton height="220px" radius="12px" />
        </div>
      );
    }

    if (isFullLoadFailure) {
      return (
        <div className={styles.guardWrap}>
          <span className={[styles.guardIcon, styles.guardIconDanger].join(' ')} aria-hidden="true"><AlertCircle size={22} /></span>
          <h1 className={styles.guardTitle}>Couldn't load your brand kit</h1>
          <p className={styles.guardDesc}>{error}</p>
          <div className={styles.guardActions}>
            <Button onClick={() => loadKits(user.id)}>Try again</Button>
            <a className={styles.guardLink} href={`mailto:${SUPPORT_EMAIL}`}>Contact support</a>
          </div>
        </div>
      );
    }

    // Empty/landing state: no kits at all yet for this account.
    if (kits.length === 0) {
      return (
        <div className={styles.emptyWrap}>
          <span className={styles.emptyIcon} aria-hidden="true"><Sparkles size={22} /></span>
          <h1 className={styles.emptyTitle}>Build your brand kit</h1>
          <p className={styles.emptyDesc}>
            Teach the AI your brand identity once — voice, colors, guardrails — and every generation reflects it automatically.
          </p>
          <div className={styles.emptyForm}>
            <div className={styles.emptyUrlRow}>
              <input
                className={styles.emptyInput}
                type="text"
                placeholder="yourbrand.com"
                value={emptyUrl}
                onChange={(e) => setEmptyUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleEmptyImport(); }}
              />
              <Button onClick={handleEmptyImport}>Import</Button>
            </div>
            {emptyError && <p className={styles.emptyError}>{emptyError}</p>}
            <div className={styles.emptyDivider}>or</div>
            <Button variant="subtle" onClick={handleStartFromScratch} style={{ width: '100%' }}>
              Start from scratch
            </Button>
          </div>
          <p className={styles.emptyCaption}>import takes ~30s · free · editable after</p>
        </div>
      );
    }

    if (screen === 'choice') {
      return <BrandKitSetupChoice onSelectPath={handleSelectPath} />;
    }

    if (screen === 'extracting') {
      return (
        <BrandKitExtractLoader
          file={uploadedFile}
          websiteUrl={importUrl || undefined}
          mode={extractMode}
          onComplete={handleExtractionComplete}
          onFallbackToConversational={handleFallbackToConversation}
          onCancel={() => {
            setUploadedFile(null);
            setImportUrl('');
            setScreen(brandKit?.setup_completed ? 'dashboard' : 'choice');
          }}
        />
      );
    }

    if (screen === 'conversational') {
      return (
        <BrandKitConversation
          prefilled={conversationPrefilled}
          initialMissingFields={conversationMissingFields}
          onComplete={handleConversationComplete}
        />
      );
    }

    if (screen === 'review') {
      return (
        <BrandKitReviewForm
          userId={user.id}
          mode={reviewMode}
          initialTab={initialReviewTab}
          onSaved={handleSaved}
        />
      );
    }

    return (
      <BrandKitDashboard
        brandKit={brandKit}
        assetsCount={assets?.length || 0}
        onOpenManualEdit={() => { setReviewMode('manual'); setInitialReviewTab('Basics'); setScreen('review'); }}
        onEditSection={(section) => { setReviewMode('manual'); setInitialReviewTab(section); setScreen('review'); }}
        onUploadUpdatedDocument={(file) => { setExtractMode('update'); setUploadedFile(file); setImportUrl(''); setScreen('extracting'); }}
        onNewKit={handleNewKit}
      />
    );
  };

  const isWideScreen = screen === 'dashboard' && kits.length > 0 && !isFullLoadFailure && !isLoading;

  return (
    <>
      <Toaster position="top-center" />
      <AppHeader
        navItems={NAV_ITEMS}
        activeKey="brand-kit"
        onNavClick={(item) => navigate(item.href)}
        onBurgerClick={() => setMobileNavOpen(true)}
        right={headerRight}
      />
      <MobileNavDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        navItems={NAV_ITEMS}
        activeKey="brand-kit"
        onNavClick={(item) => navigate(item.href)}
      />

      <main className={styles.main}>
        <div className={isWideScreen ? styles.canvasWide : styles.canvas}>
          {error && kits.length > 0 && (
            <div className={styles.errorBanner} role="alert">{error}</div>
          )}
          {renderScreen()}
        </div>
      </main>

      {isDiffModalOpen && diffData && (
        <BrandKitDiffModal
          existingKit={diffData.existingKit}
          newKit={diffData.newKit}
          newConfidenceMap={diffData.newConfidenceMap}
          onApply={async (merged) => { await applyDiff(merged, user.id); }}
          onCancel={closeDiffModal}
        />
      )}
    </>
  );
}

export default function BrandKitPage() {
  return (
    <UiV2ThemeProvider className={styles.shell}>
      <BrandKitBody />
    </UiV2ThemeProvider>
  );
}
