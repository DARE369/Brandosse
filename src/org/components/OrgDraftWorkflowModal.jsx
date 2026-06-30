import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarClock, GitBranch, Loader2, RefreshCcw, Save, ShieldCheck, Sparkles, TrendingUp, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../Context/AuthContext';
import { supabase } from '../../services/supabaseClient';
import useOrgContext from '../hooks/useOrgContext';
import { fetchOrganizationMembers } from '../services/orgService';
import {
  createDirectPublishPipelineItem,
  fetchPipelineConfigs,
  submitPostToPipeline,
} from '../services/pipelineService';
import {
  applyOrgSeoSuggestions,
  cloneOrgDraftForAccount,
  fetchOrgDraftWorkflow,
  requestOrgDraftMetadata,
  runOrgDraftSeo,
  scoreOrgDraftSeo,
  updateOrgDraftWorkflow,
} from '../services/orgDraftWorkflowService';
import { fetchOrgScheduleContext } from '../services/orgScheduleService';
import { publishOrgCalendarRecord, scheduleOrgCalendarRecord } from '../services/orgCalendarService';
function normalizeHashtags(value) {
  const fromArray = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);

  return fromArray
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
}

function hashtagsToInput(value) {
  return normalizeHashtags(value).join(' ');
}

function snapshotState({ title = '', caption = '', hashtags = [], prompt = '' } = {}) {
  return JSON.stringify({
    title: String(title || '').trim(),
    caption: String(caption || '').trim(),
    hashtags: normalizeHashtags(hashtags).join(' '),
    prompt: String(prompt || '').trim(),
  });
}

