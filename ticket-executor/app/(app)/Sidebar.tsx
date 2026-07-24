"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { COLORS, clipCorner, logoText, ringBorder } from "@/lib/ui";
import { useBoltsContext } from "../BoltsContext";

type NavItem = { href: string; label: string; icon: ReactNode };

const NAV: NavItem[] = [
  {
    href: "/",
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
    href: "/dashboard",
    label: "Dashboard",
    icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
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

export default function Sidebar() {
  const pathname = usePathname();
  const { fireBoltFromEvent } = useBoltsContext();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside
      style={{
        position: "relative",
        zIndex: 6,
        flex: "0 0 auto",
        width: "232px",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "20px 14px",
        borderRight: "1px solid rgba(255,255,255,.06)",
        background: "rgba(12,14,19,.82)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        ["--accent" as string]: COLORS.accent,
      }}
    >
      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: "11px", padding: "2px 6px 18px" }}>
        <div style={{ width: "34px", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 22px -8px var(--accent)", ...ringBorder({ fill: "var(--accent)", variant: "filled", duration: 3.4 }) }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M8 5l8 7-8 7" stroke="#0B0C10" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
          <span style={logoText("17px")}>D-Agent</span>
          <span style={{ fontSize: "9.5px", letterSpacing: ".16em", fontWeight: 600, marginTop: "4px", background: "linear-gradient(90deg,#5B6273 0%,#5B6273 30%,#FFD9BE 45%,var(--accent) 52%,#5B6273 65%,#5B6273 100%)", backgroundSize: "220% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "subtitleFlow 3.2s linear infinite" }}>SHIP TICKETS FASTER</span>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {NAV.map((item) => {
          const active = isActive(item.href);
          const baseStyle: CSSProperties = {
            display: "flex",
            alignItems: "center",
            gap: "11px",
            height: "40px",
            padding: "0 13px",
            fontSize: "13px",
            fontWeight: active ? 700 : 600,
            textDecoration: "none",
            color: active ? "var(--accent)" : COLORS.textDim,
            cursor: "pointer",
            transition: "color .15s, background .15s",
          };
          const style: CSSProperties = active
            ? { ...baseStyle, ...ringBorder({ fill: "#1A1E25", duration: 4, cornerPx: 8 }) }
            : { ...baseStyle, clipPath: clipCorner(8) };
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={(e) => fireBoltFromEvent(e)}
              style={style}
              onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.04)"; }}
              onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }}>
                {item.icon}
              </svg>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Logout */}
      <button
        onClick={async (e) => {
          fireBoltFromEvent(e);
          await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
          window.location.href = "/login";
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "11px",
          height: "40px",
          padding: "0 13px",
          fontSize: "13px",
          fontWeight: 600,
          color: COLORS.textDim,
          cursor: "pointer",
          border: "1.5px solid #2A2F3A",
          background: "transparent",
          clipPath: clipCorner(8),
          transition: "color .15s, border-color .15s",
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        Log out
      </button>
    </aside>
  );
}
