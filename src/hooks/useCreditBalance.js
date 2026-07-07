"use client";

import { useEffect, useState } from "react";
import { supabase } from "../services/supabaseClient";

/**
 * Real-time credit balance for the current user, backed by `user_credits`
 * (balance, lifetime_purchased, lifetime_consumed) — same table/columns
 * UserNavbar subscribes to. Extracted so pages outside the navbar (e.g. the
 * personal dashboard) can show balance without importing navbar UI.
 */
export function useCreditBalance(userId) {
  const [credits, setCredits] = useState({
    balance: 0,
    lifetimePurchased: 0,
    lifetimeConsumed: 0,
    ready: false,
  });

  useEffect(() => {
    if (!userId) return undefined;

    let active = true;
    supabase
      .from("user_credits")
      .select("balance, lifetime_purchased, lifetime_consumed")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active || error) return;
        setCredits({
          balance: data?.balance ?? 0,
          lifetimePurchased: data?.lifetime_purchased ?? 0,
          lifetimeConsumed: data?.lifetime_consumed ?? 0,
          ready: true,
        });
      });

    const channel = supabase
      .channel(`credit-balance-${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "user_credits", filter: `user_id=eq.${userId}` },
        (payload) => {
          setCredits({
            balance: payload.new?.balance ?? 0,
            lifetimePurchased: payload.new?.lifetime_purchased ?? 0,
            lifetimeConsumed: payload.new?.lifetime_consumed ?? 0,
            ready: true,
          });
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return credits;
}

const CATEGORY_LABELS = {
  image: "Images",
  video: "Video",
  carousel: "Carousels",
  edit: "Edits",
  other: "Other",
};
// Legacy rows recorded before category tracking existed (2026-07-06 migration
// 20260706120000_credit_category_tracking.sql) have category = NULL.
const UNCATEGORIZED_LABEL = "Uncategorized (before tracking)";

/**
 * Real lifetime spend broken down by category (Images/Video/Carousels/Edits),
 * from actual `credit_transactions` consumption rows — no fabricated
 * segments. Rows written before category tracking existed group under
 * "Uncategorized" rather than being silently dropped or guessed at.
 */
export function useCreditSpendByCategory(userId, { limit = 2000 } = {}) {
  const [segments, setSegments] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;

    supabase
      .from("credit_transactions")
      .select("category, amount")
      .eq("user_id", userId)
      .eq("transaction_type", "consumption")
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data, error }) => {
        if (!active || error) return;
        const totals = new Map();
        for (const row of data ?? []) {
          const key = row.category ?? "__uncategorized__";
          const spent = Math.abs(row.amount ?? 0);
          totals.set(key, (totals.get(key) ?? 0) + spent);
        }
        const built = Array.from(totals.entries())
          .map(([key, value]) => ({
            key,
            label: key === "__uncategorized__" ? UNCATEGORIZED_LABEL : CATEGORY_LABELS[key] ?? key,
            value,
          }))
          .filter((s) => s.value > 0)
          .sort((a, b) => b.value - a.value);
        setSegments(built);
        setReady(true);
      });

    return () => {
      active = false;
    };
  }, [userId, limit]);

  return { segments, ready };
}
