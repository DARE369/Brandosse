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
