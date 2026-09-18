/**
 * PlatformPerformance.jsx — real numbers from the platforms, or the reason
 * there are none.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 * Everything else on this page counts what BRANDOSSE did: posts created,
 * scheduled, published, failed. This section reports what the PLATFORM did with
 * them — views, watch time, subscribers — read from the social_* fact tables
 * that `ingest-social-analytics` fills.
 *
 * ── The design decision that matters ────────────────────────────────────────
 * A dashboard's hardest state is not "lots of data", it is "none". Zero has at
 * least four causes here, and three of them are not the user's fault:
 *
 *   never collected        the collector has not run for this account yet
 *   collection failing     it ran and errored; stale numbers would be a lie
 *   video not public       YouTube reports nothing for a private video, ever
 *   nothing happened       collected fine, genuinely no activity
 *
 * Rendering "0 views" for all four is a fabrication: three of them mean "we do
 * not know", and one means "we know, and it is zero". So this component never
 * prints a metric it does not have — it prints the reason instead, in words a
 * person can act on.
 *
 * Accounts on platforms the collector does not yet support are named in one
 * line at the bottom rather than given a card each. An empty card per platform
 * would read as breakage, when the truth is simply "not built yet".
 */

import { AlertTriangle, CheckCircle2, Clock, EyeOff } from "lucide-react";
import { Card, EmptyState } from "../../ui-v2";
import { describeEmptiness, formatMetricValue } from "../../services/socialAnalyticsService";
import styles from "./PersonalAnalyticsPage.module.css";

const PLATFORM_LABELS = {
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  pinterest: "Pinterest",
  x: "X",
};

function platformLabel(platform) {
  if (!platform) return "Unknown platform";
  return PLATFORM_LABELS[platform] || platform.charAt(0).toUpperCase() + platform.slice(1);
}

