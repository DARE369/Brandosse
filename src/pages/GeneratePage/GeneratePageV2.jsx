"use client";

// src/pages/GeneratePage/GeneratePageV2.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import useSessionStore from '../../stores/SessionStore';
import { supabase } from '../../services/supabaseClient';
import StudioPage from '../Studio/StudioPage';
import BrandKitOnboardingModal from '../../components/BrandKit/BrandKitOnboardingModal';
import useBrandKitStore from '../../stores/BrandKitStore';
import { useAuth } from '../../Context/AuthContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import { GENERATION_STATUS } from '../../constants/statuses';
import {
  clearOrgRuntimeContext,
  setOrgRuntimeContext,
} from '../../org/stores/orgRuntimeStore';
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

function buildGenerationRoute(generation) {
  const sessionPath = generation?.session_id
    ? `/app/generate/${generation.session_id}`
    : '/app/generate';
  return generation?.id ? `${sessionPath}#${generation.id}` : sessionPath;
}

function getSessionIdFromPathname(pathname) {
  const match = String(pathname || '').match(/^\/app\/generate\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export default function GeneratePageV2({ sessionId: sessionIdProp = null }) {
  const { user } = useAuth();
  const { navigate, location } = useAppNavigation();
  const sessionId = sessionIdProp ?? getSessionIdFromPathname(location.pathname);

  const {
    activeSession,
    activeGenerations,
    selectedGeneration,
    subscribeToSession,
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
    setGenerationLineage,
    setPromptSeed,
  } = useSessionStore();

  const brandKit = useBrandKitStore((s) => s.brandKit);
  const loadBrandKit = useBrandKitStore((s) => s.loadBrandKit);

  const [postPanelOpen, setPostPanelOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [prefillScheduleDate, setPrefillScheduleDate] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [generationIndex, setGenerationIndex] = useState([]);
  const creatingSessionRef = useRef(false);
  const routeStateHandledRef = useRef(null);
  const skipNextPostResetRef = useRef(false);

  const clearRouteState = useCallback(() => {
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: {},
    });
  }, [navigate, location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (user?.id) {
      loadBrandKit(user.id);
    }
  }, [user?.id, loadBrandKit]);

  const loadSearchIndex = useCallback(async () => {
    if (!user?.id) {
      setGenerationIndex([]);
      return;
    }

    setSearchLoading(true);

    try {
      const { data: generationRows, error: generationError } = await supabase
        .from('generations')
        .select('id, session_id, prompt, status, created_at, metadata')
        .eq('user_id', user.id)
        .is('organization_id', null)
        .order('created_at', { ascending: false })
        .limit(GENERATION_SEARCH_LIMIT);

      if (generationError) throw generationError;

      const sessionIds = [...new Set((generationRows ?? []).map((row) => row.session_id).filter(Boolean))];
      const sessionTitleMap = new Map();

      if (sessionIds.length > 0) {
        const { data: sessions, error: sessionsError } = await supabase
          .from('sessions')
          .select('id, title')
          .eq('workspace_type', 'personal')
          .is('organization_id', null)
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
      console.error('Failed to load generate search index:', error);
    } finally {
      setSearchLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadSearchIndex();
  }, [loadSearchIndex]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleContentSync = () => {
      loadSearchIndex();
    };

    window.addEventListener('socialai:data-sync', handleContentSync);
    return () => {
      window.removeEventListener('socialai:data-sync', handleContentSync);
    };
  }, [loadSearchIndex]);

  useEffect(() => {
    const routeOrgContext = location.state?.orgContext;
    if (!routeOrgContext) return undefined;

    setOrgRuntimeContext({
      organizationId: routeOrgContext.organizationId ?? routeOrgContext.organization_id ?? null,
      brandProjectId: routeOrgContext.brandProjectId ?? routeOrgContext.brand_project_id ?? null,
      organization: routeOrgContext.organization ?? (
        routeOrgContext.organizationName
          ? { name: routeOrgContext.organizationName }
          : null
      ),
      brandProject: routeOrgContext.brandProject ?? (
        routeOrgContext.brandProjectName
          ? { name: routeOrgContext.brandProjectName }
          : null
      ),
      role: routeOrgContext.role ?? null,
      permissions: routeOrgContext.permissions ?? {},
      source: 'route-state',
    });

    return () => {
      clearOrgRuntimeContext('route-state');
    };
  }, [location.state?.orgContext]);

  useEffect(() => {
    if (!brandKit) return;
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    const alreadyShown = window.sessionStorage.getItem('brandKitPromptShown');
    if (!brandKit.setup_completed && !brandKit.setup_skipped && !alreadyShown) {
      window.sessionStorage.setItem('brandKitPromptShown', '1');
      setShowOnboarding(true);
    }
  }, [brandKit]);

  // Session-scoped realtime subscription (Week 2 Fix 1) — keyed on
  // activeSession?.id so React's own cleanup-before-rerun guarantees the
  // previous session's channel is torn down before the new one is created,
  // covering every action that changes activeSession (loadSession,
  // createNewSession, clearActiveSession) without needing any of those
  // actions to know about realtime. No session yet → subscribeToSession(null)
  // is a deliberate no-op (see its own comment) — subscribes lazily the
  // moment a session exists.
  useEffect(() => {
    const unsubscribe = subscribeToSession(activeSession?.id ?? null);
    return unsubscribe;
  }, [activeSession?.id, subscribeToSession]);

  useEffect(() => {
    if (selectedGeneration) {
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
    }
  }, [selectedGeneration?.id, resetPostProduction, updatePostProduction, prefillScheduleDate]);

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;
    const routeState = location.state || {};
    const requiresPersistedSession = Boolean(
      routeState.repurposeFromPostId
      || routeState.editPostId
      || routeState.templateId
      || routeState.libraryAssetId
      || routeState.useLibraryAssetId,
    );

    const initSession = async () => {
      if (sessionId) {
        creatingSessionRef.current = false;
        const loadedSession = await loadSession(sessionId);
        if (cancelled) return;

        if (!loadedSession) {
          if (requiresPersistedSession) {
            const fallbackSession = await createNewSession('Draft Session');
            if (!cancelled && fallbackSession?.id) {
              navigate(`/app/generate/${fallbackSession.id}`, { replace: true, state: location.state ?? {} });
            }
          } else {
            clearActiveSession();
            navigate('/app/generate', { replace: true, state: location.state ?? {} });
          }
        }
        return;
      }

      if (!requiresPersistedSession) {
        creatingSessionRef.current = false;
        clearActiveSession();
        return;
      }

      if (creatingSessionRef.current) return;
      creatingSessionRef.current = true;
      const nextSession = await createNewSession('Draft Session');
      if (!cancelled && nextSession?.id) {
        navigate(`/app/generate/${nextSession.id}`, { replace: true, state: location.state ?? {} });
      }
    };

    initSession();

    return () => {
      cancelled = true;
    };
  }, [user?.id, sessionId, loadSession, createNewSession, clearActiveSession, navigate, location.state]);

  useEffect(() => {
    const prefillDateRaw = location.state?.prefillDate;
    if (!prefillDateRaw) return;
    const parsedDate = new Date(prefillDateRaw);
    if (Number.isNaN(parsedDate.getTime())) return;
    setPrefillScheduleDate(parsedDate.toISOString());
  }, [location.state?.prefillDate]);

  useEffect(() => {
    const routeState = location.state || {};
    const repurposeFromPostId = routeState.repurposeFromPostId || null;
    const editPostId = routeState.editPostId || null;
    const templateId = routeState.templateId || null;
    const libraryAssetId = routeState.libraryAssetId || routeState.useLibraryAssetId || null;
    const libraryLineage = routeState.libraryLineage || null;
    const activateEditMode = Boolean(routeState.activateEditMode);

    if (!sessionId) return;
    if (!repurposeFromPostId && !editPostId && !templateId && !libraryAssetId) return;

    const routeStateKey = JSON.stringify({
      sessionId,
      repurposeFromPostId,
      editPostId,
      templateId,
      libraryAssetId,
      libraryLineageSource: libraryLineage?.source || null,
      libraryLineageId: libraryLineage?.sourceId || null,
      activateEditMode,
    });

    if (routeStateHandledRef.current === routeStateKey) return;

    let cancelled = false;

    const run = async () => {
      try {
        if (libraryAssetId) {
          const { data: mediaAsset, error: mediaError } = await supabase
            .from('media_assets')
            .select('id, user_id, file_name, file_type, public_url, thumbnail_url, platform_targets')
            .eq('id', libraryAssetId)
            .maybeSingle();

          if (mediaError) throw mediaError;
          if (!mediaAsset || mediaAsset.user_id !== user?.id) {
            if (!cancelled) {
              toast.error("Couldn't load the item you selected — it may have been moved or deleted.");
              routeStateHandledRef.current = routeStateKey;
              clearRouteState();
            }
            return;
          }

          const seededPrompt = String(
            routeState.prefillPrompt
              || `Create a social post concept that uses this media asset: ${mediaAsset.file_name || 'Library media'}.`,
          ).trim();

          if (seededPrompt) {
            setPromptSeed({
              text: seededPrompt,
              source: 'library_media',
              assetReference: {
                id: mediaAsset.id,
                name: mediaAsset.file_name || 'Library asset',
                fileType: mediaAsset.file_type || 'image',
                fileUrl: mediaAsset.public_url || null,
                thumbnailUrl: mediaAsset.thumbnail_url || mediaAsset.public_url || null,
              },
            });
          }

          updatePostProduction({
            assetReferences: [{
              id: mediaAsset.id,
              name: mediaAsset.file_name || 'Library asset',
              fileType: mediaAsset.file_type || 'image',
              fileUrl: mediaAsset.public_url || null,
              thumbnailUrl: mediaAsset.thumbnail_url || mediaAsset.public_url || null,
              assetRole: 'primary',
            }],
          });

          setGenerationLineage({
            source: libraryLineage?.source || 'library_media',
            sourceId: libraryLineage?.sourceId || mediaAsset.id,
            metadata: {
              media_asset_id: mediaAsset.id,
              file_name: mediaAsset.file_name || null,
              file_type: mediaAsset.file_type || null,
              platform_targets: Array.isArray(mediaAsset.platform_targets) ? mediaAsset.platform_targets : [],
              ...(libraryLineage?.metadata && typeof libraryLineage.metadata === 'object'
                ? libraryLineage.metadata
                : {}),
            },
          });

          if (!cancelled) {
            routeStateHandledRef.current = routeStateKey;
            clearRouteState();
          }
          return;
        }

        setGenerationLineage(null);

        if (templateId) {
          const { data: template, error: templateError } = await supabase
            .from('content_templates')
            .select('id, caption_format')
            .eq('id', templateId)
            .maybeSingle();

          if (templateError) throw templateError;

          if (!template && !cancelled) {
            toast.error("Couldn't load that template — it may have been moved or deleted.");
          }

          const seededPrompt = String(template?.caption_format || '').trim();
          if (seededPrompt && !cancelled) {
            setPromptSeed({ text: seededPrompt, source: 'template' });
          }

          if (!cancelled) {
            routeStateHandledRef.current = routeStateKey;
            clearRouteState();
          }
          return;
        }

        const targetPostId = repurposeFromPostId || editPostId;
        if (!targetPostId) return;

        const { data: post, error: postError } = await supabase
          .from('posts')
          .select(`
            id,
            title,
            generation_id,
            caption,
            hashtags,
            status,
            account_id,
            scheduled_at,
            generations ( id, session_id, prompt, storage_path, media_type, content_plan_id )
          `)
          .eq('id', targetPostId)
          .maybeSingle();

        if (postError) throw postError;
        if (!post?.generation_id) {
          if (!cancelled) {
            toast.error("Couldn't load the post you selected — it may have been moved or deleted.");
            routeStateHandledRef.current = routeStateKey;
            clearRouteState();
          }
          return;
        }

        const targetSessionId = post.generations?.session_id || sessionId;
        if (targetSessionId && targetSessionId !== sessionId) {
          await loadSession(targetSessionId);
          if (cancelled) return;
          routeStateHandledRef.current = routeStateKey;
          navigate(`/app/generate/${targetSessionId}#${post.generation_id}`, { replace: true, state: routeState });
          return;
        }

        const active = useSessionStore.getState().activeGenerations || [];
        const generationFromState = active.find((item) => item.id === post.generation_id) || null;
        const fallbackGeneration = post.generations
          ? { ...post.generations }
          : null;

        if (!cancelled) {
          skipNextPostResetRef.current = true;
          if (generationFromState) {
            selectGeneration(generationFromState);
          } else if (fallbackGeneration) {
            selectGeneration({
              ...fallbackGeneration,
              prompt: fallbackGeneration.prompt || post.caption || '',
            });
          } else {
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
            postId: post.id,
            title: post.title || '',
            caption: captionWithNoTags || post.generations?.prompt || '',
            hashtags,
            selectedPlatforms: post.account_id ? [post.account_id] : [],
            scheduleDate: post.status === 'scheduled' ? post.scheduled_at : null,
          });

          routeStateHandledRef.current = routeStateKey;
          if (activateEditMode) {
            setPromptSeed({
              text: captionWithNoTags || post.generations?.prompt || '',
              source: 'repurpose_edit',
              activateEditMode: true,
              sourceImageUrl: generationFromState?.storage_path || fallbackGeneration?.storage_path || null,
            });
          }
          if (post.generation_id) {
            navigate(`${location.pathname}${location.search}#${post.generation_id}`, {
              replace: true,
              state: {},
            });
          } else {
            clearRouteState();
          }
        }
      } catch (error) {
        console.error('Failed to apply generate route state:', error);
        if (!cancelled) {
          toast.error("Couldn't load the item you selected — it may have been moved or deleted.");
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [
    user?.id,
    location.state,
    navigate,
    sessionId,
    updatePostProduction,
    selectGeneration,
    loadSession,
    clearRouteState,
    setGenerationLineage,
    setPromptSeed,
    location.pathname,
    location.search,
    location.hash,
  ]);

  useEffect(() => {
    const generationId = location.hash.replace('#', '').trim();
    setSelectedGenerationId(generationId || null);
    if (!generationId) return undefined;

    const timer = setTimeout(() => {
      document.getElementById(`gen-card-${generationId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 240);

    return () => clearTimeout(timer);
  }, [location.hash, setSelectedGenerationId, activeGenerations.length]);

  const handleClosePostPanel = () => {
    setPostPanelOpen(false);
    selectGeneration(null);
  };

  const handleViewCompletedVideo = () => {
    const completedVideo = activeGenerations.find((item) => (
      item.id === videoJobState.generationId
      && item.media_type === 'video'
      && item.status === GENERATION_STATUS.COMPLETED
    ));

    if (completedVideo) {
      selectGeneration(completedVideo);
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

  return (
    <>
      <Toaster
        position="top-center"
        gutter={8}
        toastOptions={{ duration: 4000 }}
      />

      <StudioPage />

      {showOnboarding && (
        <BrandKitOnboardingModal
          userId={user?.id}
          onClose={() => setShowOnboarding(false)}
        />
      )}
    </>
  );
}
