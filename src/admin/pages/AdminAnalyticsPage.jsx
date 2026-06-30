"use client";

import React, { useEffect, useState } from "react";
import { ResponsiveContainer, Bar, BarChart, CartesianGrid, Pie, PieChart, Cell, Tooltip, XAxis, YAxis } from "recharts";
import { useAdminLayoutContext } from "../AdminLayoutContext";
import KpiCard from "../components/KpiCard/KpiCard";
import { inferActivityStatus } from "../utils/adminClient";
import { supabase } from "../../services/supabaseClient";

const ADMIN_CHART_COLORS = [
  "var(--admin-chart-1)",
  "var(--admin-chart-2)",
  "var(--admin-chart-3)",
  "var(--admin-chart-4)",
  "var(--admin-chart-5)",
];

export default function AdminAnalyticsPage() {
  const { adminAccess } = useAdminLayoutContext();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({
    kpis: [],
    activityBands: [],
    qualityDistribution: [],
    platformDistribution: [],
    leaderboard: [],
  });

  useEffect(() => {
    let mounted = true;

    async function loadAnalytics() {
      if (!adminAccess?.isAdmin) {
        if (mounted) {
          setData({
            kpis: [],
            activityBands: [],
            qualityDistribution: [],
            platformDistribution: [],
            leaderboard: [],
          });
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      try {
        let profilesQuery = supabase
          .from("profiles")
          .select("id, full_name, organization_id, activity_status, last_active_at, created_at");

        if (adminAccess.isOrgAdmin) {
          profilesQuery = profilesQuery.eq("organization_id", adminAccess.organizationId);
        }

        const profilesResult = await profilesQuery;
        if (profilesResult.error) throw profilesResult.error;

        const profiles = (profilesResult.data || []).map((profile) => ({
          ...profile,
          activity_status: inferActivityStatus(profile),
        }));
        const userIds = profiles.map((profile) => profile.id);

        const [generationsResult, postsResult, accountsResult, orgsResult] = await Promise.all([
          userIds.length
            ? supabase.from("generations").select("id, user_id, created_at").in("user_id", userIds)
            : Promise.resolve({ data: [] }),
          userIds.length
            ? supabase.from("posts").select("id, user_id, status").in("user_id", userIds)
            : Promise.resolve({ data: [] }),
          userIds.length
            ? supabase.from("connected_accounts").select("id, user_id, platform").in("user_id", userIds)
            : Promise.resolve({ data: [] }),
          adminAccess.isSuperAdmin
            ? supabase.from("organizations").select("id, name").order("name", { ascending: true })
            : Promise.resolve({ data: adminAccess.organization ? [adminAccess.organization] : [] }),
        ]);

        const generations = generationsResult.data || [];
        const generationIds = generations.map((generation) => generation.id);
        const reviewsResult = generationIds.length
          ? await supabase
              .from("content_quality_reviews")
              .select("id, overall_score, recommended_action")
              .in("generation_id", generationIds)
              .limit(200)
          : { data: [] };
        const posts = postsResult.data || [];
        const reviews = reviewsResult.error ? [] : reviewsResult.data || [];
        const accounts = accountsResult.data || [];

        const activityBandMap = profiles.reduce((acc, profile) => {
          acc[profile.activity_status] = (acc[profile.activity_status] || 0) + 1;
          return acc;
        }, {});

        const qualityBuckets = {
          Ready: 0,
          "Minor Review": 0,
          "Needs Revision": 0,
          Regenerate: 0,
        };

        reviews.forEach((review) => {
          const score = Number(review.overall_score);
          if (score >= 85) qualityBuckets.Ready += 1;
          else if (score >= 70) qualityBuckets["Minor Review"] += 1;
          else if (score >= 50) qualityBuckets["Needs Revision"] += 1;
          else qualityBuckets.Regenerate += 1;
        });

        const platformBuckets = accounts.reduce((acc, account) => {
          const key = account.platform || "Unknown";
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});

        const leaderboard = (orgsResult.data || []).map((organization) => {
          const orgUsers = profiles.filter((profile) => profile.organization_id === organization.id);
          const orgUserIds = orgUsers.map((profile) => profile.id);
          const orgGenerations = generations.filter((item) => orgUserIds.includes(item.user_id)).length;
          const orgPosts = posts.filter((item) => orgUserIds.includes(item.user_id)).length;
          return {
            organization: organization.name,
            generationVolume: orgGenerations,
            publishRate: orgPosts ? Math.round((posts.filter((item) => orgUserIds.includes(item.user_id) && item.status === "published").length / orgPosts) * 100) : 0,
          };
        });

        const avgQualityScore = reviews.length
          ? Math.round(reviews.reduce((sum, review) => sum + Number(review.overall_score || 0), 0) / reviews.length)
          : 0;

        if (!mounted) return;
        setData({
          kpis: [
            { title: "Active AI Users", value: String(profiles.filter((profile) => ["highly_active", "active"].includes(profile.activity_status)).length), trend: "Activity bands", trendUp: true, color: "var(--admin-chart-5)" },
            { title: "Posts Generated", value: String(generations.length), trend: "Internal data", trendUp: true, color: "var(--admin-chart-1)" },
            { title: "Publish Success Rate", value: `${posts.length ? Math.round((posts.filter((post) => post.status === "published").length / posts.length) * 100) : 0}%`, trend: "Posts only", trendUp: true, color: "var(--admin-chart-2)" },
            { title: "Avg Quality Score", value: `${avgQualityScore}`, trend: "Live when scored", trendUp: true, color: "var(--admin-chart-3)" },
          ],
          activityBands: Object.entries(activityBandMap).map(([name, value]) => ({ name, value })),
          qualityDistribution: Object.entries(qualityBuckets).map(([name, value]) => ({ name, value })),
          platformDistribution: Object.entries(platformBuckets).map(([name, value]) => ({ name, value })),
          leaderboard,
        });
      } catch (error) {
        if (!mounted) return;
        console.error("Failed to load admin analytics:", error);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadAnalytics();
    return () => {
      mounted = false;
    };
  }, [adminAccess]);

  if (loading) {
    return <div className="admin-page-loading">Loading analytics…</div>;
  }

  return (
    <section className="admin-page">
      <header className="admin-page-header">
        <div>
          <span className="admin-section-kicker">Analytics</span>
          <h2 className="admin-page-title">Admin analytics</h2>
          <p className="admin-page-subtext">
            Live internal metrics now. Platform API panels stay clearly marked as mock-ready placeholders.
          </p>
        </div>
      </header>

      <div className="admin-kpi-grid admin-kpi-grid-compact">
        {data.kpis.map((kpi) => <KpiCard key={kpi.title} {...kpi} />)}
      </div>

      <div className="admin-section-grid admin-section-grid-wide">
        <div className="admin-panel">
          <h3>User activity bands</h3>
          <div className="admin-chart-frame admin-chart-frame-sm">
            <ResponsiveContainer>
              <BarChart data={data.activityBands}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--admin-chart-grid)" />
                <XAxis dataKey="name" stroke="var(--admin-chart-axis)" />
                <YAxis stroke="var(--admin-chart-axis)" allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="var(--admin-chart-1)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="admin-panel">
          <h3>Quality score distribution</h3>
          <div className="admin-chart-frame admin-chart-frame-sm">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data.qualityDistribution} dataKey="value" nameKey="name" outerRadius={90} label>
                  {data.qualityDistribution.map((entry, index) => (
                    <Cell key={entry.name} fill={ADMIN_CHART_COLORS[index % ADMIN_CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="admin-section-grid admin-section-grid-wide">
        <div className="admin-panel">
          <h3>Platform distribution</h3>
          <div className="admin-list-stack">
            {data.platformDistribution.length ? (
              data.platformDistribution.map((entry) => (
                <div key={entry.name} className="admin-list-item">
                  <strong>{entry.name}</strong>
                  <span>{entry.value} connected accounts</span>
                </div>
              ))
            ) : (
              <div className="admin-empty-inline">Platform API data will fill this once accounts are connected.</div>
            )}
          </div>
        </div>

        <div className="admin-panel">
          <h3>Organization leaderboard</h3>
          <div className="admin-list-stack">
            {data.leaderboard.length ? (
              data.leaderboard.map((entry) => (
                <div key={entry.organization} className="admin-list-item">
                  <strong>{entry.organization}</strong>
                  <span>{entry.generationVolume} generations · {entry.publishRate}% publish rate</span>
                </div>
              ))
            ) : (
              <div className="admin-empty-inline">No organization data available yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className="admin-card-grid">
        {["Instagram", "Facebook", "TikTok", "YouTube"].map((platform) => (
          <div key={platform} className="admin-panel">
            <h3>{platform}</h3>
            <p className="admin-page-subtext">Live data available when platform APIs are connected.</p>
            <div className="admin-metric-grid">
              <div><span>Reach</span><strong>Mock</strong></div>
              <div><span>Impressions</span><strong>Mock</strong></div>
              <div><span>Engagement</span><strong>Mock</strong></div>
              <div><span>Best time</span><strong>Mock</strong></div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
