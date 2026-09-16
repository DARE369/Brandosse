"use client";

// AssetCopyReview — the Library drawer's copy review.
//
// Two things, both reviewed ON REQUEST (each is a paid model call behind a rate
// limit, and opening a drawer to glance at an asset should cost nothing):
//
//   1. The asset's own words — its title and its tags — reviewed for one
//      destination the user picks. An asset has no caption; its title and tags
//      are what a post made from it starts with.
//   2. The captions of posts already made from it. A published post shows its
//      FROZEN report (no call — it was recorded when it published). A post that
//      has not published yet can be reviewed against the exact text it carries.
//
// "Copy review", not "discovery" — LOCK L5.11. Nothing here predicts reach.
//
// Only destinations that can actually receive this file are offered. Scoring
// "for Instagram" an asset no connected account can send to Instagram would be
// advice about a post that cannot exist — and the service's silent fallback to
// "instagram" when no platform is passed is exactly that, so a platform is
// always passed explicitly here.
import { useState } from "react";
import { Button } from "../../../ui-v2";
import { scorePostSeo } from "../../../services/postProduction.service";
import { SCORE_STATE, bandFor, scoreDestinations } from "../../../calendar/discoveryScore";
import { finalReportState, measuredMetrics } from "../../../calendar/copyReview";
import CopyReviewReport from "../../../calendar/components/CopyReviewReport";

const muted = { fontSize: 12, color: "var(--uiv2-text-secondary)", margin: 0 };

function ScoreSummary({ scored }) {
  if (!scored) return null;
  if (scored.state === SCORE_STATE.SCORING) return <p style={muted} role="status">Reviewing…</p>;
  if (scored.state === SCORE_STATE.UNAVAILABLE) {
    return <p style={muted} role="status">Not reviewed — {scored.reason}</p>;
  }
  if (scored.state !== SCORE_STATE.SCORED) return null;

  const metrics = measuredMetrics({ breakdown: scored.breakdown, measured: scored.measured });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }} role="status">
      <span style={{ fontSize: 13, color: "var(--uiv2-text-primary)" }}>
        Copy review <strong>{scored.score}</strong> · {bandFor(scored.score).label}
      </span>
      {metrics.map((m) => (
        <div key={m.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--uiv2-text-secondary)" }}>
          <span>{m.label}</span>
          <span style={{ fontFamily: "var(--uiv2-font-mono)" }}>{m.measured ? m.value : "Not measured"}</span>
        </div>
      ))}
      {/* Until seo-score is redeployed with per-metric coverage, a 0 here may
          mean "not returned". Said, rather than left for the user to assume. */}
      {!Array.isArray(scored.measured) ? (
        <p style={{ ...muted, fontSize: 11 }}>A 0 here may mean the metric was not returned.</p>
      ) : null}
      {scored.suggestions?.[0] ? <p style={muted}>{scored.suggestions[0]}</p> : null}
    </div>
  );
}

export default function AssetCopyReview({ asset, usedInPosts = [], reviewPlatforms = [] }) {
  const [platform, setPlatform] = useState(reviewPlatforms[0]?.key || "");
  const [assetScore, setAssetScore] = useState(null);
  const [postScores, setPostScores] = useState({});

  const title = String(asset?.title || "").trim();
  const tags = [...(asset?.tags || []), ...(asset?.ai_tags || [])].map((t) => String(t || "").trim()).filter(Boolean);
  const chosen = reviewPlatforms.find((p) => p.key === platform) ? platform : (reviewPlatforms[0]?.key || "");

  async function reviewAsset() {
    if (!title || !chosen) return;
    setAssetScore({ state: SCORE_STATE.SCORING });
    const out = await scoreDestinations(scorePostSeo, [{
      platform: chosen,
      // The asset has no caption; its title is the text a post starts from.
      caption: title,
      title,
      hashtags: tags.map((t) => (t.startsWith("#") ? t : `#${t.replace(/\s+/g, "")}`)),
      mediaType: asset?.media_type || null,
    }]);
    setAssetScore(out[chosen]);
  }

  async function reviewPost(post) {
    if (!String(post.caption || "").trim()) return;
    setPostScores((prev) => ({ ...prev, [post.id]: { state: SCORE_STATE.SCORING } }));
    // postId lets seo-score record the result on the post's own seo_state, the
    // same way the Calendar drawer's Re-score does.
    const scorer = (args) => scorePostSeo({ ...args, postId: post.id });
    const out = await scoreDestinations(scorer, [{
      platform: post.platform,
      caption: post.caption,
      title: post.title || "",
      hashtags: Array.isArray(post.hashtags) ? post.hashtags : [],
      mediaType: asset?.media_type || null,
    }]);
    setPostScores((prev) => ({ ...prev, [post.id]: out[post.platform] }));
  }

  const box = {
    display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 10,
    border: "1px solid var(--uiv2-border)", background: "var(--uiv2-bg-inset)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ── The asset's own title and tags ─────────────────────────────── */}
      <div style={box}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--uiv2-text-primary)" }}>Title and tags</span>
        {!title ? (
          <p style={muted}>This asset has no title to review. Add one in Details above.</p>
        ) : reviewPlatforms.length === 0 ? (
          <p style={muted}>
            None of your connected accounts can post this file, so there is no destination to review it for.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                className="ui-select"
                aria-label="Review for which destination"
                value={chosen}
                onChange={(e) => { setPlatform(e.target.value); setAssetScore(null); }}
              >
                {reviewPlatforms.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <Button size="sm" variant="subtle" onClick={reviewAsset} disabled={assetScore?.state === SCORE_STATE.SCORING}>
                {assetScore?.state === SCORE_STATE.SCORED ? "Review again" : "Review"}
              </Button>
            </div>
            <ScoreSummary scored={assetScore} />
            {!assetScore ? (
              <p style={muted}>
                Reviews “{title}”{tags.length ? ` with ${tags.length} tag${tags.length === 1 ? "" : "s"}` : ""}. Not saved — it describes the asset as it is now.
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* ── Posts already made from it ─────────────────────────────────── */}
      {usedInPosts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--uiv2-text-primary)" }}>Posts made from it</span>
          {usedInPosts.map((post) => {
            const reportState = finalReportState(post);
            const label = `${post.platform || "Post"} · ${post.status}`;
            if (reportState !== "not_applicable") {
              // Published: the frozen record. No call, no re-score.
              return (
                <div key={post.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ ...muted, textTransform: "capitalize" }}>{label}</span>
                  <CopyReviewReport post={post} compact />
                </div>
              );
            }
            const scored = postScores[post.id];
            return (
              <div key={post.id} style={box}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ ...muted, textTransform: "capitalize" }}>{label}</span>
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() => reviewPost(post)}
                    disabled={!String(post.caption || "").trim() || scored?.state === SCORE_STATE.SCORING}
                  >
                    {scored?.state === SCORE_STATE.SCORED ? "Review again" : "Review caption"}
                  </Button>
                </div>
                <p style={{ ...muted, color: "var(--uiv2-text-primary)" }}>
                  {String(post.caption || "").trim() ? `${String(post.caption).slice(0, 140)}${String(post.caption).length > 140 ? "…" : ""}` : "No caption yet."}
                </p>
                <ScoreSummary scored={scored} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
