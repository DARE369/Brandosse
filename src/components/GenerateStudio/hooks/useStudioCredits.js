import { useEffect, useState } from 'react';
import { supabase } from '../../../services/supabaseClient';
import { normalizeCredits } from '../shared/helpers';

/* ─────────────────────────────────────────────────────────────────────────────
   useStudioCredits — fetches & tracks the user's credit balance.
   Behavior-identical to the original inline effect in BrandosseGenerateStudio.
   `profile` is passed in so the dependency (profile?.credits) and the fallback
   normalizeCredits(null, profile) match the original exactly.
   ───────────────────────────────────────────────────────────────────────────── */
export default function useStudioCredits(profile) {
  const [credits, setCredits] = useState({ balance: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (!authData?.user?.id) return;
        const { data } = await supabase
          .from('user_credits')
          .select('balance, lifetime_purchased, lifetime_consumed, updated_at')
          .eq('user_id', authData.user.id)
          .maybeSingle();
        if (alive) {
          const bal = Number.isFinite(Number(data?.balance)) ? Number(data.balance) : 0;
          setCredits({ balance: bal, ...data });
        }
      } catch {
        if (alive) setCredits({ balance: normalizeCredits(null, profile) });
      }
    })();
    return () => { alive = false; };
  }, [profile?.credits]);

  return { credits };
}
