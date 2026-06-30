import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Sparkles, X } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import { supabase } from '../../services/supabaseClient';
import { useAuth } from '../../Context/AuthContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import useBrandKitStore from '../../stores/BrandKitStore';
import useSessionStore from '../../stores/SessionStore';
import GenerationCanvas from '../../components/Generate/GenerationCanvas';
import PostProductionPanel from '../../components/Generate/PostProductionPanel';
import BrandKitOnboardingModal from '../../components/BrandKit/BrandKitOnboardingModal';
import VideoProcessingModal, {
  VideoStatusBar,
} from '../../components/Generate/VideoProcessingModal';
import { GENERATION_STATUS } from '../../constants/statuses';
import BrandKitPanel from './BrandKitPanel';
import useOrgContext from '../hooks/useOrgContext';
const GENERATION_SEARCH_LIMIT = 120;

function getTitleFromPrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') return 'Untitled Generation';
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'Untitled Generation';
  const base = words.slice(0, 7).join(' ');
  return words.length > 7 ? `${base}...` : base;
}

function getGenerationTitle(generation) {
  const metadataTitle = generation?.metadata?.title;
  const sessionTitle = generation?.session_title;

  if (typeof metadataTitle === 'string' && metadataTitle.trim()) {
    return metadataTitle.trim();
  }

  if (typeof sessionTitle === 'string' && sessionTitle.trim()) {
    return sessionTitle.trim();
  }

  return getTitleFromPrompt(generation?.prompt);
}

function getGenerationSearchText(generation) {
  const title = getGenerationTitle(generation);
  const prompt = generation?.prompt ?? '';
  return `${title} ${prompt}`.toLowerCase();
}

function getIntentKey(intent = {}) {
  const assetIds = Array.isArray(intent?.assetReferences)
    ? intent.assetReferences.map((asset) => asset?.id).filter(Boolean)
    : (intent?.assetReference?.id ? [intent.assetReference.id] : []);

  return JSON.stringify({
    mode: intent?.mode || 'new',
    sessionId: intent?.sessionId || null,
    editPostId: intent?.editPostId || null,
    repurposeFromPostId: intent?.repurposeFromPostId || null,
    templateId: intent?.templateId || null,
    prefillDate: intent?.prefillDate || null,
    seedPrompt: intent?.seedPrompt || null,
    contextNote: intent?.contextNote || null,
    assetReferenceIds: assetIds,
    nonce: intent?.nonce || null,
  });
}

