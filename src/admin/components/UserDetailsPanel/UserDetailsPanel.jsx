import React, { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { ArrowLeft, Mail, Calendar, Shield, AlertTriangle, Link as LinkIcon, Activity } from "lucide-react";
import SocialMediaTile from "./SocialMediaTile";
import ContentAnalytics from "../ContentAnalytics/ContentAnalytics";
import ContentManager from "../ContentManager/ContentManager";
import { supabase } from "../../../services/supabaseClient";
import { UiButton, UiEmptyState, UiTabs } from "../../../components/Shared/ui";
export default function UserDetailsPanel({ user, onClose }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);
  
  useEffect(() => {
    if (user?.id) {
      fetchConnectedAccounts(user.id);
    }
  }, [user]);

  const confirmAction = (message, actionLabel, onConfirm) => {
    toast((toastInstance) => (
      <div className="admin-toast-confirm">
        <p>{message}</p>
        <div className="admin-header-actions">
          <button
            type="button"
            className="admin-secondary-button"
            onClick={() => toast.dismiss(toastInstance.id)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="admin-primary-button"
            onClick={async () => {
              toast.dismiss(toastInstance.id);
              await onConfirm();
            }}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    ), { duration: 10000 });
  };


// REPLACE the existing handleSuspend, handleResetPassword, and handleDelete functions with these:

  // --- Action: Suspend User ---
  const handleSuspend = async () => {
    if (!user) return;
    const newStatus = user.status === 'suspended' ? 'active' : 'suspended';
    const action = newStatus === 'suspended' ? 'Suspend' : 'Activate';

    confirmAction(`Are you sure you want to ${action} ${user.name}?`, action, async () => {
      setActionLoading(true);
      try {
        const { error } = await supabase
          .from("profiles")
          .update({ status: newStatus })
          .eq("id", user.id);

        if (error) throw error;
        toast.success(`User ${action}ed successfully.`);
      } catch (err) {
        console.error("Suspend Error:", err);
        toast.error(`Failed to ${action.toLowerCase()} user: ${err.message}`);
      } finally {
        setActionLoading(false);
      }
    });
  };

  // --- Action: Reset Password ---
  const handleResetPassword = async () => {
    if (!user || !user.email) return;

    confirmAction(`Send password reset email to ${user.email}?`, "Send reset", async () => {
      setActionLoading(true);
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
          redirectTo: window.location.origin + "/reset-password",
        });

        if (error) throw error;
        toast.success(`Password reset email sent to ${user.email}`);
      } catch (err) {
        console.error("Reset Error:", err);
        toast.error(`Error sending reset email: ${err.message}`);
      } finally {
        setActionLoading(false);
      }
    });
  };

  // --- Action: Delete User ---
  const handleDelete = async () => {
    confirmAction(`Delete ${user.name}? This legacy panel does not use typed confirmation.`, "Delete user", async () => {
      setActionLoading(true);
      try {
        const { error } = await supabase
          .from("profiles")
          .delete()
          .eq("id", user.id);

        if (error) throw error;

        toast.success("User profile deleted.");
        if (onClose) onClose();
      } catch (err) {
        console.error("Delete Error:", err);
        toast.error(`Error deleting user: ${err.message}`);
      } finally {
        setActionLoading(false);
      }
    });
  };


  const fetchConnectedAccounts = async (userId) => {
    const { data } = await supabase
      .from("connected_accounts")
      .select("id, platform, account_name")
      .eq("user_id", userId);
    setConnectedAccounts(data || []);
  };

  if (!user) {
    return (
      <UiEmptyState
        className="admin-user-empty-state"
        icon={<Shield size={28} />}
        title="No User Selected"
        description="Select a user from the list on the left to view their details, manage connections, and audit activity."
      />
    );
  }

  return (
    <>
      {/* 1. Fixed Header */}
      <div className="details-header">
        <div className="admin-user-detail-header-row">
          {/* Mobile Back Button */}
          <button onClick={onClose} className="admin-user-detail-back" type="button" aria-label="Back to user list">
            <ArrowLeft size={24} />
          </button>

          <img 
             src={user.avatar || `https://ui-avatars.com/api/?name=${user.name}`} 
             alt={user.name} 
             className="details-avatar-large"
             onError={(e) => e.target.style.display='none'}
          />
          <div>
            <h1 className="admin-user-detail-title">{user.name}</h1>
            <div className="admin-user-detail-meta">
              <span><Mail size={15}/> {user.email}</span>
              <span className="admin-meta-dot" aria-hidden="true"></span>
              <span><Calendar size={15}/> Joined {new Date(user.created_at).toLocaleDateString()}</span>
            </div>
            <span className={`status-badge status-${user.status}`}>
              {user.status}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Scrollable Content Area */}
      <div className="user-details-scroll-area custom-scrollbar">
        
       {/* Navigation Tabs */}
        <UiTabs
          className="admin-user-detail-tabs"
          value={activeTab}
          onChange={setActiveTab}
          tabs={[
            { value: "overview", label: "Overview" },
            { value: "manager", label: "Manager" },
            { value: "analytics", label: "Analytics" },
          ]}
          ariaLabel="User detail sections"
        />

        {/* Tab Content */}
        {activeTab === "overview" && (
          <div className="admin-user-detail-section">
            
            {/* Connected Accounts Card */}
            <div className="details-card">
              <h4><LinkIcon size={16}/> Connected Platforms</h4>
              <div className="social-grid">
                {connectedAccounts.length > 0 ? (
                  connectedAccounts.map(acc => (
                    <SocialMediaTile 
                      key={acc.id} 
                      platform={acc.platform} 
                      username={acc.account_name} 
                      status="connected" 
                    />
                  ))
                ) : (
                  <div className="admin-user-empty-inline">
                    <p>No social accounts connected yet.</p>
                  </div>
                )}
              </div>
            </div>
            
            {/* Activity Card (Placeholder for now) */}
            <div className="details-card">
               <h4><Activity size={16}/> Recent Activity</h4>
               <p className="admin-muted-copy">No recent activity logged for this user.</p>
            </div>

            {/* Danger Zone Card */}
            <div className="details-card admin-danger-card">
              <h4 className="admin-danger-title"><AlertTriangle size={16}/> Danger Zone</h4>
              <p className="admin-muted-copy">
                These actions are destructive or affect the user's ability to access the platform.
              </p>

              <div className="admin-danger-actions">
                <UiButton
                  onClick={handleSuspend}
                  disabled={actionLoading}
                  variant="danger"
                  className="btn-danger-zone btn-suspend"
                >
                  {actionLoading ? "Processing..." : (user.status === 'suspended' ? "Unsuspend User" : "Suspend User")}
                </UiButton>

                <UiButton
                  onClick={handleResetPassword}
                  disabled={actionLoading}
                  variant="secondary"
                  tone="warning"
                  className="btn-danger-zone btn-reset"
                >
                  Send Password Reset
                </UiButton>

                <UiButton
                  onClick={handleDelete}
                  disabled={actionLoading}
                  variant="danger"
                  className="btn-danger-zone btn-delete"
                >
                  Delete Account
                </UiButton>
              </div>
            </div>

          </div>
        )}

        {/* Other Tabs */}
        {activeTab === "manager" && <ContentManager user={user} />}
        {activeTab === "analytics" && <ContentAnalytics user={user} />}
        
      </div>
    </>
  );
}
