import { getMagnificModelLabel } from '../../../config/magnificModels';

/* ─────────────────────────────────────────────────────────────────────────────
   Pure helpers — extracted verbatim from BrandosseGenerateStudio.jsx
   ───────────────────────────────────────────────────────────────────────────── */
export function normalizePlatform(p) {
  const k = String(p || '').trim().toLowerCase();
  return k === 'twitter' ? 'x' : k || 'instagram';
}

export function getMediaUrl(gen) {
  return gen?.storage_path || gen?.public_url || gen?.url || '';
}

export function formatBytes(v) {
  const b = Number(v || 0);
  if (!b) return '—';
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function getGenerationTitle(gen) {
  const p = String(gen?.prompt || '').trim();
  if (!p) return 'Untitled';
  const words = p.split(/\s+/).slice(0, 7).join(' ');
  return p.split(/\s+/).length > 7 ? `${words}…` : words;
}

export function getAssetMetadata(gen) {
  const m = gen?.metadata && typeof gen.metadata === 'object' ? gen.metadata : {};
  return {
    provider:        m.provider || 'magnific',
    providerTaskId:  m.provider_task_id || m.providerTaskId || m.taskId || '—',
    providerModel:   getMagnificModelLabel(m.provider_model || m.providerModel || m.model || null),
    generationTimeMs: m.generation_time_ms || m.generationTimeMs || null,
    width:   m.width || gen?.width || null,
    height:  m.height || gen?.height || null,
    fileSize: m.file_size || m.fileSize || gen?.file_size || null,
    format:  m.format || (gen?.media_type === 'video' ? 'MP4' : 'Image'),
    cost:    m.generation_cost || m.cost || null,
    status:  gen?.status || 'processing',
  };
}

export function scoreGrade(score) {
  if (score >= 80) return 'Great';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Needs work';
}

export function scoreColorClass(score) {
  if (score >= 70) return 'success';
  if (score >= 45) return 'warning';
  return 'danger';
}

export function isSeoLocked(pp) {
  return pp.metadataStatus === 'in_progress'
    || ['metadata_generating', 'optimizing', 'scoring'].includes(pp.seoStatus);
}

export function normalizeCredits(credits, profile) {
  const raw = Number(credits?.balance ?? profile?.credits ?? 0);
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
}
