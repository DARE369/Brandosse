"use client";

import React from "react";
import CreditDashboard from "../../components/video-engine/CreditDashboard";
import { useAuth } from "../../Context/AuthContext";
import { fetchUserCredits, fetchUserTransactions } from "../../services/videoEngineData";
import { AppShell, Card, EmptyState, Button, Skeleton } from "../../ui-v2";

export default function CreditsPage() {
  const { user } = useAuth();
  const [balance, setBalance] = React.useState(0);
  const [transactions, setTransactions] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const load = React.useCallback(() => {
    if (!user?.id) return undefined;
    let active = true;
    setLoading(true);
    setError("");

    Promise.all([fetchUserCredits(user.id), fetchUserTransactions(user.id)])
      .then(([credits, creditTransactions]) => {
        if (!active) return;
        setBalance(credits?.balance ?? 0);
        setTransactions(creditTransactions);
      })
      .catch((loadError) => {
        // This used to be `.catch(() => {})`, which rendered a balance of 0 on
        // any failure — visually identical to an account that really has no
        // credits. A user with credits would be told they had none, on the page
        // whose entire job is telling them how many they have. Failing loudly
        // is the only honest option: a wrong number here is worse than no page.
        if (active) setError(loadError?.message || "Could not load your credit balance.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.id]);

  React.useEffect(load, [load]);

  return (
    <AppShell activeKey="billing" mainClassName="ve-app-content">
      {loading ? (
        <Card><Skeleton height="180px" radius="var(--uiv2-radius-md)" /></Card>
      ) : error ? (
        <Card>
          <EmptyState
            title="Couldn't load your credits"
            description={`${error} Your balance is safe — this is a display problem, and nothing has been spent.`}
            actions={<Button onClick={load}>Try again</Button>}
          />
        </Card>
      ) : (
        <CreditDashboard initialBalance={balance} initialTransactions={transactions} />
      )}
    </AppShell>
  );
}