function formatDateTime(value) {
  if (!value) return 'Not scheduled';
  const next = new Date(value);
  if (Number.isNaN(next.getTime())) return 'Not scheduled';

  return next.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getPlatformLabel(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Platform not selected';

  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatRoleLabel(value) {
  return String(value || 'role')
    .trim()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getActorLabel(actorId, membersById = new Map()) {
  const member = membersById.get(actorId) || null;
  if (!member) return 'Reviewer';
  return member.profile?.full_name || member.profile?.email || member.userId || 'Reviewer';
}

function getLatestHistoryComment(item, events = []) {
  const history = Array.isArray(item?.history) ? [...item.history] : [];
  const eventSet = new Set(events.map((eventName) => String(eventName || '').trim().toLowerCase()));
  const match = history
    .reverse()
    .find((entry) => eventSet.has(String(entry?.event || '').trim().toLowerCase()));
  return String(match?.comment || '').trim();
}

function getApprovedHistory(item) {
  const history = Array.isArray(item?.history) ? item.history : [];
  return history.filter((entry) => {
    const eventName = String(entry?.event || '').trim().toLowerCase();
    return eventName === 'approve' || eventName === 'advanced' || eventName === 'auto_approved';
  });
}

function getSeoBreakdown(seoState = {}) {
  const breakdown = seoState?.score_breakdown && typeof seoState.score_breakdown === 'object'
    ? seoState.score_breakdown
    : {};

  const pickScore = (value) => {
    const next = Number(
      typeof value === 'object' && value !== null
        ? value.score
        : value,
    );
    if (Number.isNaN(next)) return 0;
    return Math.max(0, Math.min(100, Math.round(next)));
  };

  return {
    title: pickScore(breakdown.title),
    caption: pickScore(breakdown.caption),
    hashtags: pickScore(breakdown.hashtags),
  };
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function toDateTimeInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().slice(0, 16);
}

function parseDateTimeInputValue(value) {
  const nextValue = String(value || '').trim();
  if (!nextValue) return null;
  const date = new Date(nextValue);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function getDefaultScheduleInputValue() {
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + 1);
  nextDate.setHours(10, 0, 0, 0);
  return toDateTimeInputValue(nextDate);
}

function isUnavailableDestination(destination) {
  return destination?.scope === 'organization' && destination?.can_post === false;
}

function getDestinationLabel(destination) {
  return destination?.account_name || destination?.username || destination?.platform || 'Destination';
}

function getDestinationSupportText(destination) {
  if (!destination) return 'Connected account';
  if (destination.scope === 'organization') {
    if (destination.can_post === false) {
      return 'No Access - Contact your admin to request posting access.';
    }
    if (destination.access_mode === 'specific_members') {
      return 'Shared org account - Specific members only.';
    }
    return 'Shared org account - Available to publish-enabled members.';
  }
  return 'Personal destination for the content owner.';
}

function getResultSummary(prefix, successfulTargets = [], failedTargets = []) {
  const successCount = successfulTargets.length;
  const failureCount = failedTargets.length;
  if (failureCount === 0) {
    return `${prefix} ${successCount} destination${successCount === 1 ? '' : 's'}.`;
  }
  if (successCount === 0) {
    return `None of the selected destinations completed. ${failedTargets[0]?.error || 'Please try again.'}`;
  }
  return `${prefix} ${successCount} destination${successCount === 1 ? '' : 's'}; ${failureCount} failed (${failedTargets[0]?.error || 'Check account permissions.'}).`;
}

function isMissingRelationError(error) {
  if (!error) return false;
  const message = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return (
    message.includes('does not exist')
    || message.includes('relation')
    || message.includes('column')
    || message.includes('pgrst')
  );
}

export default function OrgDraftWorkflowModal({
  open = false,
  postId = null,
  onClose,
  onUpdated,
  onOpenGenerator,
}) {
  const { user } = useAuth();
  const { organizationId, brandProjectId, hasPermission } = useOrgContext();
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', caption: '', hashtagsInput: '' });
  const [promptInput, setPromptInput] = useState('');
  const [initialSnapshot, setInitialSnapshot] = useState('');
  const [scheduleContext, setScheduleContext] = useState(null);
  const [seoProceeded, setSeoProceeded] = useState(false);
  const [workflowConfigs, setWorkflowConfigs] = useState([]);
  const [workflowMembers, setWorkflowMembers] = useState([]);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [actionMode, setActionMode] = useState('approval');
  const [selectedDestinationIds, setSelectedDestinationIds] = useState([]);
  const [scheduleAtInput, setScheduleAtInput] = useState('');
  const [submissionBusy, setSubmissionBusy] = useState(false);
  const [pipelineItem, setPipelineItem] = useState(null);

  const parsedHashtags = useMemo(
    () => normalizeHashtags(form.hashtagsInput),
    [form.hashtagsInput],
  );

  const dirty = useMemo(() => (
    snapshotState({
      title: form.title,
      caption: form.caption,
      hashtags: parsedHashtags,
      prompt: promptInput,
    }) !== initialSnapshot
  ), [form.caption, form.title, initialSnapshot, parsedHashtags, promptInput]);

  const loadApprovalContext = useCallback(async (draftRecord) => {
    if (!organizationId || !draftRecord?.id) {
      setWorkflowConfigs([]);
      setWorkflowMembers([]);
      setSelectedWorkflowId('');
      setPipelineItem(null);
      return;
    }

    setWorkflowLoading(true);
    try {
      const effectiveBrandProjectId = draftRecord?.brand_project_id || brandProjectId || null;
      const [configs, members, linkedItemResult, latestItemResult] = await Promise.all([
        fetchPipelineConfigs({
          organizationId,
          brandProjectId: effectiveBrandProjectId,
        }),
        fetchOrganizationMembers(organizationId),
        draftRecord?.pipeline_item_id
          ? supabase
            .from('pipeline_items')
            .select('*')
            .eq('id', draftRecord.pipeline_item_id)
            .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from('pipeline_items')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('post_id', draftRecord.id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (linkedItemResult?.error) throw linkedItemResult.error;
      if (latestItemResult?.error) throw latestItemResult.error;

      const safeConfigs = Array.isArray(configs) ? configs : [];
      const safeMembers = Array.isArray(members) ? members : [];
      const activePipelineItem = linkedItemResult?.data || latestItemResult?.data || null;

      setWorkflowConfigs(safeConfigs);
      setWorkflowMembers(safeMembers);
      setPipelineItem(activePipelineItem);
      setSelectedWorkflowId((current) => {
        if (current && safeConfigs.some((config) => config.id === current)) {
          return current;
        }
        if (activePipelineItem?.pipeline_config_id && safeConfigs.some((config) => config.id === activePipelineItem.pipeline_config_id)) {
          return activePipelineItem.pipeline_config_id;
        }
        return safeConfigs[0]?.id || '';
      });
    } catch (contextError) {
      console.error('Failed to load approval context:', contextError);
      setWorkflowConfigs([]);
      setWorkflowMembers([]);
      setSelectedWorkflowId('');
      setPipelineItem(null);
    } finally {
      setWorkflowLoading(false);
    }
  }, [brandProjectId, organizationId]);

  const hydrate = useCallback(async () => {
    if (!open || !postId) return null;
    setLoading(true);
    setError('');
    try {
      const [nextDraft, schedule] = await Promise.all([
        fetchOrgDraftWorkflow(postId),
        fetchOrgScheduleContext({ postId }).catch(() => null),
      ]);

      setDraft(nextDraft);
      setScheduleContext(schedule);
      setForm({
        title: nextDraft?.title || '',
        caption: nextDraft?.caption || '',
        hashtagsInput: hashtagsToInput(nextDraft?.hashtags),
      });
      setPromptInput(nextDraft?.generations?.prompt || '');
      setInitialSnapshot(snapshotState({
        title: nextDraft?.title || '',
        caption: nextDraft?.caption || '',
        hashtags: nextDraft?.hashtags || [],
        prompt: nextDraft?.generations?.prompt || '',
      }));
      await loadApprovalContext(nextDraft);
      return nextDraft;
    } catch (loadError) {
      setError(loadError?.message || 'Could not load this draft.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [loadApprovalContext, open, postId]);

  useEffect(() => {
    if (!open || !postId) return;
    void hydrate();
  }, [hydrate, open, postId]);

  useEffect(() => {
    if (!open) return;
    setSelectedDestinationIds([]);
    setScheduleAtInput('');
  }, [open, postId]);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setLoading(false);
      setBusy('');
      setError('');
      setForm({ title: '', caption: '', hashtagsInput: '' });
      setPromptInput('');
      setInitialSnapshot('');
      setScheduleContext(null);
      setSeoProceeded(false);
      setWorkflowConfigs([]);
      setWorkflowMembers([]);
      setWorkflowLoading(false);
      setSelectedWorkflowId('');
      setActionMode('approval');
      setSelectedDestinationIds([]);
      setScheduleAtInput('');
      setSubmissionBusy(false);
      setPipelineItem(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const availableDestinations = safeArray(scheduleContext?.destinations)
      .filter((entry) => String(entry?.id || '').trim())
      .filter((entry) => !isUnavailableDestination(entry));

    setSelectedDestinationIds((current) => {
      const normalizedCurrent = safeArray(current).map((value) => String(value || '').trim()).filter(Boolean);
      const validCurrent = normalizedCurrent.filter((value) => (
        availableDestinations.some((entry) => String(entry?.id || '') === value)
      ));
      if (validCurrent.length > 0) return validCurrent;

      const currentAccountId = String(draft?.account_id || '').trim();
      if (currentAccountId && availableDestinations.some((entry) => String(entry?.id || '') === currentAccountId)) {
        return [currentAccountId];
      }

      return availableDestinations[0]?.id ? [String(availableDestinations[0].id)] : [];
    });

    setScheduleAtInput((current) => (
      String(current || '').trim()
        ? current
        : (toDateTimeInputValue(draft?.scheduled_at || scheduleContext?.post?.scheduled_at) || getDefaultScheduleInputValue())
    ));
  }, [draft?.account_id, draft?.scheduled_at, open, scheduleContext?.destinations, scheduleContext?.post?.scheduled_at]);

  useEffect(() => {
    if (!open || !draft?.id) return;
    if (String(draft?.metadata_status || '').toLowerCase() === 'completed') return;

    setBusy((current) => current || 'metadata:auto');
    void requestOrgDraftMetadata({
      postId: draft.id,
      generationId: draft.generation_id || null,
      fields: ['title', 'caption', 'hashtags'],
    })
      .then(() => hydrate())
      .catch((metadataError) => {
        setDraft((current) => {
          if (!current || current.id !== draft.id) return current;
          return {
            ...current,
            metadata_status: 'failed',
            workflow_state: {
              ...(current.workflow_state && typeof current.workflow_state === 'object' ? current.workflow_state : {}),
              metadata_status: 'failed',
              metadata_error: metadataError?.message || 'Metadata generation failed.',
            },
          };
        });
      })
      .finally(() => setBusy((current) => (current === 'metadata:auto' ? '' : current)));
  }, [draft?.generation_id, draft?.id, draft?.metadata_status, hydrate, open]);

  const persistForm = useCallback(async () => {
    if (!draft?.id) return null;

    const nextTitle = String(form.title || '').trim();
    const nextCaption = String(form.caption || '').trim();
    const nextPrompt = String(promptInput || '').trim();

    let updatedDraft = await updateOrgDraftWorkflow(
      draft.id,
      {
        title: nextTitle,
        caption: nextCaption,
        hashtags: parsedHashtags,
      },
      { currentDraft: draft },
    );

    if (updatedDraft?.generation_id && nextPrompt && nextPrompt !== String(draft?.generations?.prompt || '').trim()) {
      const { error: promptError } = await supabase
        .from('generations')
        .update({
          prompt: nextPrompt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', updatedDraft.generation_id);

      if (promptError) throw promptError;
      updatedDraft = {
        ...updatedDraft,
        generations: {
          ...(updatedDraft.generations || {}),
          prompt: nextPrompt,
        },
      };
    }

    setDraft(updatedDraft);
    setForm({
      title: updatedDraft?.title || '',
      caption: updatedDraft?.caption || '',
      hashtagsInput: hashtagsToInput(updatedDraft?.hashtags),
    });
    setPromptInput(updatedDraft?.generations?.prompt || nextPrompt);
    setInitialSnapshot(snapshotState({
      title: updatedDraft?.title || '',
      caption: updatedDraft?.caption || '',
      hashtags: updatedDraft?.hashtags || [],
      prompt: updatedDraft?.generations?.prompt || nextPrompt,
    }));
    onUpdated?.(updatedDraft);
    return updatedDraft;
  }, [
    draft,
    form.caption,
    form.title,
    onUpdated,
    parsedHashtags,
    promptInput,
  ]);

  const handleSaveChanges = async () => {
    if (!draft?.id) return;
    setBusy('save');
    try {
      await persistForm();
      toast.success('Draft changes saved.');
    } catch (saveError) {
      toast.error(saveError?.message || 'Could not save draft changes.');
    } finally {
      setBusy('');
    }
  };

  const regenerateMetadata = async (fields, label) => {
    if (!draft?.id) return;
    const requestedFields = Array.isArray(fields) ? fields : [fields];
    const busyKey = requestedFields.length > 1 ? 'metadata:all' : `metadata:${requestedFields[0]}`;
    setBusy(busyKey);
    try {
      const saved = await persistForm();
      await requestOrgDraftMetadata({
        postId: saved?.id || draft.id,
        generationId: saved?.generation_id || draft.generation_id || null,
        fields: requestedFields,
      });
      await hydrate();
      toast.success(`${label} regenerated.`);
    } catch (metadataError) {
      toast.error(metadataError?.message || `Could not regenerate ${label.toLowerCase()}.`);
    } finally {
      setBusy('');
    }
  };

  const resolveSeoPlatform = () => {
    const fallback = String(draft?.platform || destination?.platform || 'instagram').trim().toLowerCase();
    return fallback || 'instagram';
  };

  const handleScoreSeo = async () => {
    if (!draft?.id) return;
    setBusy('seo:score');
    try {
      const saved = await persistForm();
      const result = await scoreOrgDraftSeo({
        postId: saved?.id || draft.id,
        title: saved?.title || form.title,
        caption: saved?.caption || form.caption,
        hashtags: parsedHashtags,
        platform: resolveSeoPlatform(),
      });
      setDraft(result.draft);
      setSeoProceeded(false);
      toast.success(`SEO score: ${result?.seoState?.seo_score || 0}/100`);
    } catch (seoError) {
      toast.error(seoError?.message || 'Could not score SEO.');
    } finally {
      setBusy('');
    }
  };

  const handleOptimizeSeo = async () => {
    if (!draft?.id) return;
    setBusy('seo:optimize');
    try {
      const saved = await persistForm();
      const optimized = await runOrgDraftSeo({
        postId: saved?.id || draft.id,
        title: saved?.title || form.title,
        caption: saved?.caption || form.caption,
        hashtags: parsedHashtags,
        platform: resolveSeoPlatform(),
      });

      const applied = await applyOrgSeoSuggestions(saved?.id || draft.id, optimized?.seoState || {}, {
        currentDraft: optimized?.draft || saved,
      });

      const rescored = await scoreOrgDraftSeo({
        postId: applied?.id || saved?.id || draft.id,
        title: applied?.title || '',
        caption: applied?.caption || '',
        hashtags: applied?.hashtags || [],
        platform: resolveSeoPlatform(),
      });

      setDraft(rescored?.draft || applied);
      setForm({
        title: (rescored?.draft || applied)?.title || '',
        caption: (rescored?.draft || applied)?.caption || '',
        hashtagsInput: hashtagsToInput((rescored?.draft || applied)?.hashtags),
      });
      setSeoProceeded(false);
      toast.success(`Optimized with AI. Score: ${rescored?.seoState?.seo_score || 0}/100`);
    } catch (seoError) {
      toast.error(seoError?.message || 'Could not optimize SEO.');
    } finally {
      setBusy('');
    }
  };

  const toggleDestinationSelection = useCallback((destinationId, checked) => {
    const normalizedId = String(destinationId || '').trim();
    if (!normalizedId) return;
    setSelectedDestinationIds((current) => {
      const next = safeArray(current).map((value) => String(value || '').trim()).filter(Boolean);
      if (checked) {
        if (next.includes(normalizedId)) return next;
        return [...next, normalizedId];
      }
      return next.filter((value) => value !== normalizedId);
    });
  }, []);

  const resolveActionBrandProjectId = useCallback(async (sourceDraft) => {
    const selectedWorkflowConfig = workflowConfigs.find((config) => config.id === selectedWorkflowId) || null;
    const explicitBrandProjectId = sourceDraft?.brand_project_id
      || sourceDraft?.generations?.brand_project_id
      || brandProjectId
      || scheduleContext?.brand_project?.id
      || selectedWorkflowConfig?.brand_project_id
      || null;
    if (explicitBrandProjectId) return explicitBrandProjectId;

    if (!organizationId) return null;

    const { data, error } = await supabase
      .from('brand_projects')
      .select('id, status, is_default, created_at')
      .eq('organization_id', organizationId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) {
      if (!isMissingRelationError(error)) {
        throw error;
      }
      return null;
    }

    const rows = safeArray(data);
    const activeProject = rows.find((project) => (
      String(project?.status || 'active').trim().toLowerCase() !== 'archived'
    ));

    return activeProject?.id || rows[0]?.id || null;
  }, [
    brandProjectId,
    organizationId,
    scheduleContext?.brand_project?.id,
    selectedWorkflowId,
    workflowConfigs,
  ]);

  const ensureDestinationTargets = useCallback(async () => {
    if (!draft?.id) {
      throw new Error('This draft is not available right now.');
    }

    const selectableDestinations = safeArray(scheduleContext?.destinations)
      .filter((entry) => String(entry?.id || '').trim())
      .filter((entry) => !isUnavailableDestination(entry));

    const destinationMap = new Map(
      selectableDestinations.map((entry) => [String(entry.id), entry]),
    );

    const selectedDestinations = safeArray(selectedDestinationIds)
      .map((value) => destinationMap.get(String(value || '').trim()))
      .filter(Boolean);

    if (selectedDestinations.length === 0) {
      throw new Error('Select at least one destination account.');
    }

    const savedDraft = await persistForm();
    const sourceDraft = savedDraft || draft;
    if (!sourceDraft?.id) {
      throw new Error('Could not persist this draft before preparing destinations.');
    }

    const resolvedBrandProjectId = await resolveActionBrandProjectId(sourceDraft);
    if (!resolvedBrandProjectId) {
      throw new Error('A brand project is required before submitting to pipeline. Create/select a brand project, then try again.');
    }

    const sourceAccountId = String(sourceDraft.account_id || '').trim();
    const primaryDestination = selectedDestinations.find(
      (entry) => String(entry?.id || '') === sourceAccountId,
    ) || selectedDestinations[0];

    let primaryDraft = sourceDraft;
    const primaryNeedsRetarget = (
      sourceAccountId !== String(primaryDestination?.id || '')
      || String(sourceDraft?.platform || '').trim().toLowerCase() !== String(primaryDestination?.platform || '').trim().toLowerCase()
      || String(sourceDraft?.status || '').trim().toLowerCase() !== 'draft'
      || String(sourceDraft?.brand_project_id || '').trim() !== String(resolvedBrandProjectId)
    );

    if (primaryNeedsRetarget) {
      primaryDraft = await updateOrgDraftWorkflow(
        sourceDraft.id,
        {
          brand_project_id: resolvedBrandProjectId,
          account_id: primaryDestination.id,
          platform: primaryDestination.platform || sourceDraft.platform || null,
          status: 'draft',
          scheduled_at: null,
        },
        { currentDraft: sourceDraft },
      );
    }

    const targets = [
      {
        draft: primaryDraft,
        destination: primaryDestination,
        isSource: true,
      },
    ];

    const secondaryDestinations = selectedDestinations.filter(
      (entry) => String(entry?.id || '') !== String(primaryDestination?.id || ''),
    );

    if (secondaryDestinations.length === 0 || !sourceDraft?.organization_id || !sourceDraft?.generation_id) {
      return targets;
    }

    const { data: siblingRows, error: siblingError } = await supabase
      .from('posts')
      .select('id, account_id, status, updated_at')
      .eq('organization_id', sourceDraft.organization_id)
      .eq('generation_id', sourceDraft.generation_id)
      .neq('id', sourceDraft.id)
      .in('account_id', secondaryDestinations.map((entry) => entry.id));

    if (siblingError) throw siblingError;

    const sortedSiblings = safeArray(siblingRows)
      .slice()
      .sort((left, right) => (
        new Date(right?.updated_at || 0).getTime() - new Date(left?.updated_at || 0).getTime()
      ));

    const reusableByAccount = new Map();
    for (const row of sortedSiblings) {
      const accountId = String(row?.account_id || '').trim();
      const status = String(row?.status || '').trim().toLowerCase();
      if (!accountId || reusableByAccount.has(accountId)) continue;
      if (status === 'published' || status === 'failed') continue;
      reusableByAccount.set(accountId, row);
    }

    for (const destinationEntry of secondaryDestinations) {
      const accountKey = String(destinationEntry.id || '').trim();
      const reusable = reusableByAccount.get(accountKey);
      if (reusable?.id) {
        const updated = await updateOrgDraftWorkflow(reusable.id, {
          title: primaryDraft.title || null,
          caption: primaryDraft.caption || '',
          hashtags: primaryDraft.hashtags || [],
          generation_id: primaryDraft.generation_id || null,
          brand_project_id: resolvedBrandProjectId,
          account_id: destinationEntry.id,
          platform: destinationEntry.platform || null,
          status: 'draft',
          scheduled_at: null,
          seo_state: primaryDraft.seo_state || {},
          workflow_state: {
            approval_status: 'pending',
            approval_route: null,
            approval_workflow_id: null,
            approval_pipeline_item_id: null,
          },
        });

        targets.push({
          draft: updated,
          destination: destinationEntry,
          isSource: false,
        });
        continue;
      }

      const cloneSource = {
        ...primaryDraft,
        brand_project_id: resolvedBrandProjectId,
        workflow_state: {
          ...(primaryDraft?.workflow_state && typeof primaryDraft.workflow_state === 'object'
            ? primaryDraft.workflow_state
            : {}),
          approval_status: 'pending',
          approval_route: null,
          approval_workflow_id: null,
          approval_pipeline_item_id: null,
        },
      };

      const cloned = await cloneOrgDraftForAccount({
        sourceDraft: cloneSource,
        accountId: destinationEntry.id,
        platform: destinationEntry.platform || null,
      });

      targets.push({
        draft: cloned,
        destination: destinationEntry,
        isSource: false,
      });
    }

    return targets;
  }, [draft, persistForm, resolveActionBrandProjectId, scheduleContext?.destinations, selectedDestinationIds]);

  const runTargetBatch = useCallback(async (targets, executor) => {
    const results = [];
    for (const target of targets) {
      try {
        const payload = await executor(target);
        results.push({ target, success: true, ...(payload || {}) });
      } catch (executionError) {
        results.push({
          target,
          success: false,
          error: executionError?.message || 'Action failed for this destination.',
        });
      }
    }
    return results;
  }, []);

  const handleSubmitForApproval = async () => {
    if (!draft?.id || !organizationId || !user?.id) return;
    if (!selectedWorkflowId) {
      toast.error('Select an approval workflow first.');
      return;
    }

    setSubmissionBusy(true);
    const toastId = toast.loading('Submitting selected destinations for approval...');
    try {
      const targets = await ensureDestinationTargets();
      const nowIso = new Date().toISOString();
      const sourcePipelineStatus = String(pipelineItem?.status || '').trim().toLowerCase();
      const sourceResubmission = ['revision_requested', 'rejected'].includes(sourcePipelineStatus);

      const results = await runTargetBatch(targets, async (target) => {
        const isResubmission = target.isSource && sourceResubmission;
        const item = await submitPostToPipeline({
          organizationId,
          brandProjectId: target?.draft?.brand_project_id || brandProjectId || null,
          post: target.draft,
          userId: user.id,
          pipelineConfigId: selectedWorkflowId,
          submissionNote: isResubmission
            ? 'Resubmitted after revision.'
            : `Submitted from draft workflow editor for ${getDestinationLabel(target.destination)}.`,
        });

        const updatedDraft = await updateOrgDraftWorkflow(
          target.draft.id,
          {
            workflow_state: {
              approval_status: 'in_review',
              approval_submitted_at: nowIso,
              approval_route: 'approval',
              approval_workflow_id: selectedWorkflowId,
              approval_pipeline_item_id: item?.id || null,
              ...(isResubmission ? { approval_resubmitted_at: nowIso } : {}),
            },
          },
          { currentDraft: target.draft },
        );

        return { item, updatedDraft };
      });

      const successful = results.filter((entry) => entry.success);
      const failed = results.filter((entry) => !entry.success);
      const sourceSuccess = successful.find((entry) => entry.target?.isSource);

      if (sourceSuccess?.updatedDraft) {
        setDraft(sourceSuccess.updatedDraft);
        onUpdated?.(sourceSuccess.updatedDraft);
      }
      if (sourceSuccess?.item) {
        setPipelineItem(sourceSuccess.item);
      }

      if (failed.length === 0) {
        toast.success(getResultSummary('Submitted', successful, failed), { id: toastId });
      } else {
        toast.error(getResultSummary('Submitted', successful, failed), { id: toastId });
      }
      await hydrate();
    } catch (submissionError) {
      toast.error(submissionError?.message || 'Could not submit these destinations for approval.', { id: toastId });
    } finally {
      setSubmissionBusy(false);
    }
  };

  const handlePublishNow = async () => {
    if (!draft?.id || !organizationId || !user?.id) return;
    if (!selectedWorkflowId) {
      toast.error('Select a workflow before publishing.');
      return;
    }

    setSubmissionBusy(true);
    const toastId = toast.loading('Publishing selected destinations now...');
    try {
      const targets = await ensureDestinationTargets();
      const nowIso = new Date().toISOString();

      const results = await runTargetBatch(targets, async (target) => {
        const item = await createDirectPublishPipelineItem({
          organizationId,
          brandProjectId: target?.draft?.brand_project_id || brandProjectId || null,
          post: target.draft,
          userId: user.id,
          pipelineConfigId: selectedWorkflowId,
          submissionNote: `Direct publish from draft workflow editor for ${getDestinationLabel(target.destination)}.`,
        });

        const updatedDraft = await updateOrgDraftWorkflow(
          target.draft.id,
          {
            workflow_state: {
              approval_status: 'approved',
              approval_submitted_at: nowIso,
              approval_route: 'direct_publish',
              approval_workflow_id: selectedWorkflowId,
              approval_pipeline_item_id: item?.id || null,
            },
          },
          { currentDraft: target.draft },
        );

        await publishOrgCalendarRecord(item.id);
        return { item, updatedDraft };
      });

      const successful = results.filter((entry) => entry.success);
      const failed = results.filter((entry) => !entry.success);
      const sourceSuccess = successful.find((entry) => entry.target?.isSource);

      if (sourceSuccess?.updatedDraft) {
        setDraft(sourceSuccess.updatedDraft);
        onUpdated?.(sourceSuccess.updatedDraft);
      }
      if (sourceSuccess?.item) {
        setPipelineItem(sourceSuccess.item);
      }

      if (failed.length === 0) {
        toast.success(getResultSummary('Published', successful, failed), { id: toastId });
      } else {
        toast.error(getResultSummary('Published', successful, failed), { id: toastId });
      }
      await hydrate();
    } catch (publishError) {
      toast.error(publishError?.message || 'Could not publish selected destinations.', { id: toastId });
    } finally {
      setSubmissionBusy(false);
    }
  };

  const handleScheduleDirect = async () => {
    if (!draft?.id || !organizationId || !user?.id) return;
    if (!selectedWorkflowId) {
      toast.error('Select a workflow before scheduling.');
      return;
    }

    const scheduleDate = parseDateTimeInputValue(scheduleAtInput);
    if (!scheduleDate) {
      toast.error('Choose a valid schedule date and time first.');
      return;
    }
    if (scheduleDate.getTime() <= Date.now()) {
      toast.error('Schedule time must be in the future.');
      return;
    }

    setSubmissionBusy(true);
    const toastId = toast.loading('Scheduling selected destinations...');
    try {
      const targets = await ensureDestinationTargets();
      const nowIso = new Date().toISOString();
      const scheduledAtIso = scheduleDate.toISOString();

      const results = await runTargetBatch(targets, async (target) => {
        const item = await createDirectPublishPipelineItem({
          organizationId,
          brandProjectId: target?.draft?.brand_project_id || brandProjectId || null,
          post: target.draft,
          userId: user.id,
          pipelineConfigId: selectedWorkflowId,
          submissionNote: `Direct schedule from draft workflow editor for ${getDestinationLabel(target.destination)}.`,
        });

        const updatedDraft = await updateOrgDraftWorkflow(
          target.draft.id,
          {
            workflow_state: {
              approval_status: 'approved',
              approval_submitted_at: nowIso,
              approval_route: 'direct_schedule',
              approval_workflow_id: selectedWorkflowId,
              approval_pipeline_item_id: item?.id || null,
            },
          },
          { currentDraft: target.draft },
        );

        await scheduleOrgCalendarRecord({
          postId: target.draft.id,
          pipelineItemId: item.id,
          scheduledAt: scheduledAtIso,
          accountId: target.destination?.id || null,
        });

        return { item, updatedDraft };
      });

      const successful = results.filter((entry) => entry.success);
      const failed = results.filter((entry) => !entry.success);
      const sourceSuccess = successful.find((entry) => entry.target?.isSource);

      if (sourceSuccess?.updatedDraft) {
        setDraft(sourceSuccess.updatedDraft);
        onUpdated?.(sourceSuccess.updatedDraft);
      }
      if (sourceSuccess?.item) {
        setPipelineItem(sourceSuccess.item);
      }

      if (failed.length === 0) {
        toast.success(getResultSummary('Scheduled', successful, failed), { id: toastId });
      } else {
        toast.error(getResultSummary('Scheduled', successful, failed), { id: toastId });
      }
      await hydrate();
    } catch (scheduleError) {
      toast.error(scheduleError?.message || 'Could not schedule selected destinations.', { id: toastId });
    } finally {
      setSubmissionBusy(false);
    }
  };

  const handleCloseRequest = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) {
      return;
    }
    onClose?.();
  };

  const mediaType = String(draft?.generations?.media_type || 'image').trim().toLowerCase();
  const mediaUrl = draft?.generations?.storage_path || '';
  const metadataStatus = String(draft?.metadata_status || '').trim() || 'idle';
  const destinations = safeArray(scheduleContext?.destinations);
  const destinationById = useMemo(
    () => new Map(destinations.map((entry) => [String(entry?.id || ''), entry])),
    [destinations],
  );
  const selectedDestinations = useMemo(
    () => safeArray(selectedDestinationIds)
      .map((value) => destinationById.get(String(value || '').trim()))
      .filter(Boolean),
    [destinationById, selectedDestinationIds],
  );
  const selectedDestinationCount = selectedDestinations.length;
  const selectedDestinationLabels = selectedDestinations.map((entry) => getDestinationLabel(entry));
  const destination = selectedDestinations[0]
    || destinationById.get(String(draft?.account_id || '').trim())
    || null;
  const seoScore = Number(draft?.seo_state?.seo_score || 0);
  const seoSuggestions = Array.isArray(draft?.seo_state?.suggestions)
    ? draft.seo_state.suggestions
    : [];
  const seoBreakdown = getSeoBreakdown(draft?.seo_state || {});
  const canProceedFromSeo = seoScore > 0;
  const canPublish = Boolean(hasPermission?.('can_publish'));
  const requiresFinalApproval = Boolean(hasPermission?.('publish_requires_final_approval'));
  const canDirectPublish = canPublish && !requiresFinalApproval;
  const approvalOnlyRoute = !canDirectPublish;
  const activeActionMode = approvalOnlyRoute ? 'approval' : actionMode;
  const scheduledActionDate = parseDateTimeInputValue(scheduleAtInput);
  const scheduledActionLabel = scheduledActionDate
    ? formatDateTime(scheduledActionDate.toISOString())
    : 'Not scheduled';
  const selectedWorkflow = workflowConfigs.find((config) => config.id === selectedWorkflowId) || null;
  const stageCount = Array.isArray(selectedWorkflow?.stages) ? selectedWorkflow.stages.length : 0;
  const stageOrder = Number(pipelineItem?.current_stage_order || 0);
  const pipelineCurrentStageLabel = stageOrder > 0 && stageCount > 0
    ? `Stage ${Math.min(stageOrder, stageCount)} of ${stageCount}`
    : (pipelineItem?.status ? formatRoleLabel(pipelineItem.status) : 'Not submitted');
  const membersById = useMemo(
    () => new Map((workflowMembers || []).map((member) => [member.userId, member])),
    [workflowMembers],
  );
  const approvedHistory = useMemo(
    () => getApprovedHistory(pipelineItem),
    [pipelineItem],
  );
  const rejectionComment = useMemo(
    () => getLatestHistoryComment(pipelineItem, ['request_revision', 'reject']),
    [pipelineItem],
  );
  const sourceNeedsResubmission = ['revision_requested', 'rejected'].includes(
    String(pipelineItem?.status || '').trim().toLowerCase(),
  );
  const scheduleInputIsValid = Boolean(scheduledActionDate && scheduledActionDate.getTime() > Date.now());
  const actionButtonLabel = activeActionMode === 'approval'
    ? (
      sourceNeedsResubmission
        ? (submissionBusy ? 'Resubmitting...' : 'Resubmit for Approval')
        : (submissionBusy ? 'Submitting...' : 'Submit for Approval')
    )
    : activeActionMode === 'publish_now'
      ? (submissionBusy ? 'Publishing...' : 'Post Immediately')
      : (submissionBusy ? 'Scheduling...' : 'Schedule Post');
  const actionButtonIcon = activeActionMode === 'schedule' ? <CalendarClock size={14} /> : <ShieldCheck size={14} />;
  const disableActionButton = (
    submissionBusy
    || !selectedWorkflowId
    || workflowConfigs.length === 0
    || selectedDestinationCount === 0
    || (activeActionMode === 'schedule' && !scheduleInputIsValid)
  );

  useEffect(() => {
    if (!canDirectPublish) {
      setActionMode('approval');
    }
  }, [canDirectPublish]);

  if (!open) return null;

  return (
    <div className="org-draft-workflow-shell" role="dialog" aria-modal="true" aria-label="Edit draft">
      <button
        type="button"
        className="org-draft-workflow-backdrop"
        aria-label="Close draft editor"
        onClick={handleCloseRequest}
      />

      <section className="org-draft-workflow-surface">
        <header className="org-draft-workflow-header">
          <div>
            <span className="org-draft-workflow-kicker">Edit Draft</span>
            <h2>{form.title || draft?.title || 'Untitled draft'}</h2>
            <p>Edit prompt, regenerate metadata, and save without leaving My Office.</p>
          </div>
          <button type="button" className="org-close-button" onClick={handleCloseRequest} aria-label="Close draft editor">
            <X size={16} />
          </button>
        </header>

        {loading ? <div className="org-panel-loading">Loading draft editor...</div> : null}
        {!loading && error ? <div className="org-empty-inline">{error}</div> : null}

        {!loading && !error && draft ? (
          <div className="org-draft-edit-layout">
            <section className="org-draft-edit-left">
              <div className="org-draft-edit-card">
                <label className="org-field-group">
                  <span>Prompt</span>
                  <textarea
                    rows={6}
                    value={promptInput}
                    onChange={(event) => setPromptInput(event.target.value)}
                    placeholder="Describe the prompt used to generate this post..."
                  />
                </label>

                <div className="org-draft-edit-actions">
                  <button
                    type="button"
                    className="org-secondary-button"
                    onClick={() => onOpenGenerator?.({ ...draft, prompt: promptInput })}
                  >
                    <Sparkles size={14} />
                    Regenerate Media
                  </button>
                  <button
                    type="button"
                    className="org-secondary-button"
                    onClick={() => void regenerateMetadata(['title', 'caption', 'hashtags'], 'Metadata')}
                    disabled={busy.startsWith('metadata:')}
                  >
                    <RefreshCcw size={14} />
                    Refresh All Metadata
                  </button>
                </div>
              </div>

              <div className="org-draft-edit-card">
                <span className="org-draft-workflow-kicker">Media Preview</span>
                <div className="org-draft-edit-media">
                  {mediaUrl ? (
                    mediaType === 'video' ? (
                      <video src={mediaUrl} controls />
                    ) : (
                      <img src={mediaUrl} alt="Draft preview" />
                    )
                  ) : (
                    <div className="org-draft-edit-media-empty">No preview available yet.</div>
                  )}
                </div>
              </div>
            </section>

            <section className="org-draft-edit-right">
              <div className="org-draft-edit-card">
                <div className="org-draft-edit-card-header">
                  <span className="org-draft-workflow-kicker">Metadata</span>
                  <span className={`org-draft-workflow-chip ${metadataStatus}`}>
                    {busy === 'metadata:auto' ? (
                      <>
                        <Loader2 size={13} className="org-spin" />
                        Generating...
                      </>
                    ) : (
                      `Status: ${metadataStatus}`
                    )}
                  </span>
                </div>

                <label className="org-field-group">
                  <span>Title</span>
                  <div className="org-draft-inline-field">
                    <input
                      type="text"
                      value={form.title}
                      onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                      placeholder="Required for YouTube publishing"
                    />
                    <button
                      type="button"
                      className="org-secondary-button org-draft-inline-action"
                      onClick={() => void regenerateMetadata(['title'], 'Title')}
                      disabled={busy === 'metadata:title' || busy === 'metadata:all'}
                      aria-label="Regenerate title"
                    >
                      <RefreshCcw size={14} />
                    </button>
                  </div>
                </label>

                <label className="org-field-group">
                  <span>Caption</span>
                  <div className="org-draft-inline-field">
                    <textarea
                      rows={6}
                      value={form.caption}
                      onChange={(event) => setForm((current) => ({ ...current, caption: event.target.value }))}
                      placeholder="Write or regenerate caption..."
                    />
                    <button
                      type="button"
                      className="org-secondary-button org-draft-inline-action"
                      onClick={() => void regenerateMetadata(['caption'], 'Caption')}
                      disabled={busy === 'metadata:caption' || busy === 'metadata:all'}
                      aria-label="Regenerate caption"
                    >
                      <RefreshCcw size={14} />
                    </button>
                  </div>
                </label>

                <label className="org-field-group">
                  <span>Hashtags</span>
                  <div className="org-draft-inline-field">
                    <input
                      type="text"
                      value={form.hashtagsInput}
                      onChange={(event) => setForm((current) => ({ ...current, hashtagsInput: event.target.value }))}
                      placeholder="#tag1 #tag2 #tag3"
                    />
                    <button
                      type="button"
                      className="org-secondary-button org-draft-inline-action"
                      onClick={() => void regenerateMetadata(['hashtags'], 'Hashtags')}
                      disabled={busy === 'metadata:hashtags' || busy === 'metadata:all'}
                      aria-label="Regenerate hashtags"
                    >
                      <RefreshCcw size={14} />
                    </button>
                  </div>
                </label>

                <div className="org-draft-seo-card">
                  <div className="org-draft-seo-header">
                    <span className="org-draft-workflow-kicker">
                      <TrendingUp size={14} />
                      SEO Score
                    </span>
                    <strong>{seoScore}/100</strong>
                  </div>

                  <div className="org-draft-seo-bars">
                    {[
                      { key: 'title', label: 'Title' },
                      { key: 'caption', label: 'Caption' },
                      { key: 'hashtags', label: 'Hashtags' },
                    ].map((entry) => (
                      <div key={entry.key} className="org-draft-seo-bar-row">
                        <span>{entry.label}</span>
                        <div className="org-draft-seo-track">
                          <div className="org-draft-seo-fill" style={{ width: `${seoBreakdown[entry.key]}%` }} />
                        </div>
                        <span>{seoBreakdown[entry.key]}</span>
                      </div>
                    ))}
                  </div>

                  {seoSuggestions.length > 0 ? (
                    <ul className="org-draft-seo-suggestions">
                      {seoSuggestions.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="org-draft-seo-empty">Run SEO scoring to see recommendations.</p>
                  )}

                  <div className="org-draft-seo-actions">
                    <button
                      type="button"
                      className="org-secondary-button"
                      onClick={() => void handleScoreSeo()}
                      disabled={busy === 'seo:score' || busy === 'seo:optimize'}
                    >
                      <TrendingUp size={14} />
                      {busy === 'seo:score' ? 'Scoring...' : 'Run SEO Score'}
                    </button>
                    <button
                      type="button"
                      className="org-secondary-button"
                      onClick={() => void handleOptimizeSeo()}
                      disabled={busy === 'seo:score' || busy === 'seo:optimize'}
                    >
                      <Sparkles size={14} />
                      {busy === 'seo:optimize' ? 'Optimizing...' : 'Optimize with AI'}
                    </button>
                    <button
                      type="button"
                      className="org-primary-button"
                      onClick={() => setSeoProceeded(true)}
                      disabled={!canProceedFromSeo || busy === 'seo:score' || busy === 'seo:optimize'}
                    >
                      <ArrowRight size={14} />
                      Proceed
                    </button>
                  </div>

                  {seoProceeded ? (
                    <p className="org-draft-seo-proceed-note">
                      SEO accepted. Continue with approval/publishing in the next workflow stage.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="org-draft-edit-card">
                <div className="org-draft-edit-card-header">
                  <span className="org-draft-workflow-kicker">
                    <ShieldCheck size={14} />
                    Approval Workflow
                  </span>
                  {approvalOnlyRoute ? (
                    <span className="org-draft-workflow-chip in_progress">Approval required by role</span>
                  ) : (
                    <span className="org-draft-workflow-chip">Direct publish allowed</span>
                  )}
                </div>

                {!seoProceeded ? (
                  <p className="org-draft-seo-empty">
                    Complete SEO review first, then choose approval, immediate posting, or scheduling.
                  </p>
                ) : (
                  <div className="org-draft-approval-stack">
                    {!approvalOnlyRoute ? (
                      <div className="org-draft-route-toggle">
                        <button
                          type="button"
                          className={`org-secondary-button ${activeActionMode === 'approval' ? 'active' : ''}`}
                          onClick={() => setActionMode('approval')}
                          disabled={submissionBusy}
                        >
                          Send for Approval
                        </button>
                        <button
                          type="button"
                          className={`org-secondary-button ${activeActionMode === 'publish_now' ? 'active' : ''}`}
                          onClick={() => setActionMode('publish_now')}
                          disabled={submissionBusy}
                        >
                          Post Immediately
                        </button>
                        <button
                          type="button"
                          className={`org-secondary-button ${activeActionMode === 'schedule' ? 'active' : ''}`}
                          onClick={() => setActionMode('schedule')}
                          disabled={submissionBusy}
                        >
                          Schedule
                        </button>
                      </div>
                    ) : null}

                    {workflowLoading ? (
                      <div className="org-panel-loading">Loading workflows...</div>
                    ) : workflowConfigs.length === 0 ? (
                      <div className="org-empty-inline">
                        No active approval workflow found. Ask an org admin to configure one in Pipeline settings.
                      </div>
                    ) : (
                      <div className="org-draft-workflow-list">
                        {workflowConfigs.map((config) => {
                          const selected = config.id === selectedWorkflowId;
                          const stages = Array.isArray(config?.stages) ? config.stages : [];
                          return (
                            <button
                              key={config.id}
                              type="button"
                              className={`org-draft-workflow-option ${selected ? 'active' : ''}`}
                              onClick={() => setSelectedWorkflowId(config.id)}
                              disabled={submissionBusy}
                            >
                              <div className="org-draft-workflow-option-head">
                                <strong>{config.name || 'Workflow'}</strong>
                                <span>{stages.length} stages</span>
                              </div>
                              <p>{config.description || 'No description provided.'}</p>
                              <div className="org-draft-workflow-option-stages">
                                {stages.map((stage) => {
                                  const actorLabel = stage?.assignee_user_id
                                    ? getActorLabel(stage.assignee_user_id, membersById)
                                    : formatRoleLabel(stage?.assignee_role);
                                  return (
                                    <span key={stage.id || `${config.id}-${stage.order || actorLabel}`}>
                                      <GitBranch size={12} />
                                      {stage?.name || 'Stage'} / {actorLabel}
                                    </span>
                                  );
                                })}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="org-draft-approval-summary">
                      <div>
                        <strong>Status</strong>
                        <span>{formatRoleLabel(pipelineItem?.status || 'not_submitted')}</span>
                      </div>
                      <div>
                        <strong>Current Stage</strong>
                        <span>{pipelineCurrentStageLabel}</span>
                      </div>
                      <div>
                        <strong>Workflow</strong>
                        <span>{selectedWorkflow?.name || 'Not selected'}</span>
                      </div>
                    </div>

                    {rejectionComment ? (
                      <p className="org-draft-approval-comment">
                        Rejection note: {rejectionComment}
                      </p>
                    ) : null}

                    {approvedHistory.length > 0 ? (
                      <div className="org-draft-approval-history">
                        <strong>Approved stages</strong>
                        {approvedHistory.map((entry, index) => (
                          <span key={`${entry?.timestamp || entry?.stage_name || 'entry'}-${index}`}>
                            {entry?.stage_name || 'Stage'} / {getActorLabel(entry?.actor_id, membersById)} / {formatDateTime(entry?.timestamp)}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {selectedDestinationCount === 0 ? (
                      <div className="org-empty-inline">
                        Select at least one connected destination in Schedule + Platform before continuing.
                      </div>
                    ) : null}

                    {activeActionMode === 'schedule' ? (
                      <p className="org-draft-seo-empty">
                        Scheduling for: {scheduledActionLabel}
                      </p>
                    ) : null}

                    <div className="org-draft-approval-actions">
                      <button
                        type="button"
                        className="org-primary-button"
                        onClick={() => {
                          if (activeActionMode === 'publish_now') {
                            void handlePublishNow();
                            return;
                          }
                          if (activeActionMode === 'schedule') {
                            void handleScheduleDirect();
                            return;
                          }
                          void handleSubmitForApproval();
                        }}
                        disabled={disableActionButton}
                      >
                        {actionButtonIcon}
                        {actionButtonLabel}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="org-draft-edit-card">
                <span className="org-draft-workflow-kicker">Schedule + Platform</span>
                <div className="org-draft-edit-meta-grid">
                  <div>
                    <strong>Primary Platform</strong>
                    <span>{getPlatformLabel(destination?.platform || draft?.platform)}</span>
                  </div>
                  <div>
                    <strong>Selected Destinations</strong>
                    <span>{selectedDestinationCount > 0 ? `${selectedDestinationCount} selected` : 'None selected'}</span>
                  </div>
                  <div>
                    <strong>Current Schedule</strong>
                    <span>{formatDateTime(draft?.scheduled_at || scheduleContext?.post?.scheduled_at)}</span>
                  </div>
                  <div>
                    <strong>SEO score</strong>
                    <span>{draft?.seo_state?.seo_score ? `${draft.seo_state.seo_score}/100` : 'Pending Stage 4'}</span>
                  </div>
                </div>

                {destinations.length === 0 ? (
                  <div className="org-empty-inline">
                    No connected destinations found. Connect accounts to continue.
                  </div>
                ) : (
                  <div className="org-draft-destination-list">
                    {destinations.map((entry) => {
                      const destinationId = String(entry?.id || '').trim();
                      const disabled = isUnavailableDestination(entry);
                      const checked = selectedDestinationIds.includes(destinationId);
                      return (
                        <label
                          key={destinationId || `${entry?.platform || 'destination'}-${entry?.username || entry?.account_name || 'entry'}`}
                          className={`org-draft-destination-option ${disabled ? 'disabled' : ''}`.trim()}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled || submissionBusy}
                            onChange={(event) => toggleDestinationSelection(destinationId, event.target.checked)}
                          />
                          <span className="org-draft-destination-copy">
                            <span className="org-draft-destination-head">
                              <strong>{getDestinationLabel(entry)}</strong>
                              <span className={`org-draft-destination-chip ${entry?.scope === 'organization' ? 'org' : 'personal'}`}>
                                {entry?.scope === 'organization' ? 'Org' : 'Personal'}
                              </span>
                            </span>
                            <span>
                              {[getPlatformLabel(entry?.platform), entry?.connection_status].filter(Boolean).join(' / ') || 'Connected account'}
                            </span>
                            <small className={disabled ? 'no-access' : ''}>
                              {getDestinationSupportText(entry)}
                            </small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}

                <div className="org-draft-destination-summary">
                  {selectedDestinationCount > 0
                    ? `Selected destinations: ${selectedDestinationLabels.join(', ')}.`
                    : 'No destination selected yet.'}
                </div>

                {activeActionMode === 'schedule' ? (
                  <label className="org-field-group org-draft-schedule-field">
                    <span>Schedule time</span>
                    <input
                      type="datetime-local"
                      value={scheduleAtInput}
                      onChange={(event) => setScheduleAtInput(event.target.value)}
                      min={toDateTimeInputValue(new Date())}
                      disabled={submissionBusy}
                    />
                    <p className="org-draft-schedule-help">
                      Pick a future date/time. This will be applied to all selected destinations.
                    </p>
                  </label>
                ) : null}
              </div>

              <div className="org-draft-edit-save">
                <button
                  type="button"
                  className="org-primary-button"
                  onClick={() => void handleSaveChanges()}
                  disabled={busy === 'save' || busy.startsWith('metadata:')}
                >
                  <Save size={14} />
                  {busy === 'save' ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
}
