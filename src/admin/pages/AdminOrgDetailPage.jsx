"use client";

import React, { useEffect, useState } from "react";
import { useAdminLayoutContext } from "../AdminLayoutContext";
import { formatShortDate } from "../utils/formatDate";
import { supabase } from "../../services/supabaseClient";

function getOrganizationSettings(settings) {
  return settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
}

function getProvisioningLabel(settings) {
  if (settings.provision_source !== "self_signup") {
    return settings.owner_invitation_status === "accepted" ? "Owner invited" : "Admin provisioned";
  }

  switch (settings.provisioning_status) {
    case "completed":
      return "Self-signup completed";
    case "failed":
      return "Self-signup failed";
    default:
      return "Self-signup in progress";
  }
}

export default function AdminOrgDetailPage({ orgId }) {
  const { adminAccess } = useAdminLayoutContext();
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function loadOrganization() {
      if (!adminAccess?.isSuperAdmin || !orgId) return;
      setLoading(true);

      try {
        const [organizationQuery, membersQuery, complaintsQuery] = await Promise.all([
          supabase
            .from("organizations")
            .select("id, name, slug, plan, plan_key, status, created_at, settings, owner_id, owner_user_id")
            .eq("id", orgId)
            .maybeSingle(),
          supabase
            .from("organization_members")
            .select("id, user_id, role, org_role_key, status, joined_at")
            .eq("organization_id", orgId)
            .neq("status", "removed")
            .order("joined_at", { ascending: true }),
          supabase
            .from("complaints")
            .select("id, subject, status, priority, created_at")
            .eq("organization_id", orgId)
            .order("created_at", { ascending: false })
            .limit(20),
        ]);

        if (organizationQuery.error) throw organizationQuery.error;

        const members = membersQuery.error ? [] : membersQuery.data || [];
        const profileIds = [
          ...new Set(
            [
              organizationQuery.data?.owner_id || organizationQuery.data?.owner_user_id || null,
              ...members.map((member) => member.user_id),
            ].filter(Boolean),
          ),
        ];

        let profileMap = new Map();
        if (profileIds.length) {
          const { data: profiles, error: profilesError } = await supabase
            .from("profiles")
            .select("id, full_name, email")
            .in("id", profileIds);

          if (!profilesError) {
            profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
          }
        }

        if (!mounted) return;

        const organization = organizationQuery.data || null;
        const settings = getOrganizationSettings(organization?.settings);
        const ownerId = organization?.owner_id || organization?.owner_user_id || null;

        setDetail({
          organization,
          settings,
          owner: ownerId ? profileMap.get(ownerId) || null : null,
          members: members.map((member) => ({
            ...member,
            role: member.org_role_key || member.role || "member",
            profile: profileMap.get(member.user_id) || null,
          })),
          complaints: complaintsQuery.error ? [] : complaintsQuery.data || [],
        });
      } catch (error) {
        if (!mounted) return;
        console.error("Failed to load organization detail:", error);
        setDetail(null);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadOrganization();
    return () => {
      mounted = false;
    };
  }, [adminAccess, orgId]);

  if (!adminAccess?.isSuperAdmin) {
    return <div className="admin-panel admin-empty-state">Organization detail is restricted to super admins.</div>;
  }

  if (loading) {
    return <div className="admin-page-loading">Loading organization detail...</div>;
  }

  if (!detail?.organization) {
    return <div className="admin-panel admin-empty-state">Organization not found.</div>;
  }

  const planKey = detail.organization.plan_key || detail.organization.plan || "organization";

  return (
    <section className="admin-page">
      <header className="admin-page-header">
        <div>
          <span className="admin-section-kicker">Organization Detail</span>
          <h2 className="admin-page-title">{detail.organization.name}</h2>
          <p className="admin-page-subtext">
            {detail.organization.slug} · {planKey} plan · created {formatShortDate(detail.organization.created_at)}
          </p>
        </div>
      </header>

      <div className="admin-section-grid">
        <div className="admin-panel">
          <h3>Owner</h3>
          <div className="admin-list-stack">
            <div className="admin-list-item">
              <strong>{detail.owner?.full_name || detail.owner?.email || detail.settings.pending_owner_email || "Owner pending"}</strong>
              <span>{detail.owner?.email || detail.settings.pending_owner_email || "No owner email recorded yet"}</span>
            </div>
          </div>
        </div>

        <div className="admin-panel">
          <h3>Onboarding</h3>
          <div className="admin-list-stack">
            <div className="admin-list-item">
              <strong>{getProvisioningLabel(detail.settings)}</strong>
              <span>{detail.settings.provision_source === "self_signup" ? "Created directly from the signup flow." : "Created from the super admin organization console."}</span>
            </div>
            {detail.settings.provisioning_last_error ? (
              <div className="admin-list-item">
                <strong>Last setup error</strong>
                <span>{detail.settings.provisioning_last_error}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="admin-section-grid admin-section-grid-wide">
        <div className="admin-panel">
          <h3>Members</h3>
          <div className="admin-list-stack">
            {detail.members.length ? (
              detail.members.map((member) => (
                <div key={member.id} className="admin-list-item">
                  <strong>{member.profile?.full_name || member.profile?.email || member.user_id}</strong>
                  <span>{member.role} · {member.status} · joined {formatShortDate(member.joined_at)}</span>
                </div>
              ))
            ) : (
              <div className="admin-empty-inline">No members in this organization yet.</div>
            )}
          </div>
        </div>

        <div className="admin-panel">
          <h3>Complaint summary</h3>
          <div className="admin-list-stack">
            {detail.complaints.length ? (
              detail.complaints.map((complaint) => (
                <div key={complaint.id} className="admin-list-item">
                  <strong>{complaint.subject}</strong>
                  <span>{complaint.priority} · {complaint.status}</span>
                </div>
              ))
            ) : (
              <div className="admin-empty-inline">No complaints for this organization.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
