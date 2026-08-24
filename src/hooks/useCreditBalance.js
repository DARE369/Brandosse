"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "../services/supabaseClient";

/**
 * Real-time credit balance for the current user, backed by `user_credits`
 * (balance, lifetime_purchased, lifetime_consumed).
 *
 * ── Why this is a shared store and not a plain hook ─────────────────────────
 * It used to open its own query AND its own realtime channel per call site.
 * That was fine while exactly one component per page called it. It stops being
 * fine the moment the app chrome (ui-v2/shell/AppShell) renders the credit
 * pill, because the pages that also show credits in their BODY — the
 * dashboard's balance card (via useDashboardData) and Studio's affordability
 * check — then call it a second time on the same screen.
 *
 * Two calls meant two `user_credits` reads and, worse, two channels with the
 * identical topic `credit-balance-${userId}`. Supabase keys channels by topic,
 * so the second subscribe on the same topic is not a clean second
 * subscription — and whichever component unmounted first would `removeChannel`
 * the topic both were relying on, silently killing live balance updates for
 * the one still mounted.
 *
 * So: one fetch and one channel per userId, shared by every caller, torn down
 * when the last caller unmounts. Callers see no API change.
 */

const EMPTY = Object.freeze({
  balance: 0,
  lifetimePurchased: 0,
  lifetimeConsumed: 0,
  ready: false,
});

/** userId -> { refs, state, listeners, channel, active } */
const stores = new Map();

function readRow(row) {
  return Object.freeze({
    balance: row?.balance ?? 0,
    lifetimePurchased: row?.lifetime_purchased ?? 0,
    lifetimeConsumed: row?.lifetime_consumed ?? 0,
    ready: true,
  });
}

function emit(entry, next) {
  entry.state = next;
  for (const listener of entry.listeners) listener();
}

function acquire(userId) {
  const existing = stores.get(userId);
  if (existing) {
    existing.refs += 1;
    return existing;
  }

  const entry = { refs: 1, state: EMPTY, listeners: new Set(), channel: null, active: true };
  stores.set(userId, entry);

  supabase
    .from("user_credits")
    .select("balance, lifetime_purchased, lifetime_consumed")
    .eq("user_id", userId)
    .maybeSingle()
    .then(({ data, error }) => {
      // A failed read must not latch `ready: true`. A pill rendering "0 cr"
      // over a balance we never loaded is the same class of lie as the
      // account badges fixed under L2.1 — staying unready keeps the skeleton
      // up instead of inventing a number.
      if (!entry.active || error) return;
      emit(entry, readRow(data));
    });

  entry.channel = supabase
    .channel(`credit-balance-${userId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "user_credits", filter: `user_id=eq.${userId}` },
      (payload) => {
        if (!entry.active) return;
        emit(entry, readRow(payload.new));
      }
    )
    .subscribe();

  return entry;
}

function release(userId) {
  const entry = stores.get(userId);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.active = false;
  if (entry.channel) supabase.removeChannel(entry.channel);
  stores.delete(userId);
}

export function useCreditBalance(userId) {
  // `subscribe` MUST be referentially stable per userId. useSyncExternalStore
  // re-subscribes whenever this identity changes, so an inline closure would
  // acquire/release the shared store on every single render — churning the
  // realtime channel instead of sharing it, which is the bug this store exists
  // to fix.
  const subscribe = useCallback(
    (onChange) => {
      if (!userId) return () => {};
      const entry = acquire(userId);
      entry.listeners.add(onChange);
      return () => {
        entry.listeners.delete(onChange);
        release(userId);
      };
    },
    [userId]
  );

  const getSnapshot = useCallback(
    () => (userId ? stores.get(userId)?.state ?? EMPTY : EMPTY),
    [userId]
  );

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Server render has no session and no subscription — always the empty state. */
function getServerSnapshot() {
  return EMPTY;
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
