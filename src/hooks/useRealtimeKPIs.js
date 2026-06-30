import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { GENERATION_STATUS, POST_STATUS } from '../constants/statuses';

const EMPTY_KPIS = {
  totalGenerated: 0,
  scheduledPosts: 0,
  published: 0,
  creditsLeft: 0,
};

export function useRealtimeKPIs(userId) {
  const [kpis, setKpis] = useState(EMPTY_KPIS);
  const [isLoading, setIsLoading] = useState(true);
  const channelRef = useRef(null);

  const fetchKPIs = useCallback(async () => {
    if (!userId) {
      setKpis(EMPTY_KPIS);
      setIsLoading(false);
      return;
    }

    try {
      const fetchCreditsRow = async () => {
        const profileRow = await supabase
          .from('profiles')
          .select('credits')
          .eq('id', userId)
          .maybeSingle();

        return profileRow;
      };

      const [genResult, scheduledResult, publishedResult, creditsResult] = await Promise.all([
        supabase
          .from('generations')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .is('organization_id', null)
          .neq('status', GENERATION_STATUS.FAILED),
        supabase
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .is('organization_id', null)
          .eq('status', POST_STATUS.SCHEDULED),
        supabase
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .is('organization_id', null)
          .eq('status', POST_STATUS.PUBLISHED),
        fetchCreditsRow(),
      ]);

      setKpis({
        totalGenerated: genResult.count ?? 0,
        scheduledPosts: scheduledResult.count ?? 0,
        published: publishedResult.count ?? 0,
        creditsLeft: creditsResult.data?.credits ?? 0,
      });
    } catch (error) {
      console.error('[useRealtimeKPIs] Fetch error:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    fetchKPIs();

    const channel = supabase
      .channel(`kpis-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'generations',
          filter: `user_id=eq.${userId}`,
        },
        fetchKPIs,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'posts',
          filter: `user_id=eq.${userId}`,
        },
        fetchKPIs,
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          const nextCredits = payload?.new?.credits_remaining ?? payload?.new?.credits;
          if (typeof nextCredits === 'number') {
            setKpis((prev) => ({ ...prev, creditsLeft: nextCredits }));
            return;
          }
          fetchKPIs();
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [fetchKPIs, userId]);

  return {
    kpis,
    isLoading,
    refetch: fetchKPIs,
  };
}
