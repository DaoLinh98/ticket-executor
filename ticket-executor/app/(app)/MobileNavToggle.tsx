"use client";

import { COLORS, ringBorder } from "@/lib/ui";
import { useMobileNav } from "./MobileNav";

// The drawer's trigger. `display: none` above the responsive breakpoint
// (globals.css), where the Sidebar is a rail that is always on screen.
//
// It lives in `PageHeading`, which every page header carries — and separately on
// Home, which is the one page with no header to put it in.
export default function MobileNavToggle({ size = 36 }: { size?: number }) {
  const { open, setOpen } = useMobileNav();
  return (
    <button
      type="button"
      className="te-nav-toggle"
      aria-label="Open navigation"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      style={{
        alignItems: "center", justifyContent: "center", flex: "0 0 auto",
        width: `${size}px`, height: `${size}px`, color: COLORS.textSoft, cursor: "pointer",
        ...ringBorder({ fill: "var(--te-btn-ghost-fill)", duration: 4.2, cornerPx: 8 }),
      }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M3 6h18M3 12h18M3 18h18" />
      </svg>
    </button>
  );
}
