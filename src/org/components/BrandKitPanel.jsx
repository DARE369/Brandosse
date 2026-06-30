import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useOrgContext } from '../hooks/useOrgContext';
import { fetchOrgBrandKit } from '../services/brandKitService';
function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getTone(score) {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

export default function BrandKitPanel() {
  const { organizationId, activeBrandProject } = useOrgContext();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [brandKit, setBrandKit] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!organizationId || !activeBrandProject?.id) {
        setBrandKit(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const result = await fetchOrgBrandKit({
          organizationId,
          brandProjectId: activeBrandProject.id,
        });

        if (!cancelled) {
          setBrandKit(result.brandKit || null);
        }
      } catch (_error) {
        if (!cancelled) {
          setBrandKit(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeBrandProject?.id, organizationId]);

  const toneDescriptors = useMemo(
    () => safeArray(brandKit?.tone_descriptors).slice(0, 3),
    [brandKit?.tone_descriptors],
  );

  const contentPillars = useMemo(
    () => safeArray(brandKit?.content_pillars),
    [brandKit?.content_pillars],
  );

  if (loading || !activeBrandProject?.id) {
    return null;
  }

  const score = Number(brandKit?.completeness_score || 0);
  const tone = getTone(score);

  return (
    <div className={`org-brand-kit-panel ${expanded ? 'expanded' : ''}`}>
      <button type="button" className="org-brand-kit-panel-strip" onClick={() => setExpanded((current) => !current)}>
        <div className="org-brand-kit-panel-main">
          <span className={`org-brand-kit-panel-dot tone-${tone}`} />
          <strong>{brandKit?.brand_name || activeBrandProject?.name || 'Brand kit'}</strong>
          <div className="org-brand-kit-pill-group compact">
            {toneDescriptors.map((entry) => (
              <span key={entry} className="org-brand-kit-pill tone">{entry}</span>
            ))}
          </div>
        </div>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {expanded ? (
        <div className="org-brand-kit-panel-body">
          <p>{brandKit?.voice_description || 'No voice description configured yet.'}</p>

          <div className="org-brand-kit-pill-group">
            {toneDescriptors.length > 0 ? toneDescriptors.map((entry) => (
              <span key={entry} className="org-brand-kit-pill tone">{entry}</span>
            )) : <span className="org-brand-kit-muted">No tone descriptors yet.</span>}
          </div>

          <div className="org-brand-kit-pill-group">
            {contentPillars.length > 0 ? contentPillars.map((entry) => (
              <span key={entry} className="org-brand-kit-pill pillar">{entry}</span>
            )) : <span className="org-brand-kit-muted">No content pillars yet.</span>}
          </div>

          <div className="org-brand-kit-code-block">
            {brandKit?.prompt_prefix || 'No prompt prefix configured yet.'}
          </div>

          <span className="org-brand-kit-panel-note">This brand kit guides your AI generations.</span>
        </div>
      ) : null}
    </div>
  );
}
