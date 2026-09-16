"use client";

// AssetCopyReview — the Library drawer's copy review. Reviewed on request, and
// SAVED: reopening the drawer shows the last review rather than a blank.
//
//   1. The asset's own words — its title and tags — reviewed for one destination
//      a connected account can actually send this file to. Saved on the asset
//      (personal_assets.metadata.copy_review), per destination.
//   2. Posts already made from it. A published post shows its FROZEN report.
//      An unpublished post's caption review is saved as that post's snapshot,
//      so if it publishes unchanged, the review at publish reuses it.
//
// A saved review describes the exact words it read. When those words have
// changed since, it is still shown — it is what was measured — but marked out
// of date, and the review button pulses, the same signal the composer uses.
//
// "Copy review", not "discovery" — LOCK L5.11. Nothing here predicts reach.
import { useEffect, useState } from "react";
import { Button } from "../../../ui-v2";
// Owns the stylesheet for the stale pulse it uses (.quickpost-copy-review__btn)
// rather than relying on the Library page happening to load the composer —
// that assumption is exactly how the composer rendered unstyled.
import "../../../calendar/calendar-engine-v2.css";
import { scorePostSeo } from "../../../services/postProduction.service";
import { SCORE_STATE, bandFor, scoreDestinations } from "../../../calendar/discoveryScore";
import {
  finalReportState,
  fingerprintCopyInputs,
  measuredMetrics,
  readCopyReview,
} from "../../../calendar/copyReview";
import {
  assetCopyInputs,
  postCopyInputs,
  readAssetCopyReview,
  saveAssetCopyReview,
  savePostCopyReview,
} from "../../../services/copyReviewPersistence";
import CopyReviewReport from "../../../calendar/components/CopyReviewReport";

const muted = { fontSize: 12, color: "var(--uiv2-text-secondary)", margin: 0 };

function formatWhen(iso) {
  const d = new Date(iso || "");
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** A stored result ({overall, breakdown, measured, suggestions}) in full. */
function StoredResult({ result, scoredAt, stale }) {
  if (!result) return null;
  const metrics = measuredMetrics(result);
  const when = formatWhen(scoredAt);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }} role="status">
      <span style={{ fontSize: 13, color: "var(--uiv2-text-primary)" }}>
        Copy review <strong>{result.overall ?? "—"}</strong> · {bandFor(result.overall).label}
      </span>
      {metrics.map((m) => (
        <div key={m.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--uiv2-text-secondary)" }}>
          <span>{m.label}</span>
          <span style={{ fontFamily: "var(--uiv2-font-mono)" }}>{m.measured ? m.value : "Not measured"}</span>
        </div>
      ))}
      {!metrics.some((m) => m.coverageKnown) ? (
        <p style={{ ...muted, fontSize: 11 }}>A 0 here may mean the metric was not returned.</p>
      ) : null}
      {result.suggestions?.[0] ? <p style={muted}>{result.suggestions[0]}</p> : null}
      <p style={{ ...muted, fontSize: 11, color: stale ? "var(--uiv2-warning)" : "var(--uiv2-text-tertiary)" }}>
        {stale ? "Out of date — the words have changed since this review. " : ""}
        {when ? `Saved ${when}.` : "Saved."}
      </p>
    </div>
  );
}

function ReviewButton({ onClick, busy, stale, hasReview, label }) {
  return (
    <Button
      size="sm"
      variant="subtle"
      onClick={onClick}
      disabled={busy}
      // Same stale signal as the composer; its reduced-motion fallback lives in
      // calendar-engine-v2.css, which the composer imports.
      className={`quickpost-copy-review__btn${stale && !busy ? " is-stale" : ""}`}
    >
      {busy ? "Reviewing…" : hasReview ? "Review again" : label}
    </Button>
  );
}

