"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, PenSquare, Send, Sparkles, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../Context/AuthContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import { useMutableSearchParams } from '../../next/useMutableSearchParams';
import OrgEmptyState from '../components/OrgEmptyState';
import OrgGenerateComposer from '../components/OrgGenerateComposer';
import OrgDraftWorkflowModal from '../components/OrgDraftWorkflowModal';
import { UiModal } from '../../components/Shared/ui';
import useOrgContext from '../hooks/useOrgContext';
import usePipelineItems from '../hooks/usePipelineItems';
import {
  deleteOrgDraft,
  fetchOrgDrafts,
  fetchOrganizationMembers,
} from '../services/orgService';
import { submitPostToPipeline } from '../services/pipelineService';
import { buildDeepLink } from '../../utils/buildDeepLink';
const ALL_BRANDS_KEY = '__all_brands__';

const PIPELINE_STATUS_LABELS = {
  pending: 'Pending',
  in_review: 'In Review',
  revision_requested: 'Revision Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  scheduled: 'Scheduled',
  published: 'Published',
};

const PIPELINE_STATUS_TONES = {
  pending: 'neutral',
  in_review: 'review',
  revision_requested: 'warning',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
  scheduled: 'warning',
  published: 'success',
};

function formatDateTime(value) {
  if (!value) return 'Unknown time';

  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) return 'Unknown time';

  return nextDate.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getDraftTitle(draft) {
  const source = String(
    draft?.title
      || draft?.caption
      || draft?.generations?.prompt
      || 'Untitled draft',
  ).trim();

  if (source.length <= 110) return source;
  return `${source.slice(0, 107).trim()}...`;
}

