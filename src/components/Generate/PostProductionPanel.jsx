// src/components/Generate/PostProductionPanel.jsx
import React, { useState, useEffect, useRef } from 'react';
import {
  X, Wand2, Hash, Calendar, Instagram, Linkedin, Youtube,
  CheckCircle2, Send, TrendingUp, AlertTriangle, Wifi, RefreshCw, ShieldCheck, GitBranch,
  Twitter, Facebook,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../services/supabaseClient';
import useSessionStore from '../../stores/SessionStore';
import useOrgContext from '../../org/hooks/useOrgContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import {
  createDirectPublishPipelineItem,
  fetchPipelineConfigs,
  submitPostToPipeline,
} from '../../org/services/pipelineService';
import { POST_STATUS } from '../../constants/statuses';
const FALLBACK_VIDEO_URL = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

function resolveVideoSource(url) {
  if (!url) return FALLBACK_VIDEO_URL;
  return url.includes('video.pollinations.ai') ? FALLBACK_VIDEO_URL : url;
}

// Platform icon map.
const PLATFORM_ICONS = {
  instagram: Instagram,
  linkedin:  Linkedin,
  youtube:   Youtube,
  twitter:   Twitter,
  facebook:  Facebook,
};

function PlatformIcon({ platform, size = 18 }) {
  const Icon = PLATFORM_ICONS[platform?.toLowerCase()] ?? Wifi;
  return <Icon size={size} />;
}

// Steps config.
const STEPS = [
  { id: 1, label: 'Content' },
  { id: 2, label: 'SEO' },
  { id: 3, label: 'Publish' },
];

// Character limits per platform.
const CHAR_LIMITS = {
  instagram: 2200,
  twitter:   280,
  linkedin:  3000,
  facebook:  63206,
  youtube:   5000,
  default:   2200,
};

function getCharLimit(selectedAccountIds, accounts) {
  if (selectedAccountIds.length === 0) return CHAR_LIMITS.default;
  const platforms = selectedAccountIds
    .map(id => accounts.find(a => a.id === id)?.platform?.toLowerCase())
    .filter(Boolean);
  // Return the most restrictive limit
  return Math.min(...platforms.map(p => CHAR_LIMITS[p] ?? CHAR_LIMITS.default));
}

