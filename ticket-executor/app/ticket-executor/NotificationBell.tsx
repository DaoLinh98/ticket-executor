"use client";

import { useState, type MouseEvent, type RefObject } from "react";
import { COLORS, FONT, SURFACE, dropdownPanelStyle, ringBorder, tabStyle, tintFill, tintedCard } from "@/lib/ui";
import {
  isUnread,
  notificationKey,
  type AppNotification,
  type NotificationKind,
  type ReadMap,
  unreadCount,
} from "@/lib/notifications";
import { timeAgo } from "./helpers";

type Props = {
  bellRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  onToggle: (e: MouseEvent) => void;
  notifications: AppNotification[];
  read: ReadMap;
  /** The last provider read failed — the list below is the last known one, not a
   *  current "nothing to see". */
  degraded: boolean;
  /** Ticket id → title. Resolved here rather than baked into the notification,
   *  because the pure module has no business holding ticket data. A ticket that
   *  is not on the current board resolves to "" and the row shows its id alone. */
  titleOf: (ticketId: string) => string;
  onOpen: (n: AppNotification, e: MouseEvent) => void;
  onMarkAllRead: () => void;
};

/** The short chip on each row. Kept next to the rendering rather than in the
 *  pure module: it is wording, and the module owns behaviour. */
const KIND_LABEL: Record<NotificationKind, string> = {
  "pr.review-comment": "REVIEW",
  "pr.awaiting-my-vote": "YOUR REVIEW",
  "pr.changes-requested": "CHANGES",
  "pr.approved": "APPROVED",
  "pr.conflict": "CONFLICT",
  "ticket.mention": "MENTIONED",
  "ticket.comment": "COMMENT",
  "run.waiting": "PLAN",
  "run.failed": "FAILED",
  "run.succeeded": "DONE",
  "scheduler.started": "AUTO",
  "scheduler.released": "RELEASED",
  "scheduler.review-fixed": "REVIEW FIXED",
  "scheduler.failed": "AUTO FAILED",
  "plan.drift": "DRIFT",
};

type Filter = "action" | "all";

export default function NotificationBell({
  bellRef, open, onToggle, notifications, read, degraded, titleOf, onOpen, onMarkAllRead,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  // Everything unread, not just what needs doing. The badge counted `action`
  // only, which made it silent for the case it is most often right about: three
  // comments landed on your tickets and the bell showed nothing, so the only way
  // to find out was to open it. A number that disagrees with the list under it is
  // a number nobody trusts.
  const badge = unreadCount(notifications, read);
  const shown = filter === "action" ? notifications.filter((n) => n.severity === "action") : notifications;
  const anyUnread = notifications.some((n) => isUnread(n, read));

  return (
    <div ref={bellRef} style={{ position: "relative" }}>
      <button
        onClick={onToggle}
        title={degraded ? "Notifications — last check failed, showing what was last known" : "Notifications"}
        style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: "30px", height: "30px", color: badge > 0 ? COLORS.accent : COLORS.textDim, cursor: "pointer", transition: "filter .15s,transform .12s", ...ringBorder({ fill: badge > 0 ? tintFill("accent") : SURFACE.modal, duration: 3.4, cornerPx: 7 }) }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
        {badge > 0 && (
          <span style={{ position: "absolute", top: "-4px", right: "-4px", minWidth: "15px", height: "15px", padding: "0 3px", borderRadius: "999px", background: COLORS.accent, color: "var(--te-btn-primary-text)", fontSize: FONT.xs, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{badge}</span>
        )}
      </button>
      {open && (
        <div className="te-scroll te-notif-panel" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40, width: "372px", animation: "fadeUp .16s ease-out both", ...dropdownPanelStyle({ maxHeight: "420px" }) }}>
          {/* Two views, not a per-kind filter list. The panel opens on "All" —
              the whole record of what the app did on your behalf, which is what
              the badge counts; "Needs you" narrows it to the actionable half. */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "2px 3px 7px", marginBottom: "3px", borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
            <button onClick={() => setFilter("action")} style={tabStyle({ active: filter === "action" })}>Needs you</button>
            <button onClick={() => setFilter("all")} style={tabStyle({ active: filter === "all" })}>All</button>
            <div style={{ flex: 1 }} />
            {anyUnread && (
              <button
                onClick={onMarkAllRead}
                style={{ padding: "5px 9px", border: "none", background: "transparent", fontSize: FONT.xs, fontWeight: 600, color: COLORS.textDim, cursor: "pointer" }}
              >
                Mark all read
              </button>
            )}
          </div>
          {degraded && (
            <div style={{ ...tintedCard("warning", { padding: "9px 11px", radius: "9px" }), marginBottom: "4px", fontSize: FONT.sm, color: COLORS.warning, lineHeight: 1.5 }}>
              Could not reach the provider on the last check — this list may be out of date.
            </div>
          )}
          {shown.length === 0 && !degraded && (
            <div style={{ padding: "16px 12px", fontSize: FONT.base, color: COLORS.faint, textAlign: "center" }}>
              {filter === "action" ? "Nothing needs you right now." : "No notifications."}
            </div>
          )}
          {shown.map((n) => {
            const unread = isUnread(n, read);
            const readAt = read[notificationKey(n)]?.readAt;
            const title = titleOf(n.ticketId);
            return (
              <button
                key={notificationKey(n)}
                onClick={(e) => onOpen(n, e)}
                style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%", textAlign: "left", padding: "10px 11px", borderRadius: "9px", border: "none", cursor: "pointer", background: unread ? tintFill("accent") : "transparent", marginBottom: "2px" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: unread ? COLORS.accent : "transparent", flex: "0 0 auto" }} />
                  {/* A pull request waiting on the developer's review has no
                      ticket of theirs to name — the chip and summary carry it. */}
                  {n.ticketId && (
                    <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, fontWeight: 700, color: unread ? COLORS.accent : COLORS.textMuted }}>#{n.ticketId}</span>
                  )}
                  <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.xs, fontWeight: 700, letterSpacing: ".04em", color: n.severity === "action" ? COLORS.textSoft : COLORS.faint }}>{KIND_LABEL[n.kind]}</span>
                </div>
                {/* The ticket, not the conversation. A comment's own words stay
                    in the provider — this row exists to get you there. */}
                {title && (
                  <div style={{ fontSize: FONT.sm, fontWeight: 600, color: unread ? COLORS.text : COLORS.textMuted, lineHeight: 1.4, paddingLeft: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
                )}
                <div style={{ fontSize: FONT.sm, color: unread ? COLORS.textDim : COLORS.faint, lineHeight: 1.5, paddingLeft: "13px" }}>{n.summary}</div>
                <div style={{ fontSize: FONT.xs, color: COLORS.faint, lineHeight: 1.4, paddingLeft: "13px" }}>
                  {unread ? timeAgo(n.at) : `Read ${timeAgo(readAt ?? "")}`}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
