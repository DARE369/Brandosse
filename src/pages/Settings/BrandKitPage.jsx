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
import { AppShell, Button, Skeleton } from '../../ui-v2';
import BrandKitSetupChoice from '../../components/BrandKit/BrandKitSetupChoice';
import BrandKitExtractLoader from '../../components/BrandKit/BrandKitExtractLoader';
import BrandKitConversation from '../../components/BrandKit/BrandKitConversation';
import BrandKitReviewForm from '../../components/BrandKit/BrandKitReviewForm';
import BrandKitDashboard from '../../components/BrandKit/BrandKitDashboard';
import BrandKitDiffModal from '../../components/BrandKit/BrandKitDiffModal';
import styles from '../../components/BrandKit/BrandKit.module.css';

// No established "Contact support" mechanism exists elsewhere in this app
// (grepped — no mailto:/support constant anywhere). Logged as a judgment
// call in DECISIONS_LOG.md: a plain mailto link, easy to swap for a real
// support flow later.
const SUPPORT_EMAIL = 'support@brandosse.com';


function BrandKitBody() {
  const { user, profile, loading: authLoading } = useAuth();
  const { navigate } = useAppNavigation();

  const {
    kits, brandKit, assets, isLoading, error,
    loadKits, createKit, setExtractedDraft, clearExtractedDraft,
    openDiffModal, closeDiffModal, applyDiff, diffData, isDiffModalOpen,
  } = useBrandKitStore();

  const [screen, setScreen] = useState('choice');
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

  // ---- Auth resolving / signed-out guard ----
  // While AuthContext is still resolving, show a lightweight loading shell
  // rather than assuming `user` is present (every screen below reads
  // `user.id` directly). Once resolved, an unauthenticated visitor gets an
  // in-page guard (per DECISIONS_LOG.md — replaces the old
  // auto-redirect-to-/login behavior) instead of being bounced off-page.
  if (authLoading) {
    return (
      <AppShell minimal className={styles.shell} mainClassName={styles.main}>
        <div className={styles.loadingWrap}>
          <Skeleton height="120px" radius="12px" />
          <Skeleton height="220px" radius="12px" />
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell minimal className={styles.shell} mainClassName={styles.main}>
        <div className={styles.guardWrap}>
          <span className={styles.guardIcon} aria-hidden="true"><Lock size={22} /></span>
          <h1 className={styles.guardTitle}>Sign in to view your brand kit</h1>
          <p className={styles.guardDesc}>Your brand identity is tied to your account.</p>
          <div className={styles.guardActions}>
            <Button onClick={() => navigate('/login')}>Sign in</Button>
          </div>
        </div>
      </AppShell>
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
    <AppShell
      activeKey="brand-kit"
      className={styles.shell}
      mainClassName={styles.main}
      overlays={(
        <>
          <Toaster position="top-center" />
          {isDiffModalOpen && diffData && (
            <BrandKitDiffModal
              existingKit={diffData.existingKit}
              newKit={diffData.newKit}
              newConfidenceMap={diffData.newConfidenceMap}
              newExtractionEvidence={diffData.newExtractionEvidence}
              onApply={async (merged) => { await applyDiff(merged, user.id); }}
              onCancel={closeDiffModal}
            />
          )}
        </>
      )}
    >
      <div className={isWideScreen ? styles.canvasWide : styles.canvas}>
        {error && kits.length > 0 && (
          <div className={styles.errorBanner} role="alert">{error}</div>
        )}
        {renderScreen()}
      </div>
    </AppShell>
  );
}

export default function BrandKitPage() {
  return <BrandKitBody />;
}