function formatRoleLabel(value) {
  return String(value || 'role')
    .trim()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getStageCount(config) {
  return Array.isArray(config?.stages) ? config.stages.length : 0;
}

function normalizePlatform(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'instagram';
  if (normalized === 'x') return 'twitter';
  return normalized;
}

function getPlatformDisplayName(value) {
  const normalized = normalizePlatform(value);
  if (normalized === 'tiktok') return 'TikTok';
  if (normalized === 'youtube') return 'YouTube';
  if (normalized === 'facebook') return 'Facebook';
  if (normalized === 'instagram') return 'Instagram';
  if (normalized === 'linkedin') return 'LinkedIn';
  if (normalized === 'twitter') return 'X';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatScheduleLabel(value) {
  if (!value) return 'Post now';
  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) return 'Scheduled';
  return nextDate.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ============================================================================
export default function PostProductionPanel({
  onClose,
  settingsPath = '/app/settings',
  onOpenSettings = null,
}) {
  const { navigate } = useAppNavigation();
  const {
    selectedGeneration,
    postProduction,
    updatePostProduction,
    regeneratePostMetadata,
    scoreSeo,
    optimizeSeo,
    hydratePostProductionFromGeneration,
    saveDraft,
    preparePostForApproval,
    publishContent,
  } = useSessionStore();
  const selectedId = useSessionStore((s) => s.selectedGeneration?.id);
  const {
    organizationId,
    brandProjectId,
    hasPermission,
  } = useOrgContext();

  const [step,              setStep]            = useState(1);
  const [loading,           setLoading]         = useState(false);
  const [isPublishInFlight, setIsPublishInFlight] = useState(false);
  const [accounts,          setAccounts]        = useState([]);
  const [accountsLoading,   setAccountsLoading] = useState(true);
  const [success,           setSuccess]         = useState(null); // { message, status }
  const [newTag,            setNewTag]          = useState('');
  const [contentPlan,       setContentPlan]     = useState(null);
  const [metadataBusyField, setMetadataBusyField] = useState('');
  const [pipelineConfigs, setPipelineConfigs] = useState([]);
  const [pipelineConfigsLoading, setPipelineConfigsLoading] = useState(false);
  const [selectedPipelineConfigId, setSelectedPipelineConfigId] = useState('');
  const [publishRoute, setPublishRoute] = useState('approval');
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const publishInFlightRef = useRef(false);

  useEffect(() => {
    setStep(1);
    setSuccess(null);
    setLoading(false);
    setNewTag('');
    setPipelineConfigs([]);
    setPipelineConfigsLoading(false);
    setSelectedPipelineConfigId('');
    setPublishRoute('approval');
    setApprovalSubmitting(false);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedGeneration?.id) return;

    hydratePostProductionFromGeneration(selectedGeneration.id)
      .catch((err) => {
        console.error('Failed to hydrate post-production state:', err);
      });
  }, [selectedGeneration?.id, hydratePostProductionFromGeneration]);

  useEffect(() => {
    if (!selectedGeneration?.id) return () => {};

    const handleContentSync = () => {
      void hydratePostProductionFromGeneration(selectedGeneration.id);
    };

    window.addEventListener('socialai:data-sync', handleContentSync);
    return () => {
      window.removeEventListener('socialai:data-sync', handleContentSync);
    };
  }, [selectedGeneration?.id, hydratePostProductionFromGeneration]);

  useEffect(() => {
    if (!selectedGeneration?.id) return () => {};
    if (postProduction.metadataStatus !== 'in_progress') return () => {};

    const intervalId = window.setInterval(() => {
      void hydratePostProductionFromGeneration(selectedGeneration.id);
    }, 2200);

    return () => window.clearInterval(intervalId);
  }, [
    hydratePostProductionFromGeneration,
    postProduction.metadataStatus,
    selectedGeneration?.id,
  ]);

  useEffect(() => {
    let mounted = true;
    const contentPlanId = selectedGeneration?.content_plan_id;
    if (!contentPlanId) {
      setContentPlan(null);
      return () => { mounted = false; };
    }

    supabase
      .from('content_plans')
      .select('content_plan')
      .eq('id', contentPlanId)
      .single()
      .then(({ data }) => {
        if (mounted) {
          setContentPlan(data?.content_plan ?? null);
        }
      });

    return () => { mounted = false; };
  }, [selectedGeneration?.content_plan_id]);

  useEffect(() => {
    if (!contentPlan) return;

    const nextCaption = contentPlan.caption?.primary
      || contentPlan.seo?.optimized_caption
      || '';
    const nextHashtags = contentPlan.seo?.optimized_hashtags
      || contentPlan.hashtags?.platform_sets?.instagram
      || contentPlan.hashtags?.primary
      || [];

    if (nextCaption && !postProduction.caption) {
      updatePostProduction({ caption: nextCaption });
    }
    if (Array.isArray(nextHashtags) && nextHashtags.length > 0 && postProduction.hashtags.length === 0) {
      updatePostProduction({ hashtags: nextHashtags });
    }
  }, [contentPlan, postProduction.caption, postProduction.hashtags.length, updatePostProduction]);

  // Fetch connected accounts (filtered to active + expired).
  useEffect(() => {
    let mounted = true;
    async function fetchAccounts() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('connected_accounts')
          .select('id, user_id, organization_id, scope, platform, account_name, display_name, username, avatar_url, profile_picture_url, connection_status, is_mock')
          .eq('user_id', user.id)
          // P1 FIX: only fetch non-error accounts; expired shown with reconnect CTA
          .in('connection_status', ['active', 'mock', 'expired'])
          .order('platform');

        if (error) throw error;
        if (mounted) setAccounts(data || []);
      } catch (err) {
        console.error('fetchAccounts:', err);
        toast.error('Could not load connected accounts');
      } finally {
        if (mounted) setAccountsLoading(false);
      }
    }
    fetchAccounts();
    return () => { mounted = false; };
  }, []);

  const charLimit = getCharLimit(postProduction.selectedPlatforms, accounts);
  const charCount = postProduction.caption.length;
  const isOverLimit = charCount > charLimit;
  const selectedPlatformNames = postProduction.selectedPlatforms
    .map((accountId) => {
      const account = accounts.find((entry) => entry.id === accountId);
      return String(account?.platform || '').trim().toLowerCase();
    })
    .filter(Boolean);
  const youtubeSelected = selectedPlatformNames.includes('youtube');
  const metadataLoading = postProduction.metadataStatus === 'in_progress';
  const seoBusy = postProduction.seoStatus === 'scoring' || postProduction.seoStatus === 'optimizing';
  const seoScoreReady = postProduction.seoStatus === 'scored';
  const isOrgWorkspace = Boolean(organizationId);
  const canPublish = Boolean(hasPermission?.('can_publish'));
  const requiresFinalApproval = Boolean(hasPermission?.('publish_requires_final_approval'));
  const canDirectPublish = canPublish && !requiresFinalApproval;
  const approvalOnlyRoute = isOrgWorkspace && !canDirectPublish;
  const activePublishRoute = approvalOnlyRoute ? 'approval' : publishRoute;
  const showingApprovalSelection = isOrgWorkspace && activePublishRoute === 'approval';
  const effectiveBrandProjectId = brandProjectId || selectedGeneration?.brand_project_id || null;
  const brandContextHash = String(
    selectedGeneration?.metadata?.brand_kit_hash
    || selectedGeneration?.metadata?.brandKitHash
  || '',
  ).trim();
  const previewCaption = String(postProduction.caption || '').trim();
  const previewHashtags = Array.isArray(postProduction.hashtags)
    ? postProduction.hashtags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : [];
  const previewText = [previewCaption, previewHashtags.join(' ')].filter(Boolean).join('\n\n').trim();
  const previewTitle = String(postProduction.title || '').trim();
  const previewMediaType = String(selectedGeneration?.media_type || 'image').trim().toLowerCase();
  const previewMediaUrl = previewMediaType === 'video'
    ? resolveVideoSource(selectedGeneration?.storage_path)
    : selectedGeneration?.storage_path;
  const previewScheduleLabel = formatScheduleLabel(postProduction.scheduleDate);
  const previewAccounts = postProduction.selectedPlatforms
    .map((accountId) => accounts.find((entry) => entry.id === accountId) || null)
    .filter(Boolean);

  useEffect(() => {
    if (!isOrgWorkspace || step !== 3) return;

    let mounted = true;
    setPipelineConfigsLoading(true);

    fetchPipelineConfigs({
      organizationId,
      brandProjectId: effectiveBrandProjectId || null,
    })
      .then((configs) => {
        if (!mounted) return;
        const safeConfigs = Array.isArray(configs) ? configs : [];
        setPipelineConfigs(safeConfigs);
        setSelectedPipelineConfigId((current) => {
          if (current && safeConfigs.some((config) => config.id === current)) {
            return current;
          }
          return safeConfigs[0]?.id || '';
        });
      })
      .catch((error) => {
        if (!mounted) return;
        console.error('fetchPipelineConfigs:', error);
        setPipelineConfigs([]);
        setSelectedPipelineConfigId('');
      })
      .finally(() => {
        if (mounted) {
          setPipelineConfigsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [effectiveBrandProjectId, isOrgWorkspace, organizationId, step]);
  // Handlers.

  const handleRegenerateMetadata = async (fields, label) => {
    if (!selectedGeneration) return;
    const requestedFields = Array.isArray(fields) ? fields : [fields];
    const busyKey = requestedFields.length === 1 ? requestedFields[0] : 'all';
    setMetadataBusyField(busyKey);
    const toastId = toast.loading(`Regenerating ${label.toLowerCase()}...`);

    try {
      await regeneratePostMetadata(requestedFields);
      toast.success(`${label} ready`, { id: toastId });
    } catch (err) {
      toast.error(err?.message || `${label} regeneration failed`, { id: toastId });
    } finally {
      setMetadataBusyField('');
    }
  };

  const handleScoreSeo = async () => {
    setLoading(true);
    const toastId = toast.loading('Scoring SEO...');
    try {
      const result = await scoreSeo();
      toast.success(`SEO score: ${result?.overall ?? '?'}/100`, { id: toastId });
    } catch (err) {
      toast.error(err?.message || 'SEO scoring failed', { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const handleOptimize = async () => {
    setLoading(true);
    const toastId = toast.loading('Optimizing with AI...');
    try {
      const result = await optimizeSeo();
      toast.success(`Optimized. New score: ${result?.overall ?? '?'}/100`, { id: toastId });
    } catch (err) {
      toast.error(err?.message || 'Optimization failed', { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const togglePlatform = (accountId, isExpired) => {
    if (isExpired) {
      toast.error('Reconnect this account before publishing to it');
      return;
    }
    const current = postProduction.selectedPlatforms;
    updatePostProduction({
      selectedPlatforms: current.includes(accountId)
        ? current.filter(id => id !== accountId)
        : [...current, accountId],
    });
  };

  const addHashtag = () => {
    const tag = newTag.trim().replace(/^#/, '');
    if (!tag) return;
    const normalized = `#${tag}`;
    if (postProduction.hashtags.includes(normalized)) return;
    updatePostProduction({ hashtags: [...postProduction.hashtags, normalized] });
    setNewTag('');
  };

  const removeHashtag = (idx) => {
    updatePostProduction({
      hashtags: postProduction.hashtags.filter((_, i) => i !== idx),
    });
  };

  const handleSubmitForApproval = async () => {
    if (!isOrgWorkspace) return;
    if (approvalSubmitting) return;
    if (!selectedPipelineConfigId) {
      toast.error('Select an approval workflow first.');
      return;
    }

    setApprovalSubmitting(true);
    setLoading(true);
    const toastId = toast.loading('Submitting for approval...');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const preparedPost = await preparePostForApproval();
      const pipelineItem = await submitPostToPipeline({
        organizationId,
        brandProjectId: preparedPost?.brand_project_id || effectiveBrandProjectId || null,
        post: preparedPost,
        userId: user.id,
        pipelineConfigId: selectedPipelineConfigId,
        submissionNote: 'Submitted from post-production workflow.',
      });

      const nowIso = new Date().toISOString();
      const currentWorkflowState = preparedPost?.workflow_state && typeof preparedPost.workflow_state === 'object'
        ? preparedPost.workflow_state
        : {};
      await supabase
        .from('posts')
        .update({
          workflow_state: {
            ...currentWorkflowState,
            approval_status: 'in_review',
            approval_submitted_at: nowIso,
            approval_route: 'approval',
            approval_workflow_id: selectedPipelineConfigId,
            approval_pipeline_item_id: pipelineItem?.id || null,
          },
          updated_at: nowIso,
        })
        .eq('id', preparedPost.id);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('socialai:data-sync', {
          detail: {
            reason: 'pipeline-submitted-from-post-production',
            at: nowIso,
          },
        }));
      }

      toast.success('Sent for approval. Track progress in Pipeline.', { id: toastId });
      setSuccess({
        message: 'Submitted for approval',
        status: 'pending_review',
        mode: 'approval_submitted',
      });
    } catch (err) {
      toast.error(err?.message || 'Could not submit for approval.', { id: toastId });
    } finally {
      setLoading(false);
      setApprovalSubmitting(false);
    }
  };

  const handlePublish = async () => {
    if (showingApprovalSelection) {
      toast.error('Submit this draft for approval from this stage.');
      return;
    }
    if (publishInFlightRef.current) return;
    if (postProduction.selectedPlatforms.length === 0) {
      toast.error('Select at least one platform');
      return;
    }
    if (youtubeSelected && !postProduction.title.trim()) {
      toast.error('Title is required before publishing to YouTube');
      return;
    }
    if (isOverLimit) {
      toast.error(`Caption exceeds the ${charLimit} character limit`);
      return;
    }

    publishInFlightRef.current = true;
    setIsPublishInFlight(true);
    setLoading(true);
    const toastId = toast.loading(
      postProduction.scheduleDate ? 'Scheduling post...' : 'Publishing...'
    );

    try {
      let directRouteWarning = '';
      if (isOrgWorkspace && activePublishRoute === 'direct') {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error('Not authenticated');

          const preparedPost = await preparePostForApproval();
          const resolvedWorkflowId = selectedPipelineConfigId || pipelineConfigs[0]?.id || null;

          if (resolvedWorkflowId && preparedPost?.id) {
            const pipelineItem = await createDirectPublishPipelineItem({
              organizationId,
              brandProjectId: preparedPost?.brand_project_id || effectiveBrandProjectId || null,
              post: preparedPost,
              userId: user.id,
              pipelineConfigId: resolvedWorkflowId,
              submissionNote: 'Direct publish selected from post-production workflow.',
            });

            const nowIso = new Date().toISOString();
            const currentWorkflowState = preparedPost?.workflow_state && typeof preparedPost.workflow_state === 'object'
              ? preparedPost.workflow_state
              : {};
            await supabase
              .from('posts')
              .update({
                workflow_state: {
                  ...currentWorkflowState,
                  approval_status: 'approved',
                  approval_submitted_at: nowIso,
                  approval_route: 'direct',
                  approval_workflow_id: resolvedWorkflowId,
                  approval_pipeline_item_id: pipelineItem?.id || null,
                },
                updated_at: nowIso,
              })
              .eq('id', preparedPost.id);

            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('socialai:data-sync', {
                detail: {
                  reason: 'pipeline-direct-route-from-post-production',
                  at: nowIso,
                },
              }));
            }
          } else if (!resolvedWorkflowId) {
            directRouteWarning = 'Published, but no active workflow is configured to mirror this direct publish in Pipeline.';
          }
        } catch (directRouteError) {
          console.error('Direct publish pipeline mirror failed:', directRouteError);
          directRouteWarning = `Published, but pipeline mirror failed: ${directRouteError?.message || 'Unknown error'}`;
        }
      }

      const result = await publishContent();
      toast.success(result.message, { id: toastId });
      if (directRouteWarning) {
        toast.error(directRouteWarning);
      }
      if (result.status === POST_STATUS.PUBLISHED) {
        onClose();
        return;
      }
      setSuccess({ message: result.message, status: result.status });
    } catch (err) {
      toast.error(err.message || 'Publish failed', { id: toastId });
    } finally {
      setLoading(false);
      publishInFlightRef.current = false;
      setIsPublishInFlight(false);
    }
  };

  const handleSaveDraft = async () => {
    setLoading(true);
    const toastId = toast.loading('Saving draft...');

    try {
      const result = await saveDraft();
      toast.success(result.message, { id: toastId });
      setSuccess({ message: result.message, status: result.status });
    } catch (err) {
      toast.error(err.message || 'Failed to save draft', { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenSettings = () => {
    if (typeof onOpenSettings === 'function') {
      onOpenSettings(settingsPath);
      return;
    }

    navigate(settingsPath);
  };

  const canGoNext = step === 1
    ? (
      postProduction.caption.trim().length > 0
      && !isOverLimit
      && (!youtubeSelected || postProduction.title.trim().length > 0)
    )
    : false;

  if (!selectedGeneration) return null;

  return (
    <>
      {/* Dim backdrop */}
      <div className="panel-overlay" onClick={onClose} aria-hidden="true" />

      <aside
        className="post-production-panel"
        role="complementary"
        aria-label="Post production"
      >
        {/* Header */}
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Post Production</h2>
            {brandContextHash ? (
              <span className="hashtag-pill brand-context-pill" title="Brand Kit styles are applied to this generation">
                Brand Kit active
              </span>
            ) : null}
          </div>
          <button className="btn-close" onClick={onClose} aria-label="Close panel">
            <X size={16} />
          </button>
        </div>

        {/* Success screen (replaces content after publish). */}
        {success ? (
            <div className="panel-success">
            <div className="panel-success-icon">
              <CheckCircle2 size={28} aria-hidden="true" />
            </div>
            <h3>{success.message}</h3>
            <p>
              {success.mode === 'approval_submitted'
                ? 'Your draft entered the approval workflow and is now visible in Pipeline.'
                : success.status === POST_STATUS.PUBLISHED
                ? 'Your post is live on the selected platforms.'
                : success.status === POST_STATUS.SCHEDULED
                  ? 'Your post has been queued and will go out at the scheduled time.'
                  : 'Your draft is saved and ready to schedule from your calendar or library.'}
            </p>
            <button
              className="btn-panel-next panel-done-btn"
              onClick={onClose}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Step indicators */}
            <div className="panel-steps" role="tablist" aria-label="Steps">
              {STEPS.map((s, i) => (
                <React.Fragment key={s.id}>
                  <button
                    className={[
                      'panel-step',
                      step === s.id   ? 'active' : '',
                      step > s.id     ? 'done'   : '',
                    ].filter(Boolean).join(' ')}
                    role="tab"
                    aria-selected={step === s.id}
                    onClick={() => step > s.id && setStep(s.id)}
                    type="button"
                  >
                    <span className="step-num">
                      {step > s.id ? <CheckCircle2 size={12} /> : s.id}
                    </span>
                    <span className="step-label">{s.label}</span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <div className={`step-connector ${step > s.id ? 'done' : ''}`} aria-hidden="true" />
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* Scrollable content */}
            <div className="panel-content">

              {/* Media preview */}
              <div className="media-preview-card">
                {selectedGeneration.media_type === 'video' ? (
                  <video
                    src={resolveVideoSource(selectedGeneration.storage_path)}
                    controls
                    className="preview-media"
                    aria-label="Selected video preview"
                  />
                ) : (
                  <img
                    src={selectedGeneration.storage_path}
                    alt="Selected generation preview"
                    className="preview-media"
                  />
                )}
              </div>

              {/* STEP 1: Content (Caption + Hashtags) */}
              {step === 1 && (
                <div className="step-content">
                  {metadataLoading ? (
                    <div className="metadata-inline-status" role="status" aria-live="polite">
                      <RefreshCw size={13} className="spin" />
                      Generating title, caption, and hashtags...
                    </div>
                  ) : null}

                  {/* Title */}
                  <div>
                    <div className="field-label-row">
                      <span className="field-label">Title (required for YouTube)</span>
                      <button
                        className="btn-sm"
                        onClick={() => handleRegenerateMetadata(['title'], 'Title')}
                        disabled={metadataBusyField === 'title' || metadataBusyField === 'all' || metadataLoading}
                        aria-label="Regenerate title with AI"
                      >
                        <Wand2 size={12} />
                        {metadataBusyField === 'title' || metadataBusyField === 'all' ? 'Regenerating...' : 'Regenerate'}
                      </button>
                    </div>

                    {metadataLoading && !postProduction.title.trim() ? (
                      <div className="metadata-skeleton-line" aria-hidden="true" />
                    ) : (
                      <input
                        type="text"
                        className="caption-input title-input"
                        value={postProduction.title}
                        onChange={(e) => updatePostProduction({ title: e.target.value })}
                        placeholder={youtubeSelected ? 'Enter a publish title for YouTube...' : 'Optional title...'}
                        aria-label="Post title"
                      />
                    )}

                    <p className="metadata-field-hint">
                      {youtubeSelected
                        ? 'YouTube is selected, so title is required before publish.'
                        : 'Optional until YouTube is selected.'}
                    </p>
                  </div>

                  {/* Caption */}
                  <div>
                    <div className="field-label-row">
                      <span className="field-label">Caption</span>
                      <button
                        className="btn-sm"
                        onClick={() => handleRegenerateMetadata(['caption'], 'Caption')}
                        disabled={metadataBusyField === 'caption' || metadataBusyField === 'all' || metadataLoading}
                        aria-label="Regenerate caption with AI"
                      >
                        <Wand2 size={12} />
                        {metadataBusyField === 'caption' || metadataBusyField === 'all' ? 'Regenerating...' : 'Regenerate'}
                      </button>
                    </div>

                    {metadataLoading && !postProduction.caption.trim() ? (
                      <div className="metadata-skeleton-block" aria-hidden="true" />
                    ) : (
                      <textarea
                        className="caption-input"
                        value={postProduction.caption}
                        onChange={(e) => updatePostProduction({ caption: e.target.value })}
                        placeholder="Write your caption, or regenerate with AI..."
                        rows={5}
                        aria-label="Post caption"
                      />
                    )}

                    <p className={`char-count ${isOverLimit ? 'over' : ''}`}>
                      {charCount}
                      {charLimit < 9999 ? ` / ${charLimit}` : ''} characters
                      {isOverLimit && ' - over limit!'}
                    </p>
                  </div>

                  {/* Hashtags */}
                  <div>
                    <div className="field-label-row">
                      <span className="field-label">Hashtags</span>
                      <button
                        className="btn-sm"
                        onClick={() => handleRegenerateMetadata(['hashtags'], 'Hashtags')}
                        disabled={metadataBusyField === 'hashtags' || metadataBusyField === 'all' || metadataLoading}
                        aria-label="Regenerate hashtags with AI"
                      >
                        <Hash size={12} />
                        {metadataBusyField === 'hashtags' || metadataBusyField === 'all' ? 'Regenerating...' : 'Regenerate'}
                      </button>
                    </div>

                    <div className="hashtag-cloud" aria-label="Hashtag list">
                      {metadataLoading && postProduction.hashtags.length === 0 ? (
                        <div className="metadata-skeleton-tags" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                          <span />
                        </div>
                      ) : postProduction.hashtags.length === 0 ? (
                        <span className="hashtag-empty">No hashtags yet - generate or type below</span>
                      ) : (
                        postProduction.hashtags.map((tag, i) => (
                          <span key={i} className="hashtag-pill">
                            {tag}
                            <button
                              className="remove-tag"
                              onClick={() => removeHashtag(i)}
                              aria-label={`Remove ${tag}`}
                            >
                              <X size={11} />
                            </button>
                          </span>
                        ))
                      )}
                    </div>

                    {/* Manual hashtag input */}
                    <div className="manual-hashtag-row">
                      <input
                        type="text"
                        className="caption-input manual-hashtag-input"
                        placeholder="#addhashtag"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            addHashtag();
                          }
                        }}
                        aria-label="Add hashtag"
                      />
                      <button
                        className="btn-sm manual-hashtag-add"
                        onClick={addHashtag}
                        disabled={!newTag.trim()}
                      >
                        Add
                      </button>
                    </div>
                  </div>

                </div>
              )}

              {/* STEP 2: SEO */}
              {step === 2 && (
                <div className="step-content">
                  <div className="ppp-seo-score-card">
                    <div className="ppp-seo-head">
                      <span className="ppp-seo-title">
                        <TrendingUp size={15} />
                        SEO Score
                      </span>
                      <strong>{postProduction.seoScore || 0} / 100</strong>
                    </div>

                    <div className="ppp-seo-bars">
                      {[
                        { key: 'title', label: 'Title' },
                        { key: 'caption', label: 'Caption' },
                        { key: 'hashtags', label: 'Hashtags' },
                      ].map((entry) => {
                        const value = Number(postProduction.seoBreakdown?.[entry.key] || 0);
                        return (
                          <div key={entry.key} className="ppp-seo-bar-row">
                            <span>{entry.label}</span>
                            <div className="ppp-seo-bar-track">
                              <div className="ppp-seo-bar-fill" style={{ '--ppp-seo-width': `${Math.max(0, Math.min(100, value))}%` }} />
                            </div>
                            <span>{value}</span>
                          </div>
                        );
                      })}
                    </div>

                    {postProduction.seoSuggestions?.length > 0 ? (
                      <ul className="ppp-seo-suggestions">
                        {postProduction.seoSuggestions.map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="hashtag-empty">Run SEO scoring to get optimization suggestions.</p>
                    )}

                    <div className="ppp-seo-actions">
                      <button
                        className="btn-sm"
                        onClick={handleScoreSeo}
                        disabled={seoBusy || loading || !postProduction.caption.trim()}
                      >
                        {postProduction.seoStatus === 'scoring' ? 'Scoring...' : 'Run SEO Score'}
                      </button>
                      <button
                        className="btn-sm"
                        onClick={handleOptimize}
                        disabled={seoBusy || loading || !postProduction.caption.trim()}
                      >
                        {postProduction.seoStatus === 'optimizing' ? 'Optimizing...' : 'Optimize with AI'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: Publish (Platforms + Schedule) */}
              {step === 3 && (
                <div className="step-content">
                  {isOrgWorkspace ? (
                    <div className="ppp-approval-card">
                      <div className="ppp-approval-head">
                        <span className="ppp-approval-title">
                          <ShieldCheck size={15} />
                          Approval Route
                        </span>
                        {approvalOnlyRoute ? (
                          <span className="ppp-approval-lock">Approval required by role</span>
                        ) : (
                          <span className="ppp-approval-lock">Choose approval or direct publish</span>
                        )}
                      </div>

                      {!approvalOnlyRoute ? (
                        <div className="ppp-route-toggle">
                          <button
                            type="button"
                            className={`ppp-route-btn ${activePublishRoute === 'approval' ? 'active' : ''}`}
                            onClick={() => setPublishRoute('approval')}
                          >
                            Send for Approval
                          </button>
                          <button
                            type="button"
                            className={`ppp-route-btn ${activePublishRoute === 'direct' ? 'active' : ''}`}
                            onClick={() => setPublishRoute('direct')}
                          >
                            Publish Directly
                          </button>
                        </div>
                      ) : null}

                      {showingApprovalSelection ? (
                        <>
                          {pipelineConfigsLoading ? (
                            <p className="ppp-approval-hint">Loading approval workflows...</p>
                          ) : pipelineConfigs.length === 0 ? (
                            <p className="ppp-approval-hint">
                              No active approval workflow found. Ask an org admin to create one in Pipeline settings.
                            </p>
                          ) : (
                            <div className="ppp-workflow-list">
                              {pipelineConfigs.map((config) => {
                                const selected = selectedPipelineConfigId === config.id;
                                const stages = Array.isArray(config?.stages) ? config.stages : [];
                                return (
                                  <button
                                    key={config.id}
                                    type="button"
                                    className={`ppp-workflow-card ${selected ? 'active' : ''}`}
                                    onClick={() => setSelectedPipelineConfigId(config.id)}
                                  >
                                    <div className="ppp-workflow-head">
                                      <strong>{config.name || 'Workflow'}</strong>
                                      <span>{getStageCount(config)} stages</span>
                                    </div>
                                    <p>{config.description || 'No workflow description provided.'}</p>
                                    <div className="ppp-workflow-stages">
                                      {stages.slice(0, 3).map((stage) => (
                                        <span key={stage.id || `${config.id}-${stage.order}`}>
                                          <GitBranch size={12} />
                                          {stage.name || 'Stage'} / {formatRoleLabel(stage.assignee_role)}
                                        </span>
                                      ))}
                                      {stages.length > 3 ? (
                                        <span>+{stages.length - 3} more stages</span>
                                      ) : null}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="ppp-approval-hint">
                          Direct publish is enabled for your role. Continue to platform selection below.
                        </p>
                      )}
                    </div>
                  ) : null}

                  {!isOrgWorkspace || activePublishRoute === 'direct' ? (
                    <>
                      {/* Platform selection */}
                      <div>
                        <div className="field-label-row field-label-row-spaced">
                          <span className="field-label">Select Platforms</span>
                        </div>

                        {accountsLoading ? (
                          <div className="platform-loading-state">
                            Loading accounts...
                          </div>
                        ) : accounts.length === 0 ? (
                          <div className="no-accounts-state">
                            <Wifi size={24} aria-hidden="true" />
                            <p>No connected accounts</p>
                            <button
                              className="btn-sm"
                              onClick={handleOpenSettings}
                            >
                              Connect an account
                            </button>
                          </div>
                        ) : (
                          <div className="platform-list" role="list" aria-label="Platform accounts">
                            {accounts.map((acc) => {
                              const isExpired  = acc.connection_status === 'expired';
                              const isSelected = postProduction.selectedPlatforms.includes(acc.id);
                              return (
                                <button
                                  key={acc.id}
                                  className={[
                                    'platform-card',
                                    isSelected ? 'selected'  : '',
                                    isExpired  ? 'disabled'  : '',
                                  ].filter(Boolean).join(' ')}
                                  role="listitem"
                                  onClick={() => togglePlatform(acc.id, isExpired)}
                                  aria-pressed={isSelected}
                                  aria-label={`${acc.platform} - ${acc.account_name}${isExpired ? ' (expired)' : ''}`}
                                >
                                  <div className="platform-icon-wrap">
                                    <PlatformIcon platform={acc.platform} size={18} />
                                  </div>

                                  <div className="platform-info">
                                    <span className="platform-name">{acc.account_name}</span>
                                    <span className={`platform-status-tag ${isExpired ? 'expired' : 'active'}`}>
                                      {isExpired ? (
                                        <><AlertTriangle size={10} /> Expired</>
                                      ) : (
                                        <><Wifi size={10} /> Active</>
                                      )}
                                    </span>
                                  </div>

                                  {isExpired ? (
                                    <span
                                      className="platform-reconnect-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigate('/app/settings');
                                      }}
                                      aria-label={`Reconnect ${acc.platform}`}
                                    >
                                      <RefreshCw size={11} className="platform-reconnect-icon" />
                                      Reconnect
                                    </span>
                                  ) : isSelected ? (
                                    <CheckCircle2 size={17} className="platform-check" aria-hidden="true" />
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Schedule */}
                      <div>
                        <div className="field-label-row field-label-row-spaced">
                          <span className="field-label">When to Publish</span>
                        </div>

                        <div className="schedule-toggle">
                          <button
                            className={`schedule-btn ${!postProduction.scheduleDate ? 'active' : ''}`}
                            onClick={() => updatePostProduction({ scheduleDate: null })}
                            aria-pressed={!postProduction.scheduleDate}
                          >
                            <Send size={14} aria-hidden="true" />
                            Post Now
                          </button>
                          <button
                            className={`schedule-btn ${postProduction.scheduleDate ? 'active' : ''}`}
                            onClick={() => {
                              // Set a default schedule time of tomorrow at current time
                              const tomorrow = new Date(Date.now() + 86400000);
                              updatePostProduction({ scheduleDate: tomorrow.toISOString() });
                            }}
                            aria-pressed={!!postProduction.scheduleDate}
                          >
                            <Calendar size={14} aria-hidden="true" />
                            Schedule
                          </button>
                        </div>

                        {postProduction.scheduleDate && (() => {
                          const scheduledDate = new Date(postProduction.scheduleDate);
                          const dow = scheduledDate.getDay(); // 0=Sun
                          const monday = new Date(scheduledDate);
                          monday.setDate(scheduledDate.getDate() - ((dow + 6) % 7));
                          const today = new Date();
                          const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
                          return (
                            <>
                              <input
                                type="datetime-local"
                                className="schedule-datetime schedule-datetime-spaced"
                                value={scheduledDate.toISOString().slice(0, 16)}
                                min={new Date().toISOString().slice(0, 16)}
                                onChange={(e) => updatePostProduction({
                                  scheduleDate: new Date(e.target.value).toISOString(),
                                })}
                                aria-label="Schedule date and time"
                              />
                              <div className="mini-cal-strip" aria-label="Week view of scheduled date">
                                {days.map((label, index) => {
                                  const d = new Date(monday);
                                  d.setDate(monday.getDate() + index);
                                  const isScheduled = d.toDateString() === scheduledDate.toDateString();
                                  const isToday = d.toDateString() === today.toDateString();
                                  return (
                                    <div
                                      key={label}
                                      className={[
                                        'mini-cal-day',
                                        isScheduled ? 'scheduled' : '',
                                        isToday && !isScheduled ? 'today' : '',
                                      ].filter(Boolean).join(' ')}
                                    >
                                      <span className="mini-cal-day-name">{label}</span>
                                      <span className="mini-cal-day-num">{d.getDate()}</span>
                                      {isScheduled && <span className="mini-cal-dot" aria-hidden="true" />}
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      {/* Social previews */}
                      <div>
                        <div className="field-label-row field-label-row-spaced">
                          <span className="field-label">Platform Preview</span>
                        </div>

                        {postProduction.selectedPlatforms.length === 0 || previewAccounts.length === 0 ? (
                          <p className="ppp-preview-empty">
                            Select at least one platform to preview how your post will appear.
                          </p>
                        ) : (
                          <div className="ppp-preview-grid" role="list" aria-label="Platform post previews">
                            {previewAccounts.map((account) => {
                              const platformKey = normalizePlatform(account?.platform);
                              const platformName = getPlatformDisplayName(platformKey);
                              const accountName = account?.account_name || account?.display_name || account?.username || 'Connected account';
                              const accountHandle = account?.username
                                ? `@${String(account.username).replace(/^@+/, '')}`
                                : '@socialai';

                              return (
                                <article
                                  key={account.id}
                                  role="listitem"
                                  className={`ppp-preview-card platform-${platformKey}`.trim()}
                                >
                                  <header className="ppp-preview-head">
                                    <div className="ppp-preview-identity">
                                      <span className="ppp-preview-avatar">
                                        <PlatformIcon platform={platformKey} size={15} />
                                      </span>
                                      <div>
                                        <strong>{accountName}</strong>
                                        <span>{accountHandle}</span>
                                      </div>
                                    </div>
                                    <span className="ppp-preview-platform-tag">{platformName}</span>
                                  </header>

                                  <div className={`ppp-preview-media media-${previewMediaType}`.trim()}>
                                    {previewMediaUrl ? (
                                      previewMediaType === 'video' ? (
                                        <video src={previewMediaUrl} muted loop playsInline />
                                      ) : (
                                        <img src={previewMediaUrl} alt={`${platformName} content preview`} />
                                      )
                                    ) : (
                                      <div className="ppp-preview-media-fallback">Media preview unavailable</div>
                                    )}
                                  </div>

                                  <div className="ppp-preview-body">
                                    {platformKey === 'youtube' ? (
                                      <h4>{previewTitle || 'Add a title for YouTube publish preview'}</h4>
                                    ) : null}
                                    <p>{previewText || 'Add caption and hashtags to preview final post copy.'}</p>
                                    <div className="ppp-preview-meta">
                                      <span>{postProduction.scheduleDate ? `Scheduled: ${previewScheduleLabel}` : 'Publishing immediately'}</span>
                                    </div>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </div>

            {/* Footer nav buttons */}
            <div className="panel-footer">
              {step > 1 && (
                <button
                  className="btn-panel-back"
                  onClick={() => setStep(s => s - 1)}
                  aria-label="Go back to previous step"
                >
                  Back
                </button>
              )}

              {step === 1 && (
                <button
                  className="btn-panel-next"
                  onClick={() => setStep(2)}
                  disabled={!canGoNext}
                  aria-label="Continue to SEO step"
                >
                  Next: SEO
                </button>
              )}

              {step === 2 && (
                <>
                  <button
                    className="btn-panel-back"
                    onClick={() => setStep(3)}
                    aria-label="Skip SEO and go to publish"
                    type="button"
                  >
                    Skip SEO
                  </button>
                  <button
                    className="btn-panel-next"
                    onClick={() => setStep(3)}
                    disabled={!seoScoreReady || seoBusy}
                    aria-label="Proceed to publish step"
                    type="button"
                  >
                    Proceed to Publish
                  </button>
                </>
              )}

              {step === 3 && (
                <>
                  <button
                    className="btn-panel-secondary"
                    onClick={handleSaveDraft}
                    disabled={loading}
                    aria-label="Save as draft"
                    type="button"
                  >
                    Save as Draft
                  </button>
                  {showingApprovalSelection ? (
                    <button
                      className="btn-panel-publish"
                      onClick={handleSubmitForApproval}
                      disabled={
                        loading
                        || approvalSubmitting
                        || pipelineConfigsLoading
                        || !selectedPipelineConfigId
                      }
                      aria-label="Submit for approval"
                      type="button"
                    >
                      {approvalSubmitting ? (
                        'Submitting...'
                      ) : (
                        <>
                          <ShieldCheck size={15} />
                          Submit for Approval
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      className="btn-panel-publish"
                      onClick={handlePublish}
                      disabled={
                        loading ||
                        isPublishInFlight ||
                        postProduction.selectedPlatforms.length === 0 ||
                        isOverLimit
                      }
                      aria-label={
                        postProduction.scheduleDate ? 'Schedule post' : 'Publish now'
                      }
                      type="button"
                    >
                      {loading ? (
                        'Publishing...'
                      ) : postProduction.scheduleDate ? (
                        <><Calendar size={15} /> Schedule Post</>
                      ) : (
                        <><Send size={15} /> Publish Now</>
                      )}
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
