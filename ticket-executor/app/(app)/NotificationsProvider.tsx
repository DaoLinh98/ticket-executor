"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  buildNotifications, markAllRead, markRead,
  type AppNotification, type AutomationSource, type PullRequestSource, type ReadMap,
  type RunEventSource, type ReviewSource, type TicketActivitySource,
} from "@/lib/notifications";

// How often the bell re-asks its own sources. Minutes rather than seconds: a
// reviewer's comment is not a real-time event, and the moments the answer
// genuinely changes — a run publishing a PR, a fix-review run finishing — call
// refresh() directly instead of waiting for the tick.
const NOTIFY_POLL_MS = 120_000;

// A hard floor between two polls, whatever asked for them.
const NOTIFY_MIN_GAP_MS = 20_000;

// Where the bell's read state lives. Shared by every page, because the bell is
// one bell wherever it is rendered.
const NOTIFY_READ_KEY = "notificationsRead";

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
 * developer is on Settings or My Sprint, and a notification only reachable from
 * one page is a notification nobody sees.
 */
export default function NotificationsProvider({ children }: { children: ReactNode }) {
  const [automation, setAutomation] = useState<AutomationSource[]>([]);
  const [pullRequests, setPullRequests] = useState<PullRequestSource[]>([]);
  const [ticketActivity, setTicketActivity] = useState<TicketActivitySource[]>([]);
  const [planReviews, setPlanReviews] = useState<ReviewSource[]>([]);
  const [local, setLocal] = useState<LocalNotificationSources>({});
  const [read, setRead] = useState<ReadMap>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NOTIFY_READ_KEY);
      if (raw) setRead(JSON.parse(raw));
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  const persistRead = useCallback((next: ReadMap): ReadMap => {
    try {
      localStorage.setItem(NOTIFY_READ_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota errors */
    }
    return next;
  }, []);

  const fetchedAt = useRef(0);

  // No provider parameter: the route falls back to the saved connection, which
  // is the only answer a page without a provider picker could give anyway.
  const refresh = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force && Date.now() - fetchedAt.current < NOTIFY_MIN_GAP_MS) return;
    fetchedAt.current = Date.now();
    try {
      const r = await fetch("/api/notifications");
      const data = await r.json();
      if (Array.isArray(data.automation)) setAutomation(data.automation);
      if (Array.isArray(data.pullRequests)) setPullRequests(data.pullRequests);
      if (Array.isArray(data.ticketActivity)) setTicketActivity(data.ticketActivity);
      if (Array.isArray(data.reviews)) setPlanReviews(data.reviews);
    } catch {
      /* keep what was last known */
    }
  }, []);

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

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
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
      buildNotifications({
        reviews: mergedReviews,
        pullRequests,
        ticketActivity,
        waitingRuns: local.waitingRuns ?? [],
        runEvents: local.runEvents ?? [],
        automation,
      }),
    [mergedReviews, pullRequests, ticketActivity, automation, local.waitingRuns, local.runEvents]
  );

  const titleOf = useCallback((ticketId: string) => local.titles?.[ticketId] ?? "", [local.titles]);

  const markOneRead = useCallback((n: AppNotification) => {
    setRead((prev) => persistRead(markRead(prev, n, new Date().toISOString())));
  }, [persistRead]);

  const markEveryRead = useCallback(() => {
    setRead((prev) => persistRead(markAllRead(prev, notifications, new Date().toISOString())));
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
      setLocalSources,
    }),
    [notifications, read, local.degraded, titleOf, markOneRead, markEveryRead, refresh, setLocalSources]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