export default function OrgGenerateComposer({
  open = false,
  intent = null,
  onClose = () => {},
}) {
  const { user, switchWorkspace } = useAuth();
  const { navigate } = useAppNavigation();
  const {
    organizationId,
    organization,
    activeBrandProject,
  } = useOrgContext();

  const {
    activeSession,
    activeGenerations,
    selectedGeneration,
    subscribeToGenerations,
    resetPostProduction,
    updatePostProduction,
    videoJobState,
    setVideoJobMinimized,
    dismissVideoJob,
    startVideoGeneration,
    loadSession,
    createNewSession,
    clearActiveSession,
    selectGeneration,
    setSelectedGenerationId,
  } = useSessionStore();

  const brandKit = useBrandKitStore((state) => state.brandKit);
  const loadBrandKit = useBrandKitStore((state) => state.loadBrandKit);

  const [postPanelOpen, setPostPanelOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [prefillScheduleDate, setPrefillScheduleDate] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [generationIndex, setGenerationIndex] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedAssetReferences, setSelectedAssetReferences] = useState([]);
  const searchRef = useRef(null);
  const handledIntentRef = useRef(null);
  const skipNextPostResetRef = useRef(false);

  const intentKey = useMemo(() => getIntentKey(intent), [intent]);
  const intentMode = String(intent?.mode || 'new').trim().toLowerCase();
  const contextNote = String(intent?.contextNote || '').trim();
  const composerHeading = useMemo(() => {
    switch (intentMode) {
      case 'revision':
        return 'Revise Draft';
      case 'edit':
        return 'Edit Draft';
      case 'repurpose':
        return 'Repurpose Draft';
      default:
        return 'Create a Draft';
    }
  }, [intentMode]);

  const openPersonalSettings = useCallback(async (path) => {
    await switchWorkspace('personal');
    onClose();
    navigate(path);
  }, [navigate, onClose, switchWorkspace]);

  const loadSearchIndex = useCallback(async () => {
    if (!user?.id || !open) {
      setGenerationIndex([]);
      return;
    }

    setSearchLoading(true);

    try {
      const { data: generationRows, error: generationError } = await supabase
        .from('generations')
        .select('id, session_id, prompt, status, created_at, metadata')
        .eq('user_id', user.id)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(GENERATION_SEARCH_LIMIT);

      if (generationError) throw generationError;

      const sessionIds = [...new Set((generationRows ?? []).map((row) => row.session_id).filter(Boolean))];
      const sessionTitleMap = new Map();

      if (sessionIds.length > 0) {
        const { data: sessions, error: sessionsError } = await supabase
          .from('sessions')
          .select('id, title')
          .eq('workspace_type', 'organization')
          .eq('organization_id', organizationId)
          .in('id', sessionIds);

        if (sessionsError) throw sessionsError;

        (sessions ?? []).forEach((session) => {
          sessionTitleMap.set(session.id, session.title ?? '');
        });
      }

      setGenerationIndex(
        (generationRows ?? []).map((row) => ({
          ...row,
          session_title: row.session_id ? sessionTitleMap.get(row.session_id) ?? '' : '',
        })),
      );
    } catch (error) {
      console.error('Failed to load org generate search index:', error);
    } finally {
      setSearchLoading(false);
    }
  }, [open, organizationId, user?.id]);

  const handleCreateSession = useCallback(async () => {
    setPostPanelOpen(false);
    setSelectedGenerationId(null);
    selectGeneration(null);
    resetPostProduction();
    setPrefillScheduleDate(null);
    clearActiveSession();
  }, [clearActiveSession, resetPostProduction, selectGeneration, setSelectedGenerationId]);

  const handleSelectSession = useCallback(async (sessionId) => {
    await loadSession(sessionId);
    setPostPanelOpen(false);
  }, [loadSession]);

  const handleSearchSelect = useCallback(async (generation) => {
    if (!generation?.session_id) return;

    setSearchOpen(false);
    setSearchQuery('');
    await loadSession(generation.session_id);

    const nextState = useSessionStore.getState();
    const target = (nextState.activeGenerations || []).find((item) => item.id === generation.id) || null;
    if (target) {
      selectGeneration(target);
      setSelectedGenerationId(target.id);
    } else {
      setSelectedGenerationId(generation.id);
    }
  }, [loadSession, selectGeneration, setSelectedGenerationId]);

  const applyEditorStateFromPost = useCallback(async (postId) => {
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select(`
        id,
        generation_id,
        caption,
        hashtags,
        status,
        account_id,
        scheduled_at,
        generations ( id, session_id, prompt, storage_path, media_type, content_plan_id )
      `)
      .eq('id', postId)
      .maybeSingle();

    if (postError) throw postError;
    if (!post?.generation_id) return;

    if (post.generations?.session_id) {
      await loadSession(post.generations.session_id);
    } else if (!activeSession?.id) {
      await createNewSession(post.title || post.generations?.prompt || 'Draft Session');
    }

    const nextState = useSessionStore.getState();
    const generationFromState = (nextState.activeGenerations || []).find(
      (item) => item.id === post.generation_id,
    ) || null;
    const fallbackGeneration = post.generations ? { ...post.generations } : null;

    skipNextPostResetRef.current = true;
    if (generationFromState) {
      selectGeneration(generationFromState);
      setSelectedGenerationId(generationFromState.id);
    } else if (fallbackGeneration) {
      const nextGeneration = {
        ...fallbackGeneration,
        prompt: fallbackGeneration.prompt || post.caption || '',
      };
      selectGeneration(nextGeneration);
      setSelectedGenerationId(nextGeneration.id);
    } else {
      setSelectedGenerationId(post.generation_id);
      selectGeneration(post.generation_id);
    }

    const captionWithNoTags = String(post.caption || '')
      .replace(/#[\w_]+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const hashtags = Array.isArray(post.hashtags) && post.hashtags.length > 0
      ? post.hashtags
      : (String(post.caption || '').match(/#[\w_]+/g) || []);

    updatePostProduction({
      caption: captionWithNoTags || post.generations?.prompt || '',
      hashtags,
      selectedPlatforms: post.account_id ? [post.account_id] : [],
    });
  }, [
    activeSession?.id,
    createNewSession,
    loadSession,
    selectGeneration,
    setSelectedGenerationId,
    updatePostProduction,
  ]);

  const applyIntent = useCallback(async (nextIntent) => {
    if (!open || !user?.id) return;

    const targetIntent = nextIntent || { mode: 'new' };
    const targetPostId = targetIntent?.editPostId || targetIntent?.repurposeFromPostId || null;
    const templateId = targetIntent?.templateId || null;
    const seededPrompt = String(targetIntent?.seedPrompt || '').trim();

    setPostPanelOpen(false);
    setSelectedGenerationId(null);
    selectGeneration(null);
    resetPostProduction();
    const nextAssetReferences = Array.isArray(targetIntent?.assetReferences)
      ? targetIntent.assetReferences
      : (targetIntent?.assetReference ? [targetIntent.assetReference] : []);
    setSelectedAssetReferences(nextAssetReferences);

    if (targetIntent?.prefillDate) {
      const parsedDate = new Date(targetIntent.prefillDate);
      if (!Number.isNaN(parsedDate.getTime())) {
        setPrefillScheduleDate(parsedDate.toISOString());
      }
    } else {
      setPrefillScheduleDate(null);
    }

    if (templateId) {
      clearActiveSession();
      const { data: template, error: templateError } = await supabase
        .from('content_templates')
        .select('id, caption_format')
        .eq('id', templateId)
        .maybeSingle();

      if (templateError) throw templateError;

      const seededPrompt = String(template?.caption_format || '').trim();
      if (seededPrompt && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('socialai:seed-prompt', {
          detail: { prompt: seededPrompt },
        }));
      }
      return;
    }

    if (targetPostId) {
      await applyEditorStateFromPost(targetPostId);
      return;
    }

    if (targetIntent?.sessionId) {
      await loadSession(targetIntent.sessionId);
      return;
    }

    clearActiveSession();

    if (seededPrompt && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('socialai:seed-prompt', {
        detail: { prompt: seededPrompt },
      }));
    }
  }, [
    applyEditorStateFromPost,
    clearActiveSession,
    createNewSession,
    loadSession,
    open,
    resetPostProduction,
    selectGeneration,
    setSelectedGenerationId,
    user?.id,
  ]);

  useEffect(() => {
    if (!open) return undefined;

    if (typeof window !== 'undefined') {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = previousOverflow;
      };
    }

    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open || !user?.id) return;
    loadBrandKit(user.id);
  }, [loadBrandKit, open, user?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const unsubscribe = subscribeToGenerations();
    return unsubscribe;
  }, [open, subscribeToGenerations]);

  useEffect(() => {
    if (!open) return;
    if (!brandKit) return;
    const alreadyShown = sessionStorage.getItem('brandKitPromptShown');
    if (!brandKit.setup_completed && !brandKit.setup_skipped && !alreadyShown) {
      sessionStorage.setItem('brandKitPromptShown', '1');
      setShowOnboarding(true);
    }
  }, [brandKit, open]);

  useEffect(() => {
    if (!open) return;
    loadSearchIndex();
  }, [loadSearchIndex, open]);

  useEffect(() => {
    if (!open || handledIntentRef.current === intentKey) return;

    let cancelled = false;

    const run = async () => {
      try {
        await applyIntent(intent || { mode: 'new' });
        if (!cancelled) {
          handledIntentRef.current = intentKey;
        }
      } catch (error) {
        console.error('Failed to initialize org composer intent:', error);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [applyIntent, intent, intentKey, open]);

  useEffect(() => {
    if (!open) {
      handledIntentRef.current = null;
      setSearchQuery('');
      setSearchOpen(false);
      setPostPanelOpen(false);
      setPrefillScheduleDate(null);
      setSelectedAssetReferences([]);
      selectGeneration(null);
      setSelectedGenerationId(null);
    }
  }, [open, selectGeneration, setSelectedGenerationId]);

  useEffect(() => {
    if (!open || !selectedGeneration) return;

    setPostPanelOpen(true);
    if (skipNextPostResetRef.current) {
      skipNextPostResetRef.current = false;
    } else {
      resetPostProduction();
      if (prefillScheduleDate) {
        updatePostProduction({ scheduleDate: prefillScheduleDate });
        setPrefillScheduleDate(null);
      }
    }
  }, [
    open,
    prefillScheduleDate,
    resetPostProduction,
    selectedGeneration?.id,
    updatePostProduction,
  ]);

  useEffect(() => {
    if (!open) return undefined;

    const handleContentSync = () => {
      loadSearchIndex();
    };

    window.addEventListener('socialai:data-sync', handleContentSync);
    return () => {
      window.removeEventListener('socialai:data-sync', handleContentSync);
    };
  }, [loadSearchIndex, open]);

  useEffect(() => {
    if (!searchOpen) return undefined;

    const handleClickAway = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setSearchOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickAway);
    return () => document.removeEventListener('mousedown', handleClickAway);
  }, [searchOpen]);

  const handleClosePostPanel = () => {
    setPostPanelOpen(false);
    selectGeneration(null);
    setSelectedGenerationId(null);
  };

  const handleViewCompletedVideo = () => {
    const completedVideo = activeGenerations.find((item) => (
      item.id === videoJobState.generationId
      && item.media_type === 'video'
      && item.status === GENERATION_STATUS.COMPLETED
    ));

    if (completedVideo) {
      selectGeneration(completedVideo);
      setSelectedGenerationId(completedVideo.id);
    }

    dismissVideoJob();
  };

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!normalizedSearchQuery) return [];

    return generationIndex
      .filter((generation) => getGenerationSearchText(generation).includes(normalizedSearchQuery))
      .slice(0, 8)
      .map((generation) => ({
        ...generation,
        title: getGenerationTitle(generation),
      }));
  }, [generationIndex, normalizedSearchQuery]);

  if (!open) return null;

  return (
    <div className="org-generate-modal" role="dialog" aria-modal="true" aria-label="Create org draft">
      <Toaster
        position="top-center"
        gutter={8}
        toastOptions={{
          duration: 4000,
          style: {
            background: 'var(--gen-panel)',
            color: 'var(--gen-text-1)',
            border: '1px solid var(--gen-border)',
            borderRadius: '10px',
            fontSize: '0.875rem',
            fontWeight: '500',
            boxShadow: 'var(--gen-shadow-md)',
          },
          success: {
            iconTheme: { primary: 'var(--org-success)', secondary: 'var(--color-text-inverse)' },
          },
          error: {
            iconTheme: { primary: 'var(--org-danger)', secondary: 'var(--color-text-inverse)' },
          },
        }}
      />

      <div className="org-generate-backdrop" onClick={onClose} aria-hidden="true" />

      <section className="org-generate-surface">
        <header className="org-generate-header">
          <div className="org-generate-copy">
            <span className="org-generate-kicker">Org Composer</span>
            <h2>{composerHeading}</h2>
            <p>
              {organization?.name || 'Organization'}
              {activeBrandProject?.name ? ` / ${activeBrandProject.name}` : ''}
            </p>
            {intentMode === 'revision' && contextNote ? (
              <div className="org-generate-intent-note">
                <strong>Revision request</strong>
                <span>{contextNote}</span>
              </div>
            ) : null}
          </div>

          <div className="org-generate-actions">
            <div className="org-generate-search" ref={searchRef}>
              <Search size={14} />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Search past sessions and generations..."
              />

              {searchOpen && normalizedSearchQuery ? (
                <div className="org-generate-search-results">
                  {searchLoading ? (
                    <div className="org-generate-search-empty">Searching…</div>
                  ) : searchResults.length === 0 ? (
                    <div className="org-generate-search-empty">No matching generations found.</div>
                  ) : (
                    searchResults.map((generation) => (
                      <button
                        key={generation.id}
                        type="button"
                        className="org-generate-search-result"
                        onClick={() => handleSearchSelect(generation)}
                      >
                        <strong>{generation.title}</strong>
                        <span>{generation.session_title || 'Untitled session'}</span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className="org-secondary-button"
              onClick={handleCreateSession}
            >
              <Sparkles size={14} />
              New Session
            </button>

            <button
              type="button"
              className="org-close-button"
              onClick={onClose}
              aria-label="Close org composer"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="org-generate-workspace">
          <div className="org-generate-canvas-shell">
            <div className="org-generate-meta-bar">
              <span>Active session: {activeSession?.title || 'New Session'}</span>
              <div className="org-generate-meta-copy">
                {selectedAssetReferences.length > 0 ? (
                  <span className="org-generate-asset-pill">
                    {selectedAssetReferences.length === 1
                      ? `Ref asset: ${selectedAssetReferences[0].name}`
                      : `${selectedAssetReferences.length} library assets linked`}
                  </span>
                ) : null}
                <span>{organizationId ? 'Organization scoped' : 'Personal scoped'}</span>
              </div>
            </div>

            <BrandKitPanel />

            <GenerationCanvas
              settingsPath="/app/settings/brand-kit"
              onOpenSettings={openPersonalSettings}
            />
          </div>

          {postPanelOpen && selectedGeneration ? (
            <PostProductionPanel
              onClose={handleClosePostPanel}
              settingsPath="/app/settings"
              onOpenSettings={openPersonalSettings}
            />
          ) : null}
        </div>

        {showOnboarding ? (
          <BrandKitOnboardingModal
            userId={user?.id}
            onClose={() => setShowOnboarding(false)}
          />
        ) : null}

        {videoJobState.status ? (
          videoJobState.isMinimized ? (
            <VideoStatusBar
              status={videoJobState.status}
              progress={videoJobState.progress}
              onExpand={() => setVideoJobMinimized(false)}
              onDismiss={dismissVideoJob}
            />
          ) : (
            <VideoProcessingModal
              jobId={videoJobState.jobId}
              prompt={videoJobState.prompt}
              status={videoJobState.status}
              progress={videoJobState.progress}
              videoUrl={videoJobState.videoUrl}
              onMinimize={() => setVideoJobMinimized(true)}
              onDismiss={dismissVideoJob}
              onRetry={async () => {
                try {
                  await startVideoGeneration(videoJobState.prompt);
                } catch (_error) {
                  // Store error handling already covers the visible state.
                }
              }}
              onViewInCanvas={handleViewCompletedVideo}
            />
          )
        ) : null}
      </section>
    </div>
  );
}
