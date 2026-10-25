"use client";

import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { COLORS, FONT, clipCorner, logoText, ringBorder } from "@/lib/ui";
import { useBoltsContext } from "../BoltsContext";
import ProviderTag from "./ProviderTag";
import { useIsMobile, useMobileNav } from "./MobileNav";

// `desktopOnly` items are gated by `DesktopOnly` as well; the rail only stops
// offering a link the phone cannot follow.
type NavItem = { href: string; label: string; icon: ReactNode; desktopOnly?: boolean };

const NAV: NavItem[] = [
  {
    href: "/home",
    label: "Home",
    icon: <path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" />,
  },
  {
    href: "/projects",
    label: "Projects",
    icon: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  },
  {
    href: "/ticket-execution",
    label: "Ticket Execution",
    icon: <path d="M8 5l8 7-8 7" />,
  },
  {
    href: "/my-sprint",
    label: "Flow Runner",
    icon: (
      <>
        <path d="M8 2v4M16 2v4M3 10h18" />
        <path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </>
    ),
  },
  {
    href: "/workflow",
    label: "Workflow",
    icon: <path d="M5 6a2 2 0 1 0 0 .01M19 6a2 2 0 1 0 0 .01M12 19a2 2 0 1 0 0 .01M7 6h10M6.5 7.5l4.5 10M17.5 7.5L13 17.5" />,
  },
  {
    href: "/report",
    label: "Report",
    icon: <path d="M8 3h8l4 4v14H4V3zM8 12h8M8 16h5" />,
  },
  {
    href: "/dashboard",
    label: "Dashboard",
    desktopOnly: true,
    icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  },
  {
    href: "/guide",
    label: "Guide",
    desktopOnly: true,
    icon: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </>
    ),
  },
  {
    href: "/system-check",
    label: "System Check",
    desktopOnly: true,
    icon: (
      <>
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12a9 9 0 1 1-6.2-8.56" />
      </>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
  },
];