/** "2h ago" / "just now" — relative, because the absolute time is noise here. */
function relativeTime(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * The collection status, stated rather than implied. A number with no
 * provenance is a number nobody can act on: "12 views" means something
 * different if it was last checked an hour ago or last week.
 */
function FreshnessChip({ freshness, freshnessKnown = true }) {
  // "We could not read the collection status" is its own state. Rendering it as
  // "Not collected yet" would be a guess presented as a fact — and on
  // 2026-09-18 that guess was wrong: collection had run four times.
  if (!freshnessKnown) {
    return (
      <span className={styles.perfChip}>
        <AlertTriangle size={12} aria-hidden="true" /> Collection status unavailable
      </span>
    );
  }

  if (!freshness || !freshness.last_attempt_at) {
    return (
      <span className={styles.perfChip}>
        <Clock size={12} aria-hidden="true" /> Not collected yet
      </span>
    );
  }

  if (freshness.last_status && freshness.last_status !== "succeeded") {
    return (
      <span className={[styles.perfChip, styles.perfChipDanger].join(" ")}>
        <AlertTriangle size={12} aria-hidden="true" />
        {freshness.last_error_code
          ? `Last check failed (${freshness.last_error_code})`
          : "Last check failed"}
      </span>
    );
  }

  return (
    <span className={[styles.perfChip, styles.perfChipOk].join(" ")}>
      <CheckCircle2 size={12} aria-hidden="true" />
      Checked {relativeTime(freshness.last_success_at || freshness.last_attempt_at)}
    </span>
  );
}

function MetricTile({ metric }) {
  return (
    <div className={styles.metricTile}>
      <span className={styles.metricLabel}>{metric.label}</span>
      <span className={styles.metricValue}>{formatMetricValue(metric)}</span>
      {/* Non-additive metrics are a single day's figure, not a total for the
          window. Saying which day is the difference between a number and a
          claim. */}
      {!metric.additive && metric.asOf ? (
        <span className={styles.metricNote}>on {metric.asOf}</span>
      ) : null}
    </div>
  );
}

function PostPerformance({ post, freshness }) {
  const empty = describeEmptiness({
    freshness,
    hasRows: post.metrics.length > 0,
    privacyStatus: post.privacyStatus,
  });

  return (
    <div className={styles.perfPostRow}>
      <div className={styles.perfPostMain}>
        <span className={styles.perfPostTitle} title={post.title}>
          {post.title}
        </span>
        <span className={styles.perfPostMeta}>
          {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : "—"}
          {post.privacyStatus && post.privacyStatus !== "public" ? (
            <>
              {" · "}
              <EyeOff size={11} aria-hidden="true" /> {post.privacyStatus}
            </>
          ) : null}
        </span>
      </div>

      {empty ? (
        <span className={styles.perfPostEmpty}>{empty.message}</span>
      ) : (
        <div className={styles.perfPostMetrics}>
          {post.metrics.map((metric) => (
            <span key={metric.metricKey} className={styles.perfPostMetric}>
              <strong>{formatMetricValue(metric)}</strong> {metric.label.toLowerCase()}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountPerformance({ account, displayName, freshnessKnown = true }) {
  const channelEmpty = !freshnessKnown && account.metrics.length === 0
    ? {
        reason: "status_unknown",
        message:
          "No figures for this account, and the collection status could not be read, "
          + "so we cannot tell you whether that means nothing happened or nothing ran.",
      }
    : describeEmptiness({
        freshness: account.freshness,
        hasRows: account.metrics.length > 0,
      });

  return (
    <Card>
      <div className={styles.panelHead}>
        <span className={styles.sectionLabel}>
          {platformLabel(account.platform)}
          {displayName ? <span className={styles.perfAccountName}> · {displayName}</span> : null}
        </span>
        <FreshnessChip freshness={account.freshness} freshnessKnown={freshnessKnown} />
      </div>

      {channelEmpty ? (
        <p className={styles.perfReason}>{channelEmpty.message}</p>
      ) : (
        <div className={styles.metricRow}>
          {account.metrics.map((metric) => (
            <MetricTile key={metric.metricKey} metric={metric} />
          ))}
        </div>
      )}

      {account.posts.length > 0 ? (
        <div className={styles.perfPostList}>
          <span className={styles.rangeLabel}>Per post</span>
          {account.posts.map((post) => (
            <PostPerformance key={post.platformPostId} post={post} freshness={account.freshness} />
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export default function PlatformPerformance({ performance, accounts }) {
  // Driven by the user's CONNECTED ACCOUNTS, not by whatever rows the analytics
  // queries happened to return.
  //
  // It was the other way round until 2026-09-18, and the failure mode was
  // instructive: the freshness view 403'd, the fetch returned nothing, and the
  // section told a user with a live YouTube channel to "connect a social
  // account". Deriving the list from what the user HAS means a query failure
  // can cost detail, never the account itself.
  const connected = (accounts || []).filter((a) => !a.is_mock);
  const perfById = new Map((performance?.accounts || []).map((a) => [a.accountId, a]));

  // false means the check could not run at all, which is not the same as "not
  // collected yet" and must not be reported as it.
  const freshnessKnown = performance ? performance.freshnessAvailable !== false : false;

  if (connected.length === 0) {
    return (
      <Card>
        <div className={styles.panelHead}>
          <span className={styles.sectionLabel}>Platform performance</span>
        </div>
        <EmptyState
          dashed
          title="No platform figures yet"
          description={
            "Connect a social account and publish something; the collector reads each "
            + "platform's own figures every six hours."
          }
        />
      </Card>
    );
  }

  return (
    <>
      {connected.map((account) => {
        const perf = perfById.get(account.id) || null;
        return (
          <AccountPerformance
            key={account.id}
            account={{
              accountId: account.id,
              platform: account.platform,
              freshness: perf?.freshness || null,
              metrics: perf?.metrics || [],
              posts: perf?.posts || [],
            }}
            displayName={account.display_name || account.account_name || account.username}
            freshnessKnown={freshnessKnown}
          />
        );
      })}
    </>
  );
}
