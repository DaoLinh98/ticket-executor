"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  buildNotifications, markAllRead, markRead, mergeWithHistory, notificationKey,
  type AppNotification, type AutomationSource, type LifecycleSource, type PullRequestSource, type ReadEntry, type ReadMap,
  type ReportReminderSource, type RunEventSource, type ReviewSource, type TicketActivitySource,
} from "@/lib/notifications";

// How often the bell re-asks its own sources. Minutes rather than seconds: a
// reviewer's comment is not a real-time event, and the moments the answer
// genuinely changes — a run publishing a PR, a fix-review run finishing — call
// refresh() directly instead of waiting for the tick.
const NOTIFY_POLL_MS = 120_000;

// A hard floor between two polls, whatever asked for them.
const NOTIFY_MIN_GAP_MS = 20_000;

// Read state lives on the server (`/api/notifications/read`), because the bell
// is one bell wherever it is rendered *and* whichever device is rendering it.
// While it sat in localStorage, opening a notification on the laptop left it
// unread on the phone. This channel is the instant hop between two tabs of the
// same browser; another device converges on its next poll or resume.
const NOTIFY_READ_CHANNEL = "te:notifications-read";

const HISTORY_PAGE = 30;

/** The sources only the Ticket Execution screen can answer for: the board-scoped
 *  review poll, the runs this session is watching, and the titles of the tickets
 *  it has loaded. Every other page contributes none of them. */
export type LocalNotificationSources = {
  reviews?: ReviewSource[];
  waitingRuns?: { ticketId: string; runId: string }[];
  runEvents?: RunEventSource[];
  /** The board-scoped review poll could not reach the provider. */
  degraded?: boolean;
  titles?: Record<string, string>;
};

type NotificationsContextValue = {
  notifications: AppNotification[];
  read: ReadMap;
  degraded: boolean;
  titleOf: (ticketId: string) => string;
  markOneRead: (n: AppNotification) => void;
  markEveryRead: () => void;
  refresh: (opts?: { force?: boolean }) => Promise<void>;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  setLocalSources: (sources: LocalNotificationSources) => void;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used inside NotificationsProvider");
  return ctx;
}

/**
 * The bell's state, owned once for the whole authenticated shell.
 *
 * It lives here rather than on the Ticket Execution screen because the bell is
 * system-wide: the scheduler works a plan and reviewers comment while the
 * developer is on Settings or Flow Runner, and a notification only reachable from
 * one page is a notification nobody sees.
 */