export default function AssetCopyReview({ asset, usedInPosts = [], reviewPlatforms = [], onAssetUpdated }) {
  const [platform, setPlatform] = useState(reviewPlatforms[0]?.key || "");
  const [busy, setBusy] = useState(false);
  const [assetMessage, setAssetMessage] = useState(null);
  const [assetStale, setAssetStale] = useState(false);
  // Posts as last read or written, so a saved snapshot shows without a refetch.
  const [posts, setPosts] = useState(usedInPosts);
  const [postBusy, setPostBusy] = useState({});
  const [postMessage, setPostMessage] = useState({});
  const [postStale, setPostStale] = useState({});

  useEffect(() => { setPosts(usedInPosts); }, [usedInPosts]);

  const chosen = reviewPlatforms.find((p) => p.key === platform) ? platform : (reviewPlatforms[0]?.key || "");
  const title = String(asset?.title || "").trim();
  const saved = chosen ? readAssetCopyReview(asset, chosen) : null;

  // Is the saved asset review still about these words?
  useEffect(() => {
    let cancelled = false;
    if (!saved || !chosen) { setAssetStale(false); return undefined; }
    fingerprintCopyInputs(assetCopyInputs(asset, chosen)).then((fp) => {
      if (!cancelled) setAssetStale(fp !== saved.fingerprint);
    });
    return () => { cancelled = true; };
  }, [asset, chosen, saved?.fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps

  // Is each unpublished post's saved snapshot still about its caption?
  useEffect(() => {
    let cancelled = false;
    Promise.all(posts.map(async (post) => {
      const { snapshot } = readCopyReview(post);
      if (!snapshot) return [post.id, false];
      return [post.id, (await fingerprintCopyInputs(postCopyInputs(post))) !== snapshot.fingerprint];
    })).then((pairs) => { if (!cancelled) setPostStale(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [posts]);

  async function reviewAsset() {
    if (!title || !chosen) return;
    setBusy(true);
    setAssetMessage(null);
    const inputs = assetCopyInputs(asset, chosen);
    const out = await scoreDestinations(scorePostSeo, [{ ...inputs, mediaType: asset?.media_type || null }]);
    const scored = out[chosen];
    if (scored?.state !== SCORE_STATE.SCORED) {
      setAssetMessage(`Not reviewed — ${scored?.reason || "the reviewer did not answer."}`);
      setBusy(false);
      return;
    }
    try {
      const result = await saveAssetCopyReview(asset.id, chosen, scored, inputs);
      if (result.saved) onAssetUpdated?.(result.asset);
      else setAssetMessage(result.reason);
    } catch (err) {
      // Reviewed but not kept is a different outcome from not reviewed — said.
      setAssetMessage(`Reviewed, but it could not be saved: ${err?.message || "unknown error"}.`);
    } finally {
      setBusy(false);
    }
  }

  async function reviewPost(post) {
    const inputs = postCopyInputs(post);
    if (!String(inputs.caption).trim()) return;
    setPostBusy((prev) => ({ ...prev, [post.id]: true }));
    setPostMessage((prev) => ({ ...prev, [post.id]: null }));
    // postId also lets seo-score record the result on the post's seo_state,
    // as the Calendar drawer's Re-score does.
    const scorer = (args) => scorePostSeo({ ...args, postId: post.id });
    const out = await scoreDestinations(scorer, [{ ...inputs, mediaType: asset?.media_type || null }]);
    const scored = out[post.platform];
    if (scored?.state !== SCORE_STATE.SCORED) {
      setPostMessage((prev) => ({ ...prev, [post.id]: `Not reviewed — ${scored?.reason || "the reviewer did not answer."}` }));
      setPostBusy((prev) => ({ ...prev, [post.id]: false }));
      return;
    }
    try {
      const result = await savePostCopyReview(post.id, scored, inputs);
      if (result.saved) {
        setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, ...result.post } : p)));
      } else {
        setPostMessage((prev) => ({ ...prev, [post.id]: result.reason }));
      }
    } catch (err) {
      setPostMessage((prev) => ({ ...prev, [post.id]: `Reviewed, but it could not be saved: ${err?.message || "unknown error"}.` }));
    } finally {
      setPostBusy((prev) => ({ ...prev, [post.id]: false }));
    }
  }

  const box = {
    display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 10,
    border: "1px solid var(--uiv2-border)", background: "var(--uiv2-bg-inset)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ── The asset's own title and tags ─────────────────────────────── */}
      <div style={box} data-asset-copy-review>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--uiv2-text-primary)" }}>Title and tags</span>
        {!title ? (
          <p style={muted}>This asset has no title to review. Add one in Details above.</p>
        ) : reviewPlatforms.length === 0 ? (
          <p style={muted}>None of your connected accounts can post this file, so there is no destination to review it for.</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                className="ui-select"
                aria-label="Review for which destination"
                value={chosen}
                onChange={(e) => { setPlatform(e.target.value); setAssetMessage(null); }}
              >
                {reviewPlatforms.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <ReviewButton onClick={reviewAsset} busy={busy} stale={assetStale} hasReview={Boolean(saved)} label="Review" />
            </div>
            {saved ? <StoredResult result={saved.result} scoredAt={saved.scored_at} stale={assetStale} /> : (
              <p style={muted}>Not reviewed for this destination yet. Reviews are saved with the asset.</p>
            )}
            {assetMessage ? <p style={{ ...muted, color: "var(--uiv2-danger)" }} role="alert">{assetMessage}</p> : null}
          </>
        )}
      </div>

      {/* ── Posts already made from it ─────────────────────────────────── */}
      {posts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--uiv2-text-primary)" }}>Posts made from it</span>
          {posts.map((post) => {
            const label = `${post.platform || "Post"} · ${post.status}`;
            if (finalReportState(post) !== "not_applicable") {
              return (
                <div key={post.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ ...muted, textTransform: "capitalize" }}>{label}</span>
                  <CopyReviewReport post={post} compact />
                </div>
              );
            }
            const { snapshot } = readCopyReview(post);
            const stale = Boolean(postStale[post.id]);
            return (
              <div key={post.id} style={box}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ ...muted, textTransform: "capitalize" }}>{label}</span>
                  <ReviewButton
                    onClick={() => reviewPost(post)}
                    busy={Boolean(postBusy[post.id])}
                    stale={stale}
                    hasReview={Boolean(snapshot)}
                    label="Review caption"
                  />
                </div>
                <p style={{ ...muted, color: "var(--uiv2-text-primary)" }}>
                  {String(post.caption || "").trim()
                    ? `${String(post.caption).slice(0, 140)}${String(post.caption).length > 140 ? "…" : ""}`
                    : "No caption yet."}
                </p>
                {snapshot ? <StoredResult result={snapshot.result} scoredAt={snapshot.scored_at} stale={stale} /> : null}
                {snapshot && !stale ? (
                  <p style={{ ...muted, fontSize: 11 }}>If it publishes with this caption, this review is kept as its review at publish.</p>
                ) : null}
                {postMessage[post.id] ? <p style={{ ...muted, color: "var(--uiv2-danger)" }} role="alert">{postMessage[post.id]}</p> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
