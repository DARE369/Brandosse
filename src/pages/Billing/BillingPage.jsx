"use client";

// src/pages/Billing/BillingPage.jsx
// ui-v2 Billing page (see docs mockup "Billing.dc.html"), credits-only per
// the 2026-07 scope decision — no fabricated subscription/plan-tier card,
// since the schema has no plan concept. Reuses the exact real data this app
// already has: useCreditBalance/useCreditSpendByCategory hooks, the same
// CREDIT_PACKAGES + purchaseCredits() Stripe checkout Video Engine's
// CreditDashboard already uses, and credit_transactions for the ledger.
// Invoice history intentionally uses Stripe's own customer-portal receipts
// (once wired) rather than a fabricated invoices table — not built yet,
// left as a real gap rather than faked.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Coins, Star, XCircle } from "lucide-react";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useCreditBalance, useCreditSpendByCategory } from "../../hooks/useCreditBalance";
import { CREDIT_PACKAGES } from "../../lib/video-engine/credit-packages";
import { purchaseCredits } from "../../services/videoEngineApi";
import { fetchUserTransactions } from "../../services/videoEngineData";
import {
  UiV2ThemeProvider, useUiV2Theme, AppHeader, CreditPill, IconButton,
  Card, Badge, Skeleton, EmptyState, Button, MobileNavDrawer,
  NotificationBell, AvatarMenu,
} from "../../ui-v2";
import styles from "./BillingPage.module.css";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", href: "/app/dashboard" },
  { key: "studio", label: "Studio", href: "/app/generate" },
  { key: "library", label: "Library", href: "/app/library" },
  { key: "calendar", label: "Calendar", href: "/app/calendar" },
  { key: "analytics", label: "Analytics", href: "/app/analytics" },
  { key: "brand-kit", label: "Brand Kit", href: "/app/settings/brand-kit" },
];

const LOW_BALANCE_THRESHOLD = 10;

const TX_LABELS = {
  purchase: "Purchase",
  consumption: "Used",
  refund: "Refund",
  bonus: "Bonus",
  adjustment: "Adjustment",
};

function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ThemeToggleButton() {
  const { isDark, toggleTheme } = useUiV2Theme();
  return (
    <IconButton title={isDark ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}>
      {isDark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" strokeLinecap="round" />
          <circle cx="12" cy="12" r="4.5" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 14.5A8.5 8.5 0 119.5 4a7 7 0 0010.5 10.5z" />
        </svg>
      )}
    </IconButton>
  );
}

// Single-hue horizontal magnitude bars — category name is the identity
// (direct label), so no categorical palette/legend is needed per the
// dataviz skill's "identity carried by label, not color" allowance for
// small, single-user rankings.
function CategoryBars({ segments }) {
  const max = Math.max(...segments.map((s) => s.value), 1);
  return (
    <div className={styles.catList}>
      {segments.map((s) => (
        <div key={s.key} className={styles.catRow}>
          <span className={styles.catLabel}>{s.label}</span>
          <div className={styles.catBarTrack}>
            <div className={styles.catBarFill} style={{ width: `${Math.max(4, (s.value / max) * 100)}%` }} />
          </div>
          <span className={styles.catValue}>{s.value.toLocaleString()} cr</span>
        </div>
      ))}
    </div>
  );
}