export default function NotificationsProvider({ children }: { children: ReactNode }) {
  const [automation, setAutomation] = useState<AutomationSource[]>([]);
  const [pullRequests, setPullRequests] = useState<PullRequestSource[]>([]);
  const [ticketActivity, setTicketActivity] = useState<TicketActivitySource[]>([]);
  const [planReviews, setPlanReviews] = useState<ReviewSource[]>([]);
  const [reportReminder, setReportReminder] = useState<ReportReminderSource | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleSource[]>([]);
  const [local, setLocal] = useState<LocalNotificationSources>({});
  const [read, setRead] = useState<ReadMap>({});
  const [history, setHistory] = useState<AppNotification[]>([]);
  const [historyNext, setHistoryNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const historyStarted = useRef(false);
  const loadingMoreRef = useRef(false);

  const channel = useRef<BroadcastChannel | null>(null);
  // The mark handlers derive the next map from the current one, and they are
  // not state updaters — a POST fired from inside setState would be sent twice
  // under StrictMode. This is what they read instead.
  const readRef = useRef<ReadMap>({});
  readRef.current = read;

  // Marks this browser has made but the server has not acknowledged yet.
  //
  // Two things go wrong without it. A poll's GET that left before the click
  // lands after it, and replacing the map with that older answer makes the row
  // the developer just opened unread again. And a write that fails — the phone
  // was offline, the server was restarting — is lost silently: the row looks
  // read here and is unread on every other device forever. Entries stay in here
  // until a server response carries the same fingerprint back, are laid over
  // every map that arrives, and are re-sent on every flush.
  const pending = useRef<Map<string, ReadEntry>>(new Map());

  const withPending = useCallback((map: ReadMap): ReadMap => {
    if (!pending.current.size) return map;
    const next = { ...map };
    for (const [key, entry] of pending.current) next[key] = entry;
    return next;
  }, []);

  const applyRead = useCallback((map: ReadMap) => {
    const merged = withPending(map);
    setRead(merged);
    channel.current?.postMessage(merged);
  }, [withPending]);

  /** Send everything unacknowledged, not just what this call added: a mark whose
   *  write failed earlier rides along on the next one that succeeds. */
  const flushPending = useCallback(async () => {
    if (!pending.current.size) return;
    const entries = [...pending.current].map(([key, e]) => ({ key, seen: e.seen }));
    try {
      const r = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (!r.ok) throw new Error(`POST /api/notifications/read -> ${r.status}`);
      const data = await r.json();
      if (!data?.read) throw new Error("POST /api/notifications/read returned no map");
      const server = data.read as ReadMap;
      // Acknowledged means the server holds this exact fingerprint. Anything
      // else stays pending and is sent again.
      for (const e of entries) if (server[e.key]?.seen === e.seen) pending.current.delete(e.key);
      applyRead(server);
    } catch (err) {
      // Loud on purpose. While this was swallowed, a read-state route that
      // threw on every call was indistinguishable from one that worked, and
      // the bell quietly went back to being per-browser.
      console.error("[notifications] read state not saved", err);
    }
  }, [applyRead]);

  useEffect(() => {
    try {
      const c = new BroadcastChannel(NOTIFY_READ_CHANNEL);
      c.onmessage = (e) => { if (e.data) setRead(withPending(e.data as ReadMap)); };
      channel.current = c;
      return () => { c.close(); channel.current = null; };
    } catch {
      /* no BroadcastChannel (older Safari) — the other tabs converge on their
         next poll instead of instantly */
    }
  }, [withPending]);

  /** Mark these read here, on the server, and in this browser's other tabs.
   *  Applied locally first: the row has to stop looking unread on the click
   *  that opened it, not on the round-trip that records it. */
  const persistRead = useCallback(async (next: ReadMap, entries: { key: string; seen: string }[]) => {
    const readAt = new Date().toISOString();
    for (const e of entries) pending.current.set(e.key, { seen: e.seen, readAt });
    setRead(next);
    channel.current?.postMessage(next);
    await flushPending();
  }, [flushPending]);

  const fetchedAt = useRef(0);

  const fetchHistory = useCallback(async (before: string | null) => {
    const qs = new URLSearchParams({ limit: String(HISTORY_PAGE) });
    if (before) qs.set("before", before);
    const r = await fetch(`/api/notifications/history?${qs}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`GET /api/notifications/history -> ${r.status}`);
    const data = await r.json();
    return {
      items: Array.isArray(data?.items) ? (data.items as AppNotification[]) : [],
      next: typeof data?.next === "string" ? data.next : null,
    };
  }, []);

  // The newest page, re-read on every poll. Older pages already loaded stay, and
  // so does the cursor into them — only the first read sets it.
  const refreshHistory = useCallback(async () => {
    try {
      const page = await fetchHistory(null);
      setHistory((prev) => mergeWithHistory(page.items, prev));
      if (!historyStarted.current) {
        historyStarted.current = true;
        setHistoryNext(page.next);
      }
    } catch (err) {
      console.error("[notifications] history refresh failed", err);
    }
  }, [fetchHistory]);

  const loadMore = useCallback(() => {
    if (!historyNext || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    void (async () => {
      try {
        const page = await fetchHistory(historyNext);
        setHistory((prev) => mergeWithHistory(prev, page.items));
        setHistoryNext(page.next);
      } catch (err) {
        console.error("[notifications] loading older notifications failed", err);
      } finally {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    })();
  }, [fetchHistory, historyNext]);

  // No provider parameter: the route falls back to the saved connection, which
  // is the only answer a page without a provider picker could give anyway.
  const refresh = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force && Date.now() - fetchedAt.current < NOTIFY_MIN_GAP_MS) return;
    fetchedAt.current = Date.now();
    try {
      // `no-store` on both: neither response carries a validator, and a
      // heuristically-cached body is exactly the stale answer this re-read
      // exists to replace.
      const [sourcesRes, readRes] = await Promise.all([
        fetch("/api/notifications", { cache: "no-store" }),
        fetch("/api/notifications/read", { cache: "no-store" }),
      ]);
      if (!sourcesRes.ok) throw new Error(`GET /api/notifications -> ${sourcesRes.status}`);
      const data = await sourcesRes.json();
      if (Array.isArray(data.automation)) setAutomation(data.automation);
      if (Array.isArray(data.pullRequests)) setPullRequests(data.pullRequests);
      if (Array.isArray(data.ticketActivity)) setTicketActivity(data.ticketActivity);
      if (Array.isArray(data.reviews)) setPlanReviews(data.reviews);
      if ("reportReminder" in data) setReportReminder(data.reportReminder ?? null);
      if (Array.isArray(data.lifecycle)) setLifecycle(data.lifecycle);
      if (!readRes.ok) throw new Error(`GET /api/notifications/read -> ${readRes.status}`);
      const readData = await readRes.json();
      if (readData?.read) applyRead(readData.read as ReadMap);
    } catch (err) {
      // Keep what was last known, but say so: a read-state route that is down
      // means every notification is about to look unread again.
      console.error("[notifications] refresh failed", err);
    }
    // After the sources read, which is what records new events into the history.
    await refreshHistory();
    // Any mark whose write never landed is retried here, which is what makes
    // the state converge after the phone comes back online.
    await flushPending();
  }, [applyRead, flushPending, refreshHistory]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void refresh();
      timer = setInterval(() => void refresh({ force: true }), NOTIFY_POLL_MS);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    // An installed iOS app resumes rather than reloading, and a back-forward
    // cache restore does the same — no mount effect runs again, so without this
    // the bell keeps showing the state it had when the phone was locked.
    const onPageShow = () => { if (!document.hidden) { void refresh({ force: true }); start(); } };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [refresh]);

  const setLocalSources = useCallback((sources: LocalNotificationSources) => {
    setLocal(sources);
  }, []);

  // The two review polls overlap whenever a planned ticket is also on the board,
  // and they answer with the same numbers. Keyed by ticket so one entry
  // survives: the board's, because it was asked about the list the developer is
  // looking at.
  const mergedReviews = useMemo(() => {
    const byTicket = new Map(planReviews.map((r) => [r.ticketId, r]));
    for (const r of local.reviews ?? []) byTicket.set(r.ticketId, r);
    return [...byTicket.values()];
  }, [planReviews, local.reviews]);

  const notifications = useMemo(
    () =>
      mergeWithHistory(buildNotifications({
        reviews: mergedReviews,
        pullRequests,
        ticketActivity,
        waitingRuns: local.waitingRuns ?? [],
        runEvents: local.runEvents ?? [],
        automation,
        reportReminder,
        lifecycle,
      }), history),
    [mergedReviews, pullRequests, ticketActivity, automation, reportReminder, lifecycle, local.waitingRuns, local.runEvents, history]
  );

  const titleOf = useCallback((ticketId: string) => local.titles?.[ticketId] ?? "", [local.titles]);

  const markOneRead = useCallback((n: AppNotification) => {
    void persistRead(
      markRead(readRef.current, n, new Date().toISOString()),
      [{ key: notificationKey(n), seen: n.fingerprint }],
    );
  }, [persistRead]);

  const markEveryRead = useCallback(() => {
    void persistRead(
      markAllRead(readRef.current, notifications, new Date().toISOString()),
      notifications.map((n) => ({ key: notificationKey(n), seen: n.fingerprint })),
    );
  }, [persistRead, notifications]);

  const value = useMemo(
    () => ({
      notifications,
      read,
      degraded: local.degraded ?? false,
      titleOf,
      markOneRead,
      markEveryRead,
      refresh,
      hasMore: historyNext !== null,
      loadingMore,
      loadMore,
      setLocalSources,
    }),
    [notifications, read, local.degraded, titleOf, markOneRead, markEveryRead, refresh, historyNext, loadingMore, loadMore, setLocalSources]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
