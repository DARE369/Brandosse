import React from "react";
import { AlertTriangle, ExternalLink, ShieldAlert } from "lucide-react";
import { useAppNavigation } from "../../../Context/AppNavigationContext";
import { RISK_LEVEL_LABEL } from "../../../constants/statuses";
const DOMAIN_LABELS = {
  content_generation: "Content Generation",
  post_publishing: "Post Publishing",
  post_scheduling: "Post Scheduling",
  oauth_connection: "Platform Connections",
  profile_provisioning: "User Onboarding",
  moderation_action: "Moderation Actions",
  admin_auth: "Admin Authentication",
  edge_function: "Backend Functions",
  realtime_subscription: "Real-time Updates",
  file_upload: "File Uploads",
};

function getFailureCount(notification) {
  return notification?.metadata?.count ?? notification?.metadata?.failure_count ?? 0;
}

export default function RiskNotificationModal({ notifications = [], onAcknowledge }) {
  const { navigate } = useAppNavigation();

  if (!notifications.length) return null;

  return (
    <div className="risk-modal-backdrop" role="dialog" aria-modal="true" aria-label="Platform risk alerts">
      <div className="risk-modal-card">
        <div className="risk-modal-header">
          <div className="risk-modal-header-copy">
            <span className="risk-modal-kicker">Action Required</span>
            <h2>
              <ShieldAlert size={20} />
              Platform Risk Alert
            </h2>
            <p>
              This alert was triggered because failure counts exceeded safe thresholds.
              Check System Logs for full details.
            </p>
          </div>
          <AlertTriangle size={22} className="risk-modal-icon" />
        </div>

        <div className="risk-modal-domain-list">
          {notifications.map((notification) => {
            const domain = notification.domain || notification.metadata?.domain || "unknown";
            const label = DOMAIN_LABELS[domain] || domain.replace(/_/g, " ");
            const severity = notification.severity || "high";

            return (
              <div key={notification.id} className="risk-domain-row">
                <div className="risk-domain-copy">
                  <strong>{label}</strong>
                  <span>{getFailureCount(notification)} failures in the last 2 hours</span>
                </div>

                <div className="risk-domain-actions">
                  <span className={`risk-badge ${severity}`}>
                    {RISK_LEVEL_LABEL[severity] || severity}
                  </span>
                  <button
                    type="button"
                    className="risk-domain-link"
                    onClick={() => navigate(`/app/admin/logs?domain=${encodeURIComponent(domain)}&severity=error`)}
                  >
                    <ExternalLink size={14} />
                    View Logs
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="risk-modal-footer">
          <button type="button" className="risk-modal-acknowledge-btn" onClick={onAcknowledge}>
            I understand, dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
