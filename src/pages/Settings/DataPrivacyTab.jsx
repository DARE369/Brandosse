"use client";

// src/pages/Settings/DataPrivacyTab.jsx
// Export + delete-account are request-only for now (see 2026-07-16 decision
// recorded alongside supabase/migrations/20260716120000_user_account_requests.sql):
// no automated export-generation or hard-delete pipeline exists yet, so both
// buttons record a real row an admin actions manually rather than pretending
// to run a pipeline that doesn't exist.
import { useEffect, useState } from "react";
import { Loader2, Download, Trash2, ShieldAlert } from "lucide-react";
import {
  fetchPendingAccountRequests, submitAccountRequest, cancelAccountRequest,
} from "../../services/userSettingsService";
import { Card, Button, Badge, Modal } from "../../ui-v2";
import styles from "./DataPrivacyTab.module.css";

function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function DataPrivacyTab({ userId, onToast }) {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [submittingExport, setSubmittingExport] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [submittingDelete, setSubmittingDelete] = useState(false);

  const load = async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    try {
      setRequests(await fetchPendingAccountRequests(userId));
    } catch (err) {
      onToast?.(err?.message || "Could not load account requests.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [userId]);

  const exportPending = requests.find((r) => r.request_type === "export");
  const deletionPending = requests.find((r) => r.request_type === "deletion");

  const handleRequestExport = async () => {
    setSubmittingExport(true);
    try {
      await submitAccountRequest(userId, "export");
      onToast?.("Export requested — we'll email you within a few days.", "success");
      await load();
    } catch (err) {
      onToast?.(err?.message || "Could not submit export request.", "error");
    } finally {
      setSubmittingExport(false);
    }
  };

  const handleCancelRequest = async (id) => {
    try {
      await cancelAccountRequest(id);
      await load();
    } catch (err) {
      onToast?.(err?.message || "Could not cancel request.", "error");
    }
  };

  const handleConfirmDelete = async () => {
    setSubmittingDelete(true);
    try {
      await submitAccountRequest(userId, "deletion");
      onToast?.("Account deletion requested. We'll follow up by email before anything is removed.", "success");
      setDeleteModalOpen(false);
      setDeleteConfirmText("");
      await load();
    } catch (err) {
      onToast?.(err?.message || "Could not submit deletion request.", "error");
    } finally {
      setSubmittingDelete(false);
    }
  };

  if (loading) {
    return <Card><div className={styles.loading}><Loader2 size={16} className={styles.spin} /> Loading…</div></Card>;
  }

  return (
    <div className={styles.wrap}>
      <Card>
        <div className={styles.sectionHead}>
          <ShieldAlert size={16} aria-hidden="true" />
          <div className={styles.sectionTitle}>Publishing mode</div>
        </div>
        <div className={styles.sectionSub}>
          Publishing on this account is simulated end-to-end — no post is actually sent to Instagram, TikTok, or any
          other platform. Statuses, timestamps, and history behave exactly like real publishing so you can evaluate the
          full workflow risk-free.
        </div>
      </Card>

      <Card>
        <div className={styles.sectionHead}>
          <Download size={16} aria-hidden="true" />
          <div className={styles.sectionTitle}>Export your data</div>
        </div>
        <div className={styles.sectionSub}>Request a copy of your content, brand kit, and account activity.</div>
        {exportPending ? (
          <div className={styles.pendingRow}>
            <Badge tone="info">Requested {formatDateTime(exportPending.created_at)}</Badge>
            <Button variant="ghost" size="sm" onClick={() => handleCancelRequest(exportPending.id)}>Cancel request</Button>
          </div>
        ) : (
          <div className={styles.actions}>
            <Button onClick={handleRequestExport} disabled={submittingExport}>
              {submittingExport ? "Requesting…" : "Request data export"}
            </Button>
          </div>
        )}
      </Card>

      <Card className={styles.dangerCard}>
        <div className={styles.sectionHead}>
          <Trash2 size={16} aria-hidden="true" />
          <div className={styles.sectionTitle}>Delete account</div>
        </div>
        <div className={styles.sectionSub}>
          Submits a deletion request — we&apos;ll email you to confirm before anything is permanently removed. This is
          not an instant, automatic delete.
        </div>
        {deletionPending ? (
          <div className={styles.pendingRow}>
            <Badge tone="danger">Requested {formatDateTime(deletionPending.created_at)}</Badge>
            <Button variant="ghost" size="sm" onClick={() => handleCancelRequest(deletionPending.id)}>Cancel request</Button>
          </div>
        ) : (
          <div className={styles.actions}>
            <Button variant="dangerSolid" onClick={() => setDeleteModalOpen(true)}>Delete account…</Button>
          </div>
        )}
      </Card>

      <Modal
        open={deleteModalOpen}
        onClose={() => { setDeleteModalOpen(false); setDeleteConfirmText(""); }}
        title="Delete your account?"
        description={"This submits a request to permanently delete your account and content. Type \"delete\" to confirm."}
        actions={(
          <>
            <Button variant="ghost" onClick={() => { setDeleteModalOpen(false); setDeleteConfirmText(""); }}>Cancel</Button>
            <Button
              variant="dangerSolid"
              disabled={deleteConfirmText.trim().toLowerCase() !== "delete" || submittingDelete}
              onClick={handleConfirmDelete}
            >
              {submittingDelete ? "Submitting…" : "Request deletion"}
            </Button>
          </>
        )}
      >
        <input
          type="text"
          className={styles.confirmInput}
          value={deleteConfirmText}
          onChange={(e) => setDeleteConfirmText(e.target.value)}
          placeholder='Type "delete" to confirm'
          autoFocus
        />
      </Modal>
    </div>
  );
}
