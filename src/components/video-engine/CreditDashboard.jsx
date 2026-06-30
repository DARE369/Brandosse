import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Coins, Loader2, X } from "lucide-react";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { CREDIT_PACKAGES } from "../../lib/video-engine/credit-packages";
import { fetchCreditBalance, purchaseCredits } from "../../services/videoEngineApi";
import CreditPackageCard from "./CreditPackageCard";
const transactionLabels = {
  purchase: "Purchase",
  consumption: "Used",
  refund: "Refund",
  bonus: "Bonus",
  adjustment: "Adjustment",
};

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function CreditDashboard({ initialBalance = 0, initialTransactions = [] }) {
  const { search } = useAppNavigation();
  const [balance, setBalance] = useState(initialBalance);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [purchasing, setPurchasing] = useState(null);
  const [error, setError] = useState("");

  const banner = useMemo(() => {
    const params = new URLSearchParams(search);
    if (params.get("success") === "true") {
      return {
        tone: "success",
        icon: CheckCircle2,
        message: "Payment successful! Your credits have been added.",
      };
    }
    if (params.get("canceled") === "true") {
      return {
        tone: "warning",
        icon: AlertCircle,
        message: "Payment was cancelled.",
      };
    }
    return null;
  }, [search]);

  useEffect(() => {
    if (!banner || banner.tone !== "success") return;

    fetchCreditBalance()
      .then((data) => {
        setBalance(data.balance ?? 0);
        setTransactions(data.transactions ?? []);
      })
      .catch(() => {});
  }, [banner]);

  async function handlePurchase(creditPackage) {
    setError("");
    setPurchasing(creditPackage.id);

    try {
      const result = await purchaseCredits(creditPackage.id);
      if (typeof window !== "undefined") {
        window.location.assign(result.checkout_url);
      }
    } catch (purchaseError) {
      setError(purchaseError.message || "Could not start checkout. Please try again.");
      setPurchasing(null);
    }
  }

  const BannerIcon = banner?.icon;

  return (
    <section className="ve-page ve-credits-page" aria-labelledby="ve-credits-title">
      <div className="ve-page-header">
        <div className="ve-icon-shell">
          <Coins size={22} aria-hidden="true" />
        </div>
        <div>
          <p className="ve-kicker">Billing</p>
          <h1 id="ve-credits-title">Credits</h1>
          <p>Buy processing minutes and review your recent credit activity.</p>
        </div>
      </div>

      {banner ? (
        <div className={`ve-inline-status ve-inline-${banner.tone}`} role="status">
          <BannerIcon size={17} aria-hidden="true" />
          <span>{banner.message}</span>
        </div>
      ) : null}

      {error ? (
        <div className="ve-inline-status ve-inline-danger" role="alert">
          <X size={17} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="ve-balance-card">
        <span>Available balance</span>
        <strong>{balance}</strong>
        <p>credits</p>
      </div>

      <div className="ve-package-grid">
        {CREDIT_PACKAGES.map((creditPackage) => (
          <CreditPackageCard
            key={creditPackage.id}
            creditPackage={creditPackage}
            purchasing={purchasing}
            onPurchase={handlePurchase}
          />
        ))}
      </div>

      <div className="ve-transactions">
        <h2>Transaction history</h2>
        {transactions.length === 0 ? (
          <div className="ve-empty-state">
            <Loader2 size={22} aria-hidden="true" />
            <strong>No transactions yet</strong>
            <span>Purchases and usage will appear here.</span>
          </div>
        ) : (
          <div className="ve-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => {
                  const positive = transaction.amount > 0;
                  return (
                    <tr key={transaction.id}>
                      <td>{formatDate(transaction.created_at)}</td>
                      <td>
                        <span className={`ve-tx-badge ve-tx-${transaction.transaction_type}`}>
                          {transactionLabels[transaction.transaction_type] || transaction.transaction_type}
                        </span>
                      </td>
                      <td>{transaction.description || "-"}</td>
                      <td className={positive ? "ve-tx-positive" : "ve-tx-negative"}>
                        {positive ? "+" : ""}
                        {transaction.amount}
                      </td>
                      <td>{transaction.balance_after}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
