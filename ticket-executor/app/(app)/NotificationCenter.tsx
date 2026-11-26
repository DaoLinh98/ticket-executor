"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import NotificationBell from "../ticket-executor/NotificationBell";
import { useBoltsContext } from "../BoltsContext";
import { useNotifications } from "./NotificationsProvider";
import UsageMeter from "./UsageMeter";
import { notificationPath, type AppNotification } from "@/lib/notifications";

/**
 * The bell, as every page's header renders it.
 *
 * Clicking a row opens, in a new tab, Ticket Execution with the ticket and the tab
 * in the URL — one destination whatever page the bell was opened from, and the
 * screen honours those two parameters even for a ticket its current board does
 * not contain (a released one, or one in another project).
 */
export default function NotificationCenter() {
  const { fireBoltFromEvent } = useBoltsContext();
  const { notifications, read, degraded, titleOf, markOneRead, markEveryRead, hasMore, loadingMore, loadMore } = useNotifications();
  const [open, setOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const onOpen = (n: AppNotification, e: MouseEvent) => {
    fireBoltFromEvent(e);
    markOneRead(n);
    setOpen(false);
    // A pull request waiting on the developer's review belongs to somebody
    // else's work item — there is no ticket of theirs to open, so the
    // provider's own page is the destination.
    // Every row opens in a new tab, so the page the developer is on is kept.
    if (!n.ticketId) {
      if (n.href) window.open(n.href, "_blank", "noopener");
      return;
    }
    window.open(notificationPath(n.ticketId, n.tab), "_blank", "noopener");
  };

  // Every header renders the bell (most pages directly, not through PageHeader), so the account's usage
  // meter rides along: one place puts it beside the bell on every page.
  return (
    <>
    <UsageMeter />
    <NotificationBell
      bellRef={bellRef}
      open={open}
      onToggle={(e) => { fireBoltFromEvent(e); setOpen((o) => !o); }}
      notifications={notifications}
      read={read}
      degraded={degraded}
      titleOf={titleOf}
      onOpen={onOpen}
      onMarkAllRead={markEveryRead}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={loadMore}
    />
    </>
  );
}
