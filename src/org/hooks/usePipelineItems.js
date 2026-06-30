import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { fetchPipelineItems } from '../services/pipelineService';
import { useOrgContext } from './useOrgContext';

export function usePipelineItems(options = {}) {
  const { organizationId, brandProjectId } = useOrgContext();
  const { brandProjectIdOverride } = options;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const effectiveBrandProjectId = brandProjectIdOverride === undefined
    ? brandProjectId
    : brandProjectIdOverride;

  const refresh = useCallback(async () => {
    if (!organizationId) {
      setItems([]);
      return;
    }

    const data = await fetchPipelineItems({
      organizationId,
      brandProjectId: effectiveBrandProjectId,
    });
    setItems(data);
  }, [effectiveBrandProjectId, organizationId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!organizationId) {
        setItems([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const data = await fetchPipelineItems({
          organizationId,
          brandProjectId: effectiveBrandProjectId,
        });
        if (!cancelled) {
          setItems(data);
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setItems([]);
          setError(err?.message || 'Failed to load pipeline items');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [effectiveBrandProjectId, organizationId]);

  useEffect(() => {
    if (!organizationId) return undefined;

    const channel = supabase
      .channel(`org-pipeline-${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pipeline_items',
          filter: `organization_id=eq.${organizationId}`,
        },
        async () => {
          await refresh();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, refresh]);

  return {
    items,
    loading,
    error,
    refresh,
  };
}

export default usePipelineItems;
