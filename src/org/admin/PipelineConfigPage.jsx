"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Plus, Save, Trash2, Wand2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../services/supabaseClient';
import OrgSelect from '../components/OrgSelect';
import OrgEmptyState from '../components/OrgEmptyState';
import { ORG_ROLE_LABELS } from '../constants/permissions';
import { useOrgContext } from '../hooks/useOrgContext';
import { fetchOrganizationMembers } from '../services/orgService';
import {
  PIPELINE_TEMPLATE_PRESETS,
  buildTemplateStages,
  createPipelineConfig,
  createPipelineStage,
  deletePipelineConfig,
  duplicatePipelineConfig,
  fetchPipelineConfigs,
  normalizePipelineStages,
  setDefaultPipelineConfig,
  updatePipelineConfig,
} from '../services/pipelineService';
function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function createBlankDraftConfig({ organizationId, brandProjectId }) {
  return {
    id: '__draft__',
    organization_id: organizationId,
    brand_project_id: brandProjectId || null,
    name: 'New Pipeline',
    description: '',
    template_key: 'custom',
    is_default: false,
    stages: [],
  };
}

function createTemplateDraftConfig({ organizationId, brandProjectId, templateKey }) {
  return {
    id: '__draft__',
    organization_id: organizationId,
    brand_project_id: brandProjectId || null,
    name: 'New Pipeline',
    description: '',
    template_key: templateKey,
    is_default: false,
    stages: normalizePipelineStages(buildTemplateStages(templateKey)),
  };
}

function formatAssignee(stage, members) {
  if (stage.assignee_type === 'specific_user' && stage.assignee_user_id) {
    const member = members.find((item) => item.userId === stage.assignee_user_id);
    return member?.profile?.full_name || member?.profile?.email || 'Specific member';
  }

  return ORG_ROLE_LABELS[stage.assignee_role] || String(stage.assignee_role || 'editor').replace(/_/g, ' ');
}

