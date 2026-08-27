import { supabase } from "./supabaseClient";

export async function fetchUserCredits(userId) {
  const { data, error } = await supabase
    .from("user_credits")
    .select("balance, lifetime_purchased, lifetime_consumed")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data ?? { balance: 0, lifetime_purchased: 0, lifetime_consumed: 0 };
}

export async function fetchUserTransactions(userId) {
  const { data, error } = await supabase
    .from("credit_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return data ?? [];
}

export async function fetchUserJobs(userId) {
  const { data: jobs, error: jobsError } = await supabase
    .from("video_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (jobsError) throw jobsError;
  if (!jobs?.length) return [];

  const { data: clips, error: clipsError } = await supabase
    .from("video_clips")
    .select("job_id")
    .eq("user_id", userId);

  if (clipsError) throw clipsError;

  const counts = new Map();
  for (const clip of clips ?? []) {
    counts.set(clip.job_id, (counts.get(clip.job_id) ?? 0) + 1);
  }

  return jobs.map((job) => ({
    ...job,
    clip_count: counts.get(job.id) ?? 0,
  }));
}

export async function fetchJobDetail(userId, jobId) {
  const { data: job, error: jobError } = await supabase
    .from("video_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .single();

  if (jobError) throw jobError;

  const { data: clips, error: clipsError } = await supabase
    .from("video_clips")
    .select("*")
    .eq("job_id", jobId)
    .eq("user_id", userId)
    .order("overall_score", { ascending: false });

  if (clipsError) throw clipsError;

  return {
    job,
    clips: clips ?? [],
  };
}

/**
 * The credit movements recorded against one job.
 *
 * ── Why the UI needs this ──────────────────────────────────────────────────
 * A failed job is refunded automatically (video-worker/job_runner.py:165,
 * database.py:refund_credits) and the person was never told. An earlier version
 * of the failure screen printed "your credits have been refunded" as static
 * text wired to no refund state at all — it asserted a financial fact it had no
 * knowledge of, and was correctly deleted for it.
 *
 * The fix is not silence, it is evidence: read the actual ledger row and show
 * the real amount and the real time, or show nothing.
 */
export async function fetchJobCreditActivity(userId, jobId) {
  const { data, error } = await supabase
    .from("credit_transactions")
    .select("id, amount, balance_after, transaction_type, description, created_at")
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const rows = data ?? [];
  const refund = rows.find((row) => row.transaction_type === "refund") ?? null;
  const charge = rows.find((row) => row.transaction_type === "used") ?? null;

  return {
    rows,
    // Nulls, not zeros. "Refunded 0 credits" is a claim; "we have no refund row
    // for this job" is the truth, and the interface should render nothing.
    refundedAmount: refund ? Math.abs(Number(refund.amount)) : null,
    refundedAt: refund?.created_at ?? null,
    balanceAfterRefund: refund?.balance_after ?? null,
    chargedAmount: charge ? Math.abs(Number(charge.amount)) : null,
  };
}
