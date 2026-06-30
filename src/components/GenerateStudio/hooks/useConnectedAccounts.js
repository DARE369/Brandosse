import { useEffect, useState } from 'react';
import { supabase } from '../../../services/supabaseClient';

/* ─────────────────────────────────────────────────────────────────────────────
   useConnectedAccounts — fetches the user's connected accounts.
   Behavior-identical to the original inline effect in BrandosseGenerateStudio.
   ───────────────────────────────────────────────────────────────────────────── */
export default function useConnectedAccounts() {
  const [accounts, setAccounts]               = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setAccountsLoading(true);
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (!authData?.user?.id) return;
        const { data } = await supabase
          .from('connected_accounts')
          .select('id, user_id, organization_id, scope, platform, account_name, display_name, username, avatar_url, profile_picture_url, connection_status, is_mock')
          .eq('user_id', authData.user.id)
          .in('connection_status', ['active', 'mock', 'expired'])
          .order('platform');
        if (alive) setAccounts(data || []);
      } catch { /* silent */ } finally {
        if (alive) setAccountsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return { accounts, accountsLoading };
}