function TemplateGallery({ open, onClose, onPick }) {
  if (!open) return null;

  return (
    <>
      <button type="button" className="org-drawer-backdrop" onClick={onClose} aria-label="Close template gallery" />
      <div className="org-template-modal">
        <div className="org-template-modal-header">
          <div>
            <span className="org-modal-kicker">Pipeline Templates</span>
            <h3>Start from a proven workflow</h3>
          </div>
          <button type="button" className="org-text-button" onClick={onClose}>Close</button>
        </div>

        <div className="org-template-grid">
          {PIPELINE_TEMPLATE_PRESETS.map((template) => (
            <button
              key={template.key}
              type="button"
              className="org-template-card"
              onClick={() => onPick(template.key)}
            >
              <strong>{template.label}</strong>
              <span>{template.description}</span>
              <small>{buildTemplateStages(template.key).length} stages</small>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function StageNode({
  stage,
  active,
  members,
  onSelect,
  onInsertAfter,
}) {
  return (
    <div className="org-pipeline-stage-stack">
      <button
        type="button"
        className={`org-pipeline-node ${active ? 'active' : ''}`}
        onClick={onSelect}
      >
        <div className="org-pipeline-node-top">
          <span className="org-pipeline-node-order">Stage {stage.order}</span>
          {stage.generates_client_review_link ? (
            <span className="org-pipeline-node-badge">Client Link</span>
          ) : null}
        </div>
        <strong>{stage.name}</strong>
        <span>{formatAssignee(stage, members)}</span>
        <small>
          {stage.sla_hours ? `${stage.sla_hours}h SLA` : 'No SLA'}
          {stage.is_optional ? ' • Optional' : ''}
        </small>
      </button>

      <button
        type="button"
        className="org-pipeline-insert"
        onClick={onInsertAfter}
        aria-label={`Insert stage after ${stage.name}`}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

export default function PipelineConfigPage() {
  const { organizationId, brandProjectId } = useOrgContext();
  const [configs, setConfigs] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [activeStageId, setActiveStageId] = useState(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      try {
        const [nextConfigs, nextMembers] = await Promise.all([
          fetchPipelineConfigs({ organizationId, brandProjectId }),
          fetchOrganizationMembers(organizationId),
        ]);

        if (cancelled) return;

        setConfigs(nextConfigs);
        setMembers(nextMembers);

        if (nextConfigs.length > 0) {
          const nextSelected = nextConfigs.find((config) => config.id === selectedId) || nextConfigs[0];
          setSelectedId(nextSelected.id);
          setDraft({
            ...cloneValue(nextSelected),
            stages: normalizePipelineStages(nextSelected.stages || []),
          });
        } else {
          setSelectedId('__draft__');
          setDraft(createBlankDraftConfig({ organizationId, brandProjectId }));
        }

        setActiveStageId(null);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load pipeline configs:', error);
          toast.error(error?.message || 'Could not load pipeline configurations.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [brandProjectId, organizationId]);

  const activeStage = useMemo(
    () => draft?.stages?.find((stage) => stage.id === activeStageId) || null,
    [activeStageId, draft?.stages],
  );

  const roleOptions = useMemo(() => ([
    { value: 'org_owner', label: 'Org Owner' },
    { value: 'org_admin', label: 'Org Admin' },
    { value: 'editor', label: 'Editor' },
    { value: 'contributor', label: 'Contributor' },
    { value: 'reviewer', label: 'Reviewer' },
  ]), []);

  const memberOptions = useMemo(() => (
    members.map((member) => ({
      value: member.userId,
      label: member.profile?.full_name || member.profile?.email || member.userId,
      description: ORG_ROLE_LABELS[member.role] || member.role,
    }))
  ), [members]);

  const applyDraft = (updater) => {
    setDraft((current) => {
      if (!current) return current;
      const next = typeof updater === 'function' ? updater(cloneValue(current)) : updater;
      return {
        ...next,
        stages: normalizePipelineStages(next.stages || []),
      };
    });
  };

  const selectConfig = (config) => {
    if (!config) return;
    setSelectedId(config.id);
    setDraft({
      ...cloneValue(config),
      stages: normalizePipelineStages(config.stages || []),
    });
    setActiveStageId(null);
  };

  const startNewConfig = () => {
    setSelectedId('__draft__');
    setDraft(createBlankDraftConfig({ organizationId, brandProjectId }));
    setActiveStageId(null);
  };

  const startTemplatedConfig = (templateKey) => {
    setSelectedId('__draft__');
    setDraft(createTemplateDraftConfig({ organizationId, brandProjectId, templateKey }));
    setActiveStageId(null);
    setGalleryOpen(false);
  };

  const updateStage = (stageId, patch) => {
    applyDraft((current) => ({
      ...current,
      stages: current.stages.map((stage) => (
        stage.id === stageId
          ? {
              ...stage,
              ...patch,
            }
          : stage
      )),
    }));
  };

  const insertStageAfter = (index) => {
    let nextStageId = null;

    applyDraft((current) => {
      const nextStage = createPipelineStage({
        name: 'New Stage',
        assignee_role: 'editor',
      });
      nextStageId = nextStage.id;
      const nextStages = [...current.stages];
      nextStages.splice(index + 1, 0, nextStage);
      return {
        ...current,
        stages: nextStages,
      };
    });

    setActiveStageId(nextStageId);
  };

  const handleAddFirstStage = () => {
    const nextStage = createPipelineStage({
      name: 'New Stage',
      assignee_role: 'editor',
    });

    applyDraft((current) => ({
      ...current,
      stages: [nextStage],
    }));
    setActiveStageId(nextStage.id);
  };

  const moveStage = (stageId, direction) => {
    applyDraft((current) => {
      const stageIndex = current.stages.findIndex((stage) => stage.id === stageId);
      const targetIndex = stageIndex + direction;

      if (stageIndex < 0 || targetIndex < 0 || targetIndex >= current.stages.length) {
        return current;
      }

      const nextStages = [...current.stages];
      const [removed] = nextStages.splice(stageIndex, 1);
      nextStages.splice(targetIndex, 0, removed);

      return {
        ...current,
        stages: nextStages,
      };
    });
  };

  const removeStage = (stageId) => {
    applyDraft((current) => ({
      ...current,
      stages: current.stages.filter((stage) => stage.id !== stageId),
    }));
    setActiveStageId((current) => (current === stageId ? null : current));
  };

  const handleSave = async () => {
    if (!draft?.name?.trim()) {
      toast.error('Give this pipeline a name first.');
      return;
    }

    setSaving(true);

    try {
      const { data: authData } = await supabase.auth.getUser();
      const currentUserId = authData?.user?.id || null;

      let saved;
      if (selectedId === '__draft__') {
        saved = await createPipelineConfig({
          organizationId,
          brandProjectId,
          name: draft.name,
          description: draft.description,
          templateKey: draft.template_key || 'custom',
          stages: draft.stages,
          isDefault: draft.is_default,
          createdBy: currentUserId,
        });
        toast.success('Pipeline created.');
      } else {
        saved = await updatePipelineConfig(selectedId, {
          name: draft.name,
          description: draft.description,
          template_key: draft.template_key || 'custom',
          stages: draft.stages,
        });

        if (draft.is_default) {
          await setDefaultPipelineConfig({
            organizationId,
            pipelineConfigId: saved.id,
          });
        }

        toast.success('Pipeline updated.');
      }

      const nextConfigs = await fetchPipelineConfigs({ organizationId, brandProjectId });
      setConfigs(nextConfigs);
      selectConfig(nextConfigs.find((config) => config.id === saved.id) || saved);
    } catch (error) {
      console.error('Failed to save pipeline config:', error);
      toast.error(error?.message || 'Could not save this pipeline.');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!draft || selectedId === '__draft__') return;

    setSaving(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const duplicated = await duplicatePipelineConfig({
        organizationId,
        pipelineConfig: draft,
        createdBy: authData?.user?.id || null,
      });

      const nextConfigs = await fetchPipelineConfigs({ organizationId, brandProjectId });
      setConfigs(nextConfigs);
      selectConfig(nextConfigs.find((config) => config.id === duplicated.id) || duplicated);
      toast.success('Pipeline duplicated.');
    } catch (error) {
      toast.error(error?.message || 'Could not duplicate this pipeline.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (config) => {
    if (!config?.id || config.id === '__draft__') {
      startNewConfig();
      return;
    }

    const confirmed = window.confirm(`Delete the "${config.name}" pipeline?`);
    if (!confirmed) return;

    setSaving(true);
    try {
      await deletePipelineConfig(config.id);
      const nextConfigs = await fetchPipelineConfigs({ organizationId, brandProjectId });
      setConfigs(nextConfigs);
      if (nextConfigs.length > 0) {
        selectConfig(nextConfigs[0]);
      } else {
        startNewConfig();
      }
      toast.success('Pipeline deleted.');
    } catch (error) {
      toast.error(error?.message || 'Could not delete this pipeline.');
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async () => {
    if (!draft || selectedId === '__draft__') {
      applyDraft((current) => ({ ...current, is_default: true }));
      return;
    }

    setSaving(true);
    try {
      await setDefaultPipelineConfig({
        organizationId,
        pipelineConfigId: selectedId,
      });
      const nextConfigs = await fetchPipelineConfigs({ organizationId, brandProjectId });
      setConfigs(nextConfigs);
      selectConfig(nextConfigs.find((config) => config.id === selectedId) || draft);
      toast.success('Default pipeline updated.');
    } catch (error) {
      toast.error(error?.message || 'Could not mark this as default.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="org-panel-loading">Loading pipeline configs...</div>;
  }

  if (!draft) {
    return (
      <OrgEmptyState
        eyebrow="Pipeline Config"
        title="No pipeline configurations yet"
        description="Create a pipeline to start shaping the review flow for this organization."
        action={(
          <button type="button" className="org-primary-button" onClick={startNewConfig}>
            New Pipeline
          </button>
        )}
      />
    );
  }

  return (
    <section className="org-page org-admin-page org-admin-pipeline-page">
      <div className="org-page-header">
        <div>
          <h1>Pipeline Builder</h1>
          <p>Design and maintain the review flow for this workspace without leaving the org admin shell.</p>
        </div>

        <div className="org-page-actions">
          <button type="button" className="org-text-button" onClick={() => setGalleryOpen(true)}>
            <Wand2 size={14} />
            Use Template
          </button>
          <button type="button" className="org-primary-button" onClick={startNewConfig}>
            <Plus size={14} />
            New Pipeline
          </button>
        </div>
      </div>

      <div className="org-pipeline-admin-layout">
        <aside className="org-panel org-pipeline-sidebar">
          <div className="org-panel-header">
            <div>
              <h3>Configured Flows</h3>
              <p>Choose a pipeline to edit or duplicate.</p>
            </div>
          </div>

          <div className="org-pipeline-config-list">
            {configs.map((config) => (
              <div
                key={config.id}
                className={`org-pipeline-config-item ${selectedId === config.id ? 'active' : ''}`}
              >
                <button
                  type="button"
                  className="org-pipeline-config-main"
                  onClick={() => selectConfig(config)}
                >
                  <strong>{config.name}</strong>
                  <span>{(config.stages || []).length} stages • {config.template_key || 'custom'}</span>
                  {config.is_default ? <small>Default</small> : null}
                </button>

                <button
                  type="button"
                  className="org-pipeline-config-delete"
                  onClick={() => handleDelete(config)}
                  aria-label={`Delete ${config.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <div className="org-panel org-pipeline-builder">
          <div className="org-pipeline-builder-header">
            <div className="org-pipeline-builder-copy">
              <input
                type="text"
                className="org-pipeline-title-input"
                value={draft.name}
                onChange={(event) => applyDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))}
                placeholder="Pipeline name"
              />

              <textarea
                className="org-pipeline-description-input"
                value={draft.description || ''}
                onChange={(event) => applyDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))}
                placeholder="Describe what this review flow is used for."
                rows={2}
              />
            </div>

            <div className="org-pipeline-builder-actions">
              <button type="button" className="org-text-button" onClick={handleSetDefault} disabled={saving}>
                <Check size={14} />
                {draft.is_default ? 'Default Flow' : 'Set Default'}
              </button>
              <button type="button" className="org-text-button" onClick={handleDuplicate} disabled={saving || selectedId === '__draft__'}>
                <Copy size={14} />
                Duplicate
              </button>
              <button type="button" className="org-primary-button" onClick={handleSave} disabled={saving}>
                <Save size={14} />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>

          <div className="org-pipeline-canvas-shell">
            <div className="org-pipeline-endpoint-lane">
              <div className="org-pipeline-endpoint">
                <span>Submission</span>
              </div>
            </div>

            <div className="org-pipeline-stage-viewport">
              {draft.stages.length > 0 ? (
                <div className="org-pipeline-canvas">
                  {draft.stages.map((stage, index) => (
                    <StageNode
                      key={stage.id}
                      stage={stage}
                      active={stage.id === activeStageId}
                      members={members}
                      onSelect={() => setActiveStageId((current) => (current === stage.id ? null : stage.id))}
                      onInsertAfter={() => insertStageAfter(index)}
                    />
                  ))}
                </div>
              ) : (
                <div className="org-pipeline-canvas-empty">
                  <span className="org-modal-kicker">Empty Flow</span>
                  <h3>Start with the first stage</h3>
                  <p>Create a blank pipeline from scratch or pull in a template when you need a faster starting point.</p>
                  <div className="org-pipeline-canvas-empty-actions">
                    <button type="button" className="org-primary-button" onClick={handleAddFirstStage}>
                      <Plus size={14} />
                      Add First Stage
                    </button>
                    <button type="button" className="org-text-button" onClick={() => setGalleryOpen(true)}>
                      <Wand2 size={14} />
                      Use Template
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="org-pipeline-endpoint-lane">
              <div className="org-pipeline-endpoint publish">
                <span>Publish</span>
              </div>
            </div>
          </div>
        </div>

        <aside className="org-panel org-pipeline-stage-editor">
          <div className="org-drawer-header">
            <div>
              <h3>Stage Settings</h3>
              <p>{activeStage ? 'Tune the current step without leaving the canvas.' : 'Select a stage to configure assignment, SLA, and review behavior.'}</p>
            </div>
          </div>

          {activeStage ? (
            <div className="org-form">
              <label>
                <span>Stage name</span>
                <input
                  type="text"
                  value={activeStage.name}
                  onChange={(event) => updateStage(activeStage.id, { name: event.target.value })}
                />
              </label>

              <label>
                <span>Description</span>
                <input
                  type="text"
                  value={activeStage.description || ''}
                  onChange={(event) => updateStage(activeStage.id, { description: event.target.value })}
                />
              </label>

              <label>
                <span>Assignment mode</span>
                <OrgSelect
                  value={activeStage.assignee_type}
                  options={[
                    { value: 'role', label: 'Any member of role', description: 'Assign this stage to any member who holds the selected role.' },
                    { value: 'specific_user', label: 'Specific member', description: 'Pin this stage to one named reviewer.' },
                  ]}
                  onChange={(nextValue) => updateStage(activeStage.id, {
                    assignee_type: nextValue,
                    assignee_user_id: nextValue === 'role' ? null : activeStage.assignee_user_id,
                  })}
                />
              </label>

              {activeStage.assignee_type === 'specific_user' ? (
                <label>
                  <span>Specific member</span>
                  <OrgSelect
                    value={activeStage.assignee_user_id || ''}
                    options={[
                      { value: '', label: 'Select member', description: 'Choose the reviewer for this stage.' },
                      ...memberOptions,
                    ]}
                    onChange={(nextValue) => updateStage(activeStage.id, {
                      assignee_user_id: nextValue || null,
                    })}
                  />
                </label>
              ) : (
                <label>
                  <span>Responsible role</span>
                  <OrgSelect
                    value={activeStage.assignee_role || 'editor'}
                    options={roleOptions}
                    onChange={(nextValue) => updateStage(activeStage.id, {
                      assignee_role: nextValue,
                    })}
                  />
                </label>
              )}

              <label>
                <span>SLA hours</span>
                <input
                  type="number"
                  min="1"
                  value={activeStage.sla_hours ?? ''}
                  onChange={(event) => updateStage(activeStage.id, {
                    sla_hours: event.target.value ? Number(event.target.value) : null,
                  })}
                />
              </label>

              <label>
                <span>Escalation member</span>
                <OrgSelect
                  value={activeStage.escalation_user_id || ''}
                  options={[
                    { value: '', label: 'No escalation', description: 'Leave escalation disabled for this stage.' },
                    ...memberOptions,
                  ]}
                  onChange={(nextValue) => updateStage(activeStage.id, {
                    escalation_user_id: nextValue || null,
                  })}
                />
              </label>

              <div className="org-chip-grid">
                <button
                  type="button"
                  className="org-chip"
                  onClick={() => moveStage(activeStage.id, -1)}
                  disabled={draft.stages.findIndex((stage) => stage.id === activeStage.id) === 0}
                >
                  Move Left
                </button>
                <button
                  type="button"
                  className="org-chip"
                  onClick={() => moveStage(activeStage.id, 1)}
                  disabled={draft.stages.findIndex((stage) => stage.id === activeStage.id) === draft.stages.length - 1}
                >
                  Move Right
                </button>
                <button
                  type="button"
                  className={`org-chip ${activeStage.require_comment_on_rejection ? 'active' : ''}`}
                  onClick={() => updateStage(activeStage.id, {
                    require_comment_on_rejection: !activeStage.require_comment_on_rejection,
                  })}
                >
                  Require rejection comment
                </button>
                <button
                  type="button"
                  className={`org-chip ${activeStage.is_optional ? 'active' : ''}`}
                  onClick={() => updateStage(activeStage.id, {
                    is_optional: !activeStage.is_optional,
                  })}
                >
                  Optional stage
                </button>
                <button
                  type="button"
                  className={`org-chip ${activeStage.generates_client_review_link ? 'active' : ''}`}
                  onClick={() => updateStage(activeStage.id, {
                    generates_client_review_link: !activeStage.generates_client_review_link,
                  })}
                >
                  Generate client link
                </button>
              </div>

              <button
                type="button"
                className="org-text-button danger"
                onClick={() => removeStage(activeStage.id)}
              >
                <Trash2 size={14} />
                Delete Stage
              </button>
            </div>
          ) : (
            <div className="org-empty-inline org-stage-editor-empty">
              <span className="org-modal-kicker">Stage Details</span>
              <h3>No stage selected</h3>
              <p>Choose any stage on the canvas to edit assignment, SLA rules, and review settings.</p>
            </div>
          )}
        </aside>
      </div>

      <TemplateGallery
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onPick={startTemplatedConfig}
      />
    </section>
  );
}
