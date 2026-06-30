"use client";

import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useAdminLayoutContext } from "../AdminLayoutContext";
import CreateOrgPanel from "../components/CreateOrgPanel";
import OrgInvitePanel from "../components/OrgInvitePanel";
import { fetchAdminOrgs, sendOwnerInvitation } from "../services/orgAdminService";
import { formatShortDate } from "../utils/formatDate";

function getInvitationBadgeClass(status) {
  switch (status) {
    case "accepted":
      return "admin-pill admin-pill-success";
    case "pending":
      return "admin-pill admin-pill-warning";
    case "expired":
    case "failed":
      return "admin-pill admin-pill-danger";
    default:
      return "admin-pill admin-pill-neutral";
  }
}

function getInvitationLabel(status) {
  switch (status) {
    case "accepted":
      return "Accepted";
    case "pending":
      return "Pending";
    case "expired":
      return "Expired";
    case "failed":
      return "Failed";
    default:
      return "Not sent";
  }
}

function getOnboardingBadgeClass(organization) {
  if (organization.provisionSource === "self_signup") {
    switch (organization.provisioningStatus) {
      case "completed":
        return "admin-pill admin-pill-success";
      case "failed":
        return "admin-pill admin-pill-danger";
      default:
        return "admin-pill admin-pill-warning";
    }
  }

  return getInvitationBadgeClass(organization.invitationStatus);
}

function getOnboardingLabel(organization) {
  if (organization.provisionSource === "self_signup") {
    switch (organization.provisioningStatus) {
      case "completed":
        return "Self-signup";
      case "failed":
        return "Setup failed";
      default:
        return "Provisioning";
    }
  }

  return getInvitationLabel(organization.invitationStatus);
}

function getOnboardingCopy(organization) {
  if (organization.provisionSource === "self_signup") {
    if (organization.provisioningStatus === "failed") {
      return organization.provisioningLastError || "Self-service setup needs attention.";
    }

    if (organization.provisioningStatus === "completed") {
      return "Workspace owner created this organization directly from signup.";
    }

    return "Self-service onboarding is still being completed.";
  }

  if (organization.invitationStatus === "failed") {
    return organization.invitationLastError || "The last invitation attempt did not send.";
  }

  if (organization.invitationRequiresPasswordSetup) {
    return "Password setup flow";
  }

  if (organization.invitationStatus === "none") {
    return "No invitation on record";
  }

  return "Accept invitation flow";
}

export default function AdminOrgsPage() {
  const { navigate } = useAppNavigation();
  const { adminAccess } = useAdminLayoutContext();
  const [loading, setLoading] = useState(true);
  const [organizations, setOrganizations] = useState([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [inviteOrg, setInviteOrg] = useState(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadOrganizations() {
      if (!adminAccess?.isSuperAdmin) {
        if (mounted) setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const rows = await fetchAdminOrgs();
        if (mounted) setOrganizations(rows);
      } catch (error) {
        if (!mounted) return;
        console.error("Failed to load organizations:", error);
        setOrganizations([]);
        toast.error(error?.message || "Failed to load organizations.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadOrganizations();
    return () => {
      mounted = false;
    };
  }, [adminAccess?.isSuperAdmin]);

  const refreshOrganizations = async () => {
    const rows = await fetchAdminOrgs();
    setOrganizations(rows);
    return rows;
  };

  const handleOrgCreated = async ({ orgName, invitation, warning }) => {
    await refreshOrganizations();
    if (warning) {
      toast.error(`${orgName} was created, but the owner onboarding link needs attention. ${warning}`);
      return;
    }
    toast.success(`${orgName} created. The owner onboarding link is ready to share.`);
  };

  const handleSendInvitation = async ({ organizationId, ownerEmail }) => {
    setInviteBusy(true);
    try {
      const result = await sendOwnerInvitation({ organizationId, ownerEmail });
      await refreshOrganizations();
      toast.success(`The owner onboarding link is ready for ${ownerEmail || "the owner"}.`);
      return result;
    } catch (error) {
      toast.error(error?.message || "Failed to send invitation.");
      throw error;
    } finally {
      setInviteBusy(false);
    }
  };

  if (!adminAccess?.isSuperAdmin) {
    return <div className="admin-panel admin-empty-state">Organizations are available to super admins only.</div>;
  }

  return (
    <section className="admin-page">
      <header className="admin-page-header">
        <div>
          <span className="admin-section-kicker">Tenant Governance</span>
          <h2 className="admin-page-title">Organizations</h2>
          <p className="admin-page-subtext">Provision workspaces, monitor owner onboarding, and open tenant detail screens.</p>
        </div>
        <button type="button" className="admin-primary-button" onClick={() => setPanelOpen(true)}>
          + New Organization
        </button>
      </header>

      {loading ? (
        <div className="admin-page-loading">Loading organizations...</div>
      ) : organizations.length ? (
        <div className="admin-panel">
          <div className="admin-table-wrap">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Owner</th>
                  <th>Plan</th>
                  <th>Onboarding</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {organizations.map((organization) => (
                  <tr key={organization.id}>
                    <td>
                      <div className="admin-metric-stack">
                        <strong>{organization.name}</strong>
                        <span>{organization.slug}</span>
                      </div>
                    </td>
                    <td>
                      <div className="admin-metric-stack">
                        <strong>{organization.ownerName || organization.ownerEmail || "Owner pending"}</strong>
                        <span>{organization.ownerEmail || "No owner email recorded yet"}</span>
                      </div>
                    </td>
                    <td>{organization.planKey}</td>
                    <td>
                      <div className="admin-metric-stack">
                        <span className={getOnboardingBadgeClass(organization)}>
                          {getOnboardingLabel(organization)}
                        </span>
                        <span>{getOnboardingCopy(organization)}</span>
                      </div>
                    </td>
                    <td>{organization.status}</td>
                    <td>{formatShortDate(organization.created_at)}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button
                          type="button"
                          className="admin-inline-button"
                          onClick={() => navigate(`/app/admin/organizations/${organization.id}`)}
                        >
                          Open
                        </button>
                        {organization.provisionSource !== "self_signup" && (
                          organization.invitationStatus === "pending"
                          || organization.invitationStatus === "expired"
                          || organization.invitationStatus === "failed"
                          || (organization.invitationStatus === "none" && organization.ownerEmail)
                        ) ? (
                          <button
                            type="button"
                            className="admin-secondary-button"
                            onClick={() => setInviteOrg(organization)}
                            disabled={inviteBusy && inviteOrg?.id === organization.id}
                          >
                            {(inviteBusy && inviteOrg?.id === organization.id)
                              ? "Creating..."
                              : organization.invitationStatus === "none"
                                ? "Create link"
                                : "Regenerate link"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="admin-panel admin-empty-state">
          <div className="admin-list-stack">
            <strong>No organizations yet</strong>
            <span>Organizations allow you to group users into teams with an Organization Admin who manages them. Create the first workspace and copy the owner onboarding link directly from the provisioning panel.</span>
            <button type="button" className="admin-primary-button" onClick={() => setPanelOpen(true)}>
              Create First Organization
            </button>
          </div>
        </div>
      )}

      <CreateOrgPanel
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        onSuccess={handleOrgCreated}
      />
      <OrgInvitePanel
        open={Boolean(inviteOrg)}
        organization={inviteOrg}
        busy={inviteBusy}
        onClose={() => setInviteOrg(null)}
        onSubmit={handleSendInvitation}
      />
    </section>
  );
}
