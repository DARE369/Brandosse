"use client";

import React from "react";
import UserNavbar from "../../components/User/UserNavbar";
import UserSidebar from "../../components/User/UserSidebar";
import CreditDashboard from "../../components/video-engine/CreditDashboard";
import { useAuth } from "../../Context/AuthContext";
import { fetchUserCredits, fetchUserTransactions } from "../../services/videoEngineData";
export default function CreditsPage() {
  const { user } = useAuth();
  const [balance, setBalance] = React.useState(0);
  const [transactions, setTransactions] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!user?.id) return undefined;

    let active = true;
    Promise.all([fetchUserCredits(user.id), fetchUserTransactions(user.id)])
      .then(([credits, creditTransactions]) => {
        if (!active) return;
        setBalance(credits?.balance ?? 0);
        setTransactions(creditTransactions);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.id]);

  return (
    <div className="dashboard-shell">
      <UserNavbar />
      <UserSidebar />
      <main className="dashboard-content ve-app-content" id="main-content">
        {loading ? (
          <div className="ve-page-loading">Loading credits...</div>
        ) : (
          <CreditDashboard initialBalance={balance} initialTransactions={transactions} />
        )}
      </main>
    </div>
  );
}
