"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import NotificationBell from "../ticket-executor/NotificationBell";
import { useBoltsContext } from "../BoltsContext";
import { useNotifications } from "./NotificationsProvider";
import type { AppNotification } from "@/lib/notifications";

/**
 * The bell, as every page's header renders it.
 *
 * Clicking a row always lands on Ticket Execution with the ticket and the tab
 * in the URL — one destination whatever page the bell was opened from, and the
 * screen honours those two parameters even for a ticket its current board does
 * not contain (a released one, or one in another project).
 */
export default function NotificationCenter() {
  const router = useRouter();
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
    if (!n.ticketId) {
      if (n.href?.startsWith("/")) router.push(n.href);
      else if (n.href) window.open(n.href, "_blank", "noopener");
      return;
    }
    // `at` is a nonce: without it, clicking the same notification twice pushes
    // an identical URL and the screen has nothing to react to.
    router.push(`/ticket-execution?ticket=${encodeURIComponent(n.ticketId)}&tab=${n.tab}&at=${Date.now()}`);
  };

  return (
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
  );
}