function BillingBody() {
  const { navigate, search } = useAppNavigation();
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;
  const credits = useCreditBalance(userId);
  const { segments, ready: segmentsReady } = useCreditSpendByCategory(userId);

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [txLoading, setTxLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(null);
  const [purchaseError, setPurchaseError] = useState("");

  const checkoutBanner = useMemo(() => {
    const params = new URLSearchParams(search);
    if (params.get("success") === "true") return { tone: "success", message: "Payment successful — your credits have been added." };
    if (params.get("canceled") === "true") return { tone: "warning", message: "Checkout was cancelled — no charge was made." };
    return null;
  }, [search]);

  useEffect(() => {
    if (!userId) { setTxLoading(false); return; }
    fetchUserTransactions(userId)
      .then(setTransactions)
      .catch(() => {})
      .finally(() => setTxLoading(false));
  }, [userId]);

  const handlePurchase = async (pkg) => {
    setPurchaseError("");
    setPurchasing(pkg.id);
    try {
      const result = await purchaseCredits(pkg.id);
      if (result?.checkout_url) window.location.assign(result.checkout_url);
    } catch (err) {
      setPurchaseError(err.message || "Could not start checkout. Please try again.");
      setPurchasing(null);
    }
  };

  const isLow = credits.ready && credits.balance < LOW_BALANCE_THRESHOLD;
  const userInitials = ((profile?.full_name ? profile.full_name[0] : "U") + (profile?.full_name?.split(" ")[1]?.[0] ?? "")).toUpperCase();

  return (
    <>
      <AppHeader
        navItems={NAV_ITEMS}
        activeKey=""
        onNavClick={(item) => navigate(item.href)}
        onBurgerClick={() => setMobileNavOpen(true)}
        right={(
          <>
            {credits.ready ? (
              <CreditPill pct="100%" label={`${credits.balance.toLocaleString()} cr`} />
            ) : (
              <Skeleton width="76px" height="26px" radius="999px" />
            )}
            <ThemeToggleButton />
            <NotificationBell userId={userId} onNavigate={navigate} />
            <AvatarMenu initials={userInitials || "U"} name={profile?.full_name} email={user?.email} onNavigate={navigate} />
          </>
        )}
      />

      <MobileNavDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} navItems={NAV_ITEMS} activeKey="" onNavClick={(item) => navigate(item.href)} />

      <main className={styles.main}>
        <div className={styles.canvas}>
          <div className={styles.headRow}>
            <div>
              <div className={styles.title}>Billing &amp; credits</div>
              <div className={styles.sub}>Credits power generation, video processing, and edits — no subscription, pay for what you use.</div>
            </div>
          </div>

          {checkoutBanner ? (
            <div className={[styles.banner, checkoutBanner.tone === "success" ? styles.bannerSuccess : styles.bannerWarning].join(" ")}>
              {checkoutBanner.tone === "success" ? <CheckCircle2 size={16} aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}
              <span>{checkoutBanner.message}</span>
            </div>
          ) : null}

          {isLow ? (
            <div className={[styles.banner, styles.bannerWarning].join(" ")}>
              <AlertTriangle size={16} aria-hidden="true" />
              <span>Running low — {credits.balance} credits left. Top up below to keep generating without interruption.</span>
            </div>
          ) : null}

          {purchaseError ? (
            <div className={[styles.banner, styles.bannerDanger].join(" ")}>
              <XCircle size={16} aria-hidden="true" />
              <span>{purchaseError}</span>
            </div>
          ) : null}

          <Card>
            <div className={styles.balanceRow}>
              <div className={styles.balanceIcon}><Coins size={20} aria-hidden="true" /></div>
              <div>
                <div className={styles.balanceLabel}>Available balance</div>
                <div className={styles.balanceValue}>{credits.ready ? credits.balance.toLocaleString() : "…"} <span className={styles.balanceUnit}>credits</span></div>
              </div>
            </div>
          </Card>

          <Card>
            <div className={styles.sectionLabel}>Where credits went</div>
            <div className={styles.sectionSub}>Lifetime spend by category, from real usage — not an estimate.</div>
            {!segmentsReady ? (
              <Skeleton height="80px" radius="var(--uiv2-radius-md)" />
            ) : segments.length === 0 ? (
              <EmptyState dashed title="No usage yet" description="Generate or process something and it'll show up here." />
            ) : (
              <CategoryBars segments={segments} />
            )}
          </Card>

          <Card>
            <div className={styles.sectionLabel}>Buy credits</div>
            <div className={styles.sectionSub}>1 credit ≈ 1 image generation or 1 minute of video processing.</div>
            <div className={styles.packageGrid}>
              {CREDIT_PACKAGES.map((pkg) => (
                <div key={pkg.id} className={[styles.packageCard, pkg.popular ? styles.packageCardPopular : ""].join(" ")}>
                  {pkg.popular ? <Badge tone="accent" dot>Most popular</Badge> : null}
                  <div className={styles.packageName}>{pkg.name}</div>
                  <div className={styles.packagePrice}>{pkg.price_display}</div>
                  <div className={styles.packageCredits}>{pkg.credits} credits</div>
                  <div className={styles.packageDesc}>{pkg.description}</div>
                  <Button
                    onClick={() => handlePurchase(pkg)}
                    disabled={purchasing === pkg.id}
                    variant={pkg.popular ? "solid" : "subtle"}
                  >
                    {purchasing === pkg.id ? "Redirecting…" : "Purchase"}
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className={styles.sectionLabel}>Credit activity</div>
            {txLoading ? (
              <Skeleton height="120px" radius="var(--uiv2-radius-md)" />
            ) : transactions.length === 0 ? (
              <EmptyState dashed title="No activity yet" description="Purchases and usage will appear here." />
            ) : (
              <div className={styles.ledgerTable}>
                <div className={[styles.ledgerRow, styles.ledgerHeadRow].join(" ")}>
                  <div>Date</div><div>Type</div><div>Description</div><div>Amount</div><div>Balance</div>
                </div>
                {transactions.map((tx) => {
                  const positive = tx.amount > 0;
                  return (
                    <div key={tx.id} className={styles.ledgerRow}>
                      <div>{formatDate(tx.created_at)}</div>
                      <div><Badge tone={tx.transaction_type === "purchase" ? "success" : tx.transaction_type === "refund" ? "info" : "neutral"}>{TX_LABELS[tx.transaction_type] || tx.transaction_type}</Badge></div>
                      <div className={styles.ledgerDesc}>{tx.description || "—"}</div>
                      <div className={positive ? styles.amountPositive : styles.amountNegative}>{positive ? "+" : ""}{tx.amount}</div>
                      <div>{tx.balance_after}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </main>
    </>
  );
}

export default function BillingPage() {
  return (
    <UiV2ThemeProvider className={styles.shell}>
      <BillingBody />
    </UiV2ThemeProvider>
  );
}
