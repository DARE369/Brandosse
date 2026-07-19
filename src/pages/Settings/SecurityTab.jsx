"use client";

// src/pages/Settings/SecurityTab.jsx
// Real Supabase Auth security controls: password change (auth.updateUser),
// TOTP 2FA enrollment (auth.mfa.enroll/verify/unenroll — Supabase's built-in
// MFA, no custom crypto), and "sign out everywhere" (auth.signOut({scope:
// 'global'}), which really does invalidate every refresh token for this
// user). Supabase's client SDK has no API to list a user's active sessions
// across devices (that requires the service-role admin API), so rather than
// fabricate a session list, this shows only what's genuinely knowable
// client-side: this session's sign-in time and user agent.
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, KeyRound, LogOut, Smartphone } from "lucide-react";
import { supabase } from "../../services/supabaseClient";
import { Card, Button, Badge } from "../../ui-v2";
import styles from "./SecurityTab.module.css";

function formatDateTime(value) {
  if (!value) return "Unknown";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function SecurityTab({ user, onToast }) {
  const [pwForm, setPwForm] = useState({ next: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);

  const [factors, setFactors] = useState([]);
  const [factorsLoading, setFactorsLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollData, setEnrollData] = useState(null); // { id, qr_code, secret }
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);

  const loadFactors = async () => {
    setFactorsLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      setFactors(data?.totp || []);
    } catch (err) {
      onToast?.(err?.message || "Could not load 2FA status.", "error");
    } finally {
      setFactorsLoading(false);
    }
  };

  useEffect(() => { loadFactors(); }, []);

  const handleChangePassword = async () => {
    if (pwForm.next.length < 8) {
      onToast?.("Password must be at least 8 characters.", "error");
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      onToast?.("Passwords do not match.", "error");
      return;
    }
    setPwSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwForm.next });
      if (error) throw error;
      setPwForm({ next: "", confirm: "" });
      onToast?.("Password updated.", "success");
    } catch (err) {
      onToast?.(err?.message || "Could not update password.", "error");
    } finally {
      setPwSaving(false);
    }
  };

  const startEnroll = async () => {
    setEnrolling(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      setEnrollData({ id: data.id, qrCode: data.totp?.qr_code, secret: data.totp?.secret });
    } catch (err) {
      onToast?.(err?.message || "Could not start 2FA enrollment.", "error");
      setEnrolling(false);
    }
  };

  const cancelEnroll = async () => {
    if (enrollData?.id) {
      await supabase.auth.mfa.unenroll({ factorId: enrollData.id }).catch(() => {});
    }
    setEnrollData(null);
    setVerifyCode("");
    setEnrolling(false);
  };

  const confirmEnroll = async () => {
    if (!enrollData?.id || verifyCode.trim().length !== 6) {
      onToast?.("Enter the 6-digit code from your authenticator app.", "error");
      return;
    }
    setVerifying(true);
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: enrollData.id });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enrollData.id,
        challengeId: challenge.id,
        code: verifyCode.trim(),
      });
      if (verifyError) throw verifyError;
      onToast?.("Two-factor authentication enabled.", "success");
      setEnrollData(null);
      setVerifyCode("");
      setEnrolling(false);
      await loadFactors();
    } catch (err) {
      onToast?.(err?.message || "Invalid code — try again.", "error");
    } finally {
      setVerifying(false);
    }
  };

  const handleUnenroll = async (factorId) => {
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      onToast?.("Two-factor authentication disabled.", "success");
      await loadFactors();
    } catch (err) {
      onToast?.(err?.message || "Could not disable 2FA.", "error");
    }
  };

  const handleSignOutEverywhere = async () => {
    setSigningOutAll(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "global" });
      if (error) throw error;
      onToast?.("Signed out of all devices.", "success");
      window.location.href = "/login";
    } catch (err) {
      onToast?.(err?.message || "Could not sign out everywhere.", "error");
      setSigningOutAll(false);
    }
  };

  const verifiedFactor = factors.find((f) => f.status === "verified");

  return (
    <div className={styles.wrap}>
      <Card>
        <div className={styles.sectionHead}>
          <KeyRound size={16} aria-hidden="true" />
          <div className={styles.sectionTitle}>Change password</div>
        </div>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span>New password</span>
            <input type="password" value={pwForm.next} onChange={(e) => setPwForm((c) => ({ ...c, next: e.target.value }))} placeholder="At least 8 characters" />
          </label>
          <label className={styles.field}>
            <span>Confirm new password</span>
            <input type="password" value={pwForm.confirm} onChange={(e) => setPwForm((c) => ({ ...c, confirm: e.target.value }))} />
          </label>
        </div>
        <div className={styles.actions}>
          <Button onClick={handleChangePassword} disabled={pwSaving || !pwForm.next}>
            {pwSaving ? <Loader2 size={14} className={styles.spin} /> : null}
            {pwSaving ? "Updating…" : "Update password"}
          </Button>
        </div>
      </Card>

      <Card>
        <div className={styles.sectionHead}>
          <ShieldCheck size={16} aria-hidden="true" />
          <div className={styles.sectionTitle}>Two-factor authentication</div>
          {verifiedFactor ? <Badge tone="success">Enabled</Badge> : <Badge tone="neutral">Not enabled</Badge>}
        </div>
        <div className={styles.sectionSub}>Adds a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy) to every sign-in.</div>

        {factorsLoading ? (
          <div className={styles.loading}><Loader2 size={16} className={styles.spin} /> Checking 2FA status…</div>
        ) : verifiedFactor ? (
          <div className={styles.factorRow}>
            <span>Authenticator app · enrolled {formatDateTime(verifiedFactor.created_at)}</span>
            <Button variant="danger" size="sm" onClick={() => handleUnenroll(verifiedFactor.id)}>Disable 2FA</Button>
          </div>
        ) : enrollData ? (
          <div className={styles.enrollBox}>
            {enrollData.qrCode ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={enrollData.qrCode} alt="Scan this QR code in your authenticator app" className={styles.qr} />
            ) : null}
            {enrollData.secret ? <div className={styles.secret}>Or enter manually: <code>{enrollData.secret}</code></div> : null}
            <label className={styles.field}>
              <span>6-digit code</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
              />
            </label>
            <div className={styles.actions}>
              <Button variant="ghost" onClick={cancelEnroll} disabled={verifying}>Cancel</Button>
              <Button onClick={confirmEnroll} disabled={verifying || verifyCode.length !== 6}>
                {verifying ? "Verifying…" : "Confirm & enable"}
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.actions}>
            <Button onClick={startEnroll} disabled={enrolling}>
              {enrolling ? <Loader2 size={14} className={styles.spin} /> : null}
              {enrolling ? "Starting…" : "Enable 2FA"}
            </Button>
          </div>
        )}
      </Card>

      <Card>
        <div className={styles.sectionHead}>
          <Smartphone size={16} aria-hidden="true" />
          <div className={styles.sectionTitle}>This session</div>
        </div>
        <div className={styles.sessionInfo}>
          <div>{user?.email}</div>
          <div className={styles.sessionMeta}>Signed in {formatDateTime(user?.last_sign_in_at)}</div>
          {typeof navigator !== "undefined" ? <div className={styles.sessionMeta}>{navigator.userAgent}</div> : null}
        </div>
        <div className={styles.sectionSub}>
          Supabase doesn&apos;t expose a cross-device session list to the app itself — this is what this browser session
          genuinely knows. Use &quot;Sign out everywhere&quot; if you think another device is compromised; it immediately
          invalidates every session for this account, including this one.
        </div>
        <div className={styles.actions}>
          <Button variant="danger" onClick={handleSignOutEverywhere} disabled={signingOutAll}>
            <LogOut size={14} aria-hidden="true" />
            {signingOutAll ? "Signing out…" : "Sign out of all devices"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
