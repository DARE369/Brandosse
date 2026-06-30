import { useCallback, useEffect, useState } from 'react';
import { fetchCreditRequests } from '../services/creditService';
import { useOrgContext } from './useOrgContext';

export function useOrgCredits() {
  const { organization, membership, organizationId } = useOrgContext();
  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(true);

  const refreshRequests = useCallback(async () => {
    if (!organizationId) {
      setRequests([]);
      setLoadingRequests(false);
      return;
    }

    setLoadingRequests(true);
    const nextRequests = await fetchCreditRequests(organizationId);
    setRequests(nextRequests);
    setLoadingRequests(false);
  }, [organizationId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!organizationId) {
        if (!cancelled) {
          setRequests([]);
          setLoadingRequests(false);
        }
        return;
      }

      setLoadingRequests(true);
      const nextRequests = await fetchCreditRequests(organizationId);
      if (!cancelled) {
        setRequests(nextRequests);
        setLoadingRequests(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  return {
    organizationCreditsUsed: Number(organization?.creditsUsedThisPeriod || 0),
    organizationCreditPool: Number(organization?.monthlyCreditPool || 0),
    memberCreditsUsed: Number(membership?.creditsUsedThisPeriod || 0),
    requests,
    loadingRequests,
    refreshRequests,
  };
}

export default useOrgCredits;