function getPlatformLabel(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Platform TBD';
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getStatusLabel(value) {
  return PIPELINE_STATUS_LABELS[value] || 'Unknown';
}

function getStatusTone(value) {
  return PIPELINE_STATUS_TONES[value] || 'neutral';
}

function getRoleLabel(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Awaiting assignment';

  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getMemberLabel(member) {
  return member?.profile?.full_name
    || member?.profile?.email
    || member?.userId
    || 'Assigned reviewer';
}

function collectDraftValidationWarnings(draft) {
  const warnings = [];
  const caption = String(draft?.caption || '').trim();
  const prompt = String(draft?.generations?.prompt || '').trim();
  const hasMedia = Boolean(draft?.generations?.storage_path);

  if (!caption && !prompt) {
    warnings.push({
      code: 'missing_caption',
      label: 'Caption is empty',
      detail: 'Submit is allowed, but reviewers will receive a draft with no final copy.',
    });
  }

  if (!draft?.platform) {
    warnings.push({
      code: 'platform_tbd',
      label: 'Platform not set',
      detail: 'Pipeline reviewers will need to choose a platform before scheduling.',
    });
  }

  if (!hasMedia) {
    warnings.push({
      code: 'missing_media',
      label: 'Media preview missing',
      detail: 'This draft has no generated media URL attached yet.',
    });
  }

  return warnings;
}

function buildValidationSubmissionNote(warnings = []) {
  if (!Array.isArray(warnings) || warnings.length === 0) return '';
  const codes = warnings.map((warning) => warning.code).filter(Boolean);
  if (!codes.length) return '';
  return `[Validation acknowledged] ${codes.join(', ')}`;
}

export default function MyOffice() {
  const { navigate } = useAppNavigation();
  const [searchParams, setSearchParams] = useMutableSearchParams();
  const { user } = useAuth();
  const {
    organizationId,
    activeBrandProject,
    brandProjects,
    isAgency,
    organization,
  } = useOrgContext();
  const [drafts, setDrafts] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerIntent, setComposerIntent] = useState(null);
  const [workflowDraftId, setWorkflowDraftId] = useState('');
  const [selectedDraftId, setSelectedDraftId] = useState('');
  const [submitValidation, setSubmitValidation] = useState(null);
  const [brandFilter, setBrandFilter] = useState(null);
  const handledQueryDraftRef = useRef('');

  useEffect(() => {
    setBrandFilter(null);
    handledQueryDraftRef.current = '';
  }, [organizationId]);

  useEffect(() => {
    setBrandFilter((current) => {
      if (current === null) return activeBrandProject?.id || ALL_BRANDS_KEY;
      if (current === ALL_BRANDS_KEY) return current;
      return activeBrandProject?.id || ALL_BRANDS_KEY;
    });
  }, [activeBrandProject?.id]);

  const pipelineBrandProjectId = brandFilter === ALL_BRANDS_KEY
    ? null
    : brandFilter || undefined;

  const { items: pipelineItems, refresh } = usePipelineItems({
    brandProjectIdOverride: pipelineBrandProjectId,
  });

  const loadDrafts = useCallback(async (cancelled = false) => {
    if (!organizationId || !user?.id) {
      if (!cancelled) {
        setDrafts([]);
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    const nextDrafts = await fetchOrgDrafts({
      organizationId,
      userId: user.id,
      brandProjectId: pipelineBrandProjectId || null,
    });

    if (!cancelled) {
      setDrafts(nextDrafts);
      setLoading(false);
    }
  }, [organizationId, pipelineBrandProjectId, user?.id]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      await loadDrafts(cancelled);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [loadDrafts, refresh]);

  useEffect(() => {
    let cancelled = false;

    async function loadMembers() {
      if (!organizationId) {
        setMembers([]);
        return;
      }

      const nextMembers = await fetchOrganizationMembers(organizationId);
      if (!cancelled) {
        setMembers(nextMembers);
      }
    }

    loadMembers();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  useEffect(() => {
    const handleSync = () => {
      void loadDrafts(false);
    };

    window.addEventListener('socialai:data-sync', handleSync);
    return () => {
      window.removeEventListener('socialai:data-sync', handleSync);
    };
  }, [loadDrafts]);

  useEffect(() => {
    setSelectedDraftId((current) => {
      if (drafts.some((draft) => draft.id === current)) {
        return current;
      }
      return drafts[0]?.id || '';
    });
  }, [drafts]);

  const brandProjectMap = useMemo(
    () => new Map((brandProjects || []).map((project) => [project.id, project])),
    [brandProjects],
  );

  const memberMap = useMemo(
    () => new Map((members || []).map((member) => [member.userId, member])),
    [members],
  );

  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.id === selectedDraftId) || null,
    [drafts, selectedDraftId],
  );

  const clearDraftQueryParams = useCallback(() => {
    if (!searchParams.get('draftId') && !searchParams.get('pipelineItemId') && !searchParams.get('source')) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('draftId');
    nextParams.delete('pipelineItemId');
    nextParams.delete('source');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const draftIdFromQuery = String(searchParams.get('draftId') || '').trim();
    if (!draftIdFromQuery || loading || drafts.length === 0) return;
    if (handledQueryDraftRef.current === draftIdFromQuery) return;

    const match = drafts.find((draft) => draft.id === draftIdFromQuery);
    if (!match) return;

    handledQueryDraftRef.current = draftIdFromQuery;
    setSelectedDraftId(draftIdFromQuery);
    setWorkflowDraftId(draftIdFromQuery);
  }, [drafts, loading, searchParams]);

  const myPipelineItems = useMemo(() => (
    pipelineItems
      .filter((item) => item.submitted_by === user?.id)
      .sort((left, right) => new Date(right.updated_at || 0).getTime() - new Date(left.updated_at || 0).getTime())
      .slice(0, 8)
  ), [pipelineItems, user?.id]);

  const brandFilterLabel = brandFilter === ALL_BRANDS_KEY
    ? 'All brands'
    : brandProjectMap.get(brandFilter)?.name || activeBrandProject?.name || 'Selected brand';

  const openComposer = (nextIntent) => {
    setComposerIntent({
      ...nextIntent,
      nonce: Date.now(),
    });
    setComposerOpen(true);
  };

  const handleSubmitDraft = async (draft, options = {}) => {
    if (!organizationId || !user?.id || !draft?.id) return;

    const resolvedBrandProjectId = draft.brand_project_id
      || draft.generations?.brand_project_id
      || activeBrandProject?.id
      || null;

    if (!resolvedBrandProjectId) {
      toast.error('This draft is missing a brand project. Select or create a brand project, then submit again.');
      return;
    }

    setSubmittingId(draft.id);
    try {
      const validationWarnings = Array.isArray(options.validationWarnings)
        ? options.validationWarnings
        : [];

      await submitPostToPipeline({
        organizationId,
        brandProjectId: resolvedBrandProjectId,
        post: draft,
        userId: user.id,
        submissionNote: buildValidationSubmissionNote(validationWarnings),
      });
      toast.success('Draft submitted to the pipeline');
      setDrafts((current) => current.filter((item) => item.id !== draft.id));
      await refresh();
    } catch (error) {
      toast.error(error?.message || 'Unable to submit draft');
    } finally {
      setSubmittingId('');
    }
  };

  const handleRequestDraftSubmit = (draft) => {
    if (!draft?.id) return;

    const warnings = collectDraftValidationWarnings(draft);
    if (warnings.length === 0) {
      void handleSubmitDraft(draft);
      return;
    }

    setSubmitValidation({
      draft,
      warnings,
    });
  };

  const handleDeleteDraft = async (draft) => {
    if (!draft?.id) return;
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;

    setDeletingId(draft.id);
    try {
      await deleteOrgDraft(draft.id);
      setDrafts((current) => current.filter((item) => item.id !== draft.id));
      toast.success('Draft deleted');
    } catch (error) {
      toast.error(error?.message || 'Unable to delete draft');
    } finally {
      setDeletingId('');
    }
  };

  const resolvePipelineOwner = (item) => {
    if (item?.current_assignee_user_id) {
      return getMemberLabel(memberMap.get(item.current_assignee_user_id) || null);
    }

    if (item?.current_assignee_role) {
      return getRoleLabel(item.current_assignee_role);
    }

    return getStatusLabel(item?.status);
  };

  return (
    <section className="org-page my-office-page">
      <div className="my-office-hero">
        <div className="my-office-hero-copy">
          <span className="my-office-kicker">My Office</span>
          <h1>What are we making today?</h1>
          <p>
            {(organization?.name || 'Organization')}
            {activeBrandProject?.name ? ` / ${activeBrandProject.name}` : ''}
          </p>
          <span className="my-office-hero-note">
            {selectedDraft
              ? `Selected draft: ${getDraftTitle(selectedDraft)}`
              : 'Start a new draft, pick up where you left off, or submit something ready for review.'}
          </span>
        </div>

        <div className="my-office-hero-actions">
          <button
            type="button"
            className="my-office-primary-button"
            onClick={() => openComposer({ mode: 'new' })}
          >
            <Sparkles size={15} />
            Generate Content
          </button>
          <button
            type="button"
            className="my-office-secondary-button"
            onClick={() => handleRequestDraftSubmit(selectedDraft)}
            disabled={!selectedDraft || submittingId === selectedDraft?.id}
          >
            <Send size={15} />
            {submittingId === selectedDraft?.id ? 'Submitting...' : 'Submit Draft'}
          </button>
        </div>
      </div>

      <div className="my-office-layout">
        <section className="my-office-panel">
          <div className="my-office-panel-header">
            <div>
              <h2>Your Drafts</h2>
              <p>Generated content lands here before it enters the approval pipeline.</p>
            </div>

            <div className="my-office-panel-controls">
              {brandProjects.length > 0 ? (
                <label className="my-office-brand-filter">
                  <span>Brand</span>
                  <select
                    value={brandFilter || ALL_BRANDS_KEY}
                    onChange={(event) => setBrandFilter(event.target.value || ALL_BRANDS_KEY)}
                  >
                    <option value={ALL_BRANDS_KEY}>All brands</option>
                    {brandProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <span className="my-office-count-chip">{drafts.length} drafts</span>
            </div>
          </div>

          {loading ? (
            <div className="org-panel-loading">Loading drafts...</div>
          ) : drafts.length === 0 ? (
            <OrgEmptyState
              eyebrow="My Office"
              title="No drafts yet"
              description="Start generating to create draft content for this workspace."
              action={(
                <button
                  type="button"
                  className="my-office-primary-button"
                  onClick={() => openComposer({ mode: 'new' })}
                >
                  Start Draft
                </button>
              )}
            />
          ) : (
            <div className="my-office-draft-list">
              {drafts.map((draft) => {
                const isSelected = draft.id === selectedDraftId;
                const draftBrand = draft.brand_project_id
                  ? brandProjectMap.get(draft.brand_project_id)?.name || 'Brand project'
                  : 'Org wide';

                return (
                  <article
                    key={draft.id}
                    className={`my-office-draft-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedDraftId(draft.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedDraftId(draft.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="my-office-draft-top">
                      <span className="my-office-draft-platform">
                        {getPlatformLabel(draft.platform)}
                      </span>
                      <div className="my-office-draft-badges">
                        {isAgency || draft.brand_project_id ? (
                          <span className="my-office-draft-badge">{draftBrand}</span>
                        ) : null}
                        <span className="my-office-draft-badge subtle">Draft</span>
                      </div>
                    </div>

                    <div className="my-office-draft-content">
                      <strong>{getDraftTitle(draft)}</strong>
                      <p>{draft.generations?.prompt || 'No prompt summary available yet.'}</p>
                    </div>

                    <div className="my-office-draft-footer">
                      <span>{formatDateTime(draft.updated_at || draft.created_at)}</span>

                      <div className="my-office-draft-actions">
                        <button
                          type="button"
                          className="my-office-action-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setWorkflowDraftId(draft.id);
                          }}
                        >
                          <PenSquare size={13} />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="my-office-action-button primary"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRequestDraftSubmit(draft);
                          }}
                          disabled={submittingId === draft.id}
                        >
                          <Send size={13} />
                          {submittingId === draft.id ? 'Submitting...' : 'Submit'}
                        </button>
                        <button
                          type="button"
                          className="my-office-action-button danger"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteDraft(draft);
                          }}
                          disabled={deletingId === draft.id}
                          aria-label={`Delete ${getDraftTitle(draft)}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="my-office-panel">
          <div className="my-office-panel-header">
            <div>
              <h2>In the Pipeline</h2>
              <p>Recent work moving through approvals for {brandFilterLabel}.</p>
            </div>

            <button
              type="button"
              className="my-office-inline-button"
              onClick={() => {
                const target = buildDeepLink({
                  path: `/app/org/${organizationId}/pipeline`,
                  source: 'my_office',
                  target: 'org_pipeline',
                });
                navigate(target.path, { state: target.state });
              }}
            >
              View All
            </button>
          </div>

          {myPipelineItems.length === 0 ? (
            <OrgEmptyState
              eyebrow="Pipeline"
              title="Nothing submitted yet"
              description="Submitted drafts will appear here with their current review stage."
            />
          ) : (
            <div className="my-office-pipeline-list">
              {myPipelineItems.map((item) => {
                const tone = getStatusTone(item.status);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="my-office-pipeline-item"
                    onClick={() => {
                      const target = buildDeepLink({
                        path: `/app/org/${organizationId}/pipeline`,
                        source: 'my_office',
                        target: 'org_pipeline_item',
                        params: { pipelineItemId: item.id },
                      });
                      navigate(target.path, { state: target.state });
                    }}
                  >
                    <span className={`my-office-pipeline-marker ${tone}`} />

                    <div className="my-office-pipeline-copy">
                      <strong>{item.title || 'Untitled item'}</strong>
                      <span>
                        {item.currentStageName || 'Awaiting review'}
                        {' / '}
                        {resolvePipelineOwner(item)}
                      </span>
                    </div>

                    <div className="my-office-pipeline-meta">
                      <span className={`my-office-status-pill ${tone}`}>
                        {getStatusLabel(item.status)}
                      </span>
                      <ChevronRight size={15} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <OrgGenerateComposer
        open={composerOpen}
        intent={composerIntent}
        onClose={() => {
          setComposerOpen(false);
          setComposerIntent(null);
        }}
      />

      <OrgDraftWorkflowModal
        open={Boolean(workflowDraftId)}
        postId={workflowDraftId || null}
        onClose={() => {
          setWorkflowDraftId('');
          clearDraftQueryParams();
        }}
        onUpdated={() => {
          void loadDrafts(false);
          void refresh();
        }}
        onOpenGenerator={(draft) => {
          setWorkflowDraftId('');
          openComposer({
            mode: 'revision',
            editPostId: draft?.id || workflowDraftId,
            contextNote: 'Reopened from My Office draft editor.',
          });
        }}
      />

      {submitValidation ? (
        <UiModal
          open={Boolean(submitValidation)}
          onClose={() => setSubmitValidation(null)}
          title="Draft validation warning"
          description="You can submit anyway, but the pipeline item will include warning metadata."
          className="my-office-validation-modal"
          footer={(
            <>
              <button
                type="button"
                className="my-office-secondary-button"
                onClick={() => setSubmitValidation(null)}
              >
                Review draft
              </button>
              <button
                type="button"
                className="my-office-primary-button"
                onClick={() => {
                  const pending = submitValidation;
                  setSubmitValidation(null);
                  if (pending?.draft) {
                    void handleSubmitDraft(pending.draft, { validationWarnings: pending.warnings });
                  }
                }}
              >
                Submit anyway
              </button>
            </>
          )}
        >
            <div className="my-office-validation-list">
              {submitValidation.warnings.map((warning) => (
                <article key={warning.code} className="my-office-validation-item">
                  <strong>{warning.label}</strong>
                  <p>{warning.detail}</p>
                  <small>Code: {warning.code}</small>
                </article>
              ))}
            </div>
        </UiModal>
      ) : null}
    </section>
  );
}
