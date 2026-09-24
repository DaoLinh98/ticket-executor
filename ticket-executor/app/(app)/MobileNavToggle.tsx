"use client";

import { COLORS, ringBorder } from "@/lib/ui";
import { useMobileNav } from "./MobileNav";

export default function MobileNavToggle() {
  const { open, setOpen } = useMobileNav();
  return (
    <button
      type="button"
      className="te-nav-toggle"
      aria-label="Open navigation"
      aria-expanded={open}
      data-open={open ? "true" : "false"}
      onClick={() => setOpen(!open)}
      style={{
        alignItems: "center", justifyContent: "center",
        width: "44px", height: "44px", color: COLORS.text, cursor: "pointer",
        ...ringBorder({ fill: "var(--te-nav-toggle-fill)", duration: 4.2, cornerPx: 8 }),
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M3 6h18M3 12h18M3 18h18" />
      </svg>
    </button>
  );
}