// `authEnabled` comes from the layout, which reads the gate on the server. When
// the shared password is unset there is no session to end, so the Log out
// control is hidden rather than left to bounce off a login page that redirects
// straight back.
export default function Sidebar({ authEnabled = true }: { authEnabled?: boolean }) {
  const pathname = usePathname();
  const { fireBoltFromEvent } = useBoltsContext();
  // Below the breakpoint the rail is an off-canvas drawer (globals.css), opened
  // from the floating toggle or an edge swipe.
  const isMobile = useIsMobile();
  const { open: navOpen, setOpen: setNavOpen } = useMobileNav();
  // Collapsed rail: icons only. Remembered so it survives navigation/reload.
  const [collapsed, setCollapsed] = useState(false);
  // The collapse chevron floats on the rail's outer edge, over the page beside
  // it. Shown only while the pointer is on the rail: it is a control for the
  // sidebar, and parking it permanently in the content area reads as part of
  // whatever page is underneath.
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem("te.sidebarCollapsed") === "1");
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem("te.sidebarCollapsed", c ? "0" : "1");
      return !c;
    });
  };

  // A drawer that is also a 68px icon rail is neither: on mobile the collapsed
  // state is ignored, since the drawer already costs nothing when closed.
  const railCollapsed = collapsed && !isMobile;

  // Navigating is what the drawer is for, so it closes itself afterwards.
  useEffect(() => { setNavOpen(false); }, [pathname, setNavOpen]);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      {navOpen && (
        <div className="te-nav-scrim" role="presentation" onClick={() => setNavOpen(false)} />
      )}
      <aside
      className="te-sidebar"
      data-mobile-open={navOpen ? "true" : "false"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        zIndex: 6,
        flex: "0 0 auto",
        width: railCollapsed ? "68px" : "272px",
        transition: "width .18s ease",
        height: "var(--te-app-h)",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "20px 14px",
        borderRight: "1px solid rgba(255,255,255,.06)",
        background: "var(--te-sidebar-bg)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        ["--accent" as string]: COLORS.accent,
      }}
    >
      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: "11px", padding: "2px 6px 18px" }}>
        <div style={{ flex: "0 0 auto", width: "34px", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 22px -8px var(--accent)", ...ringBorder({ fill: "var(--accent)", variant: "filled", duration: 3.4 }) }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M8 5l8 7-8 7" stroke="#0B0C10" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        {!railCollapsed && (
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1, minWidth: 0 }}>
            <span style={logoText(FONT.xl)}>D-Agent</span>
            <span style={{ fontSize: "11px", letterSpacing: ".16em", fontWeight: 600, marginTop: "4px", background: "linear-gradient(90deg,var(--te-faint) 0%,var(--te-faint) 30%,#FFD9BE 45%,var(--accent) 52%,var(--te-faint) 65%,var(--te-faint) 100%)", backgroundSize: "220% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "subtitleFlow 3.2s linear infinite" }}>SHIP TICKETS FASTER</span>
          </div>
        )}
      </div>

      {/* Collapse / expand — floats on the rail's own edge so it costs no rows */}
      <button
        type="button"
        onClick={toggleCollapsed}
        title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!railCollapsed}
        // Focus reveals it too, so the control is still reachable by keyboard —
        // a pointer-only affordance would simply be missing for anyone tabbing.
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        style={{
          position: "absolute", top: "74px", right: "-13px", zIndex: 8,
          // A collapsed icon rail is a pointer affordance; in the drawer there
          // is nothing to collapse to, so the control goes away entirely.
          display: isMobile ? "none" : "flex", alignItems: "center", justifyContent: "center",
          width: "26px", height: "26px", color: COLORS.textDim, cursor: "pointer",
          opacity: hovered ? 1 : 0,
          // Not just invisible: while hidden it sits over the page beside the
          // rail, and an unseen button that still swallows clicks is worse than
          // a visible one.
          pointerEvents: hovered ? "auto" : "none",
          transition: "color .15s, opacity .15s ease",
          ...ringBorder({ fill: "var(--te-raised-bg)", duration: 3.4, cornerPx: 6 }),
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--accent)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = COLORS.textDim; }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: railCollapsed ? "rotate(180deg)" : "none", transition: "transform .24s cubic-bezier(.2,.8,.2,1)" }}>
          <path d="M14 6l-6 6 6 6" />
        </svg>
      </button>

      {/* Nav */}
      <nav style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {NAV.filter((item) => !(item.desktopOnly && isMobile)).map((item) => {
          const active = isActive(item.href);
          const baseStyle: CSSProperties = {
            display: "flex",
            alignItems: "center",
            gap: "11px",
            justifyContent: railCollapsed ? "center" : "flex-start",
            height: "40px",
            padding: railCollapsed ? "0" : "0 13px",
            fontSize: FONT.base,
            fontWeight: active ? 700 : 600,
            textDecoration: "none",
            color: active ? "var(--accent)" : COLORS.textDim,
            cursor: "pointer",
            transition: "color .15s, background .15s",
          };
          const style: CSSProperties = active
            ? { ...baseStyle, ...ringBorder({ fill: "var(--te-btn-ghost-fill)", duration: 4, cornerPx: 8 }) }
            : { ...baseStyle, clipPath: clipCorner(8) };
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={(e) => fireBoltFromEvent(e)}
              title={railCollapsed ? item.label : undefined}
              style={style}
              onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.04)"; }}
              onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }}>
                {item.icon}
              </svg>
              {!railCollapsed && item.label}
            </Link>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      {!railCollapsed && (
        <div style={{ padding: "0 6px 12px" }}>
          <ProviderTag />
        </div>
      )}

      {/* Logout */}
      {authEnabled && <button
        onClick={async (e) => {
          fireBoltFromEvent(e);
          await fetch("/api/auth/logout", { method: "POST" }).catch(() => { });
          window.location.href = "/login";
        }}
        title={railCollapsed ? "Log out" : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: railCollapsed ? "center" : "flex-start",
          gap: "11px",
          height: "40px",
          padding: railCollapsed ? "0" : "0 13px",
          fontSize: FONT.base,
          fontWeight: 600,
          color: COLORS.textDim,
          cursor: "pointer",
          border: "1.5px solid var(--te-btn-outline-border)",
          background: "transparent",
          clipPath: clipCorner(8),
          transition: "color .15s, border-color .15s",
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        {!railCollapsed && "Log out"}
      </button>}
      </aside>
    </>
  );
}
