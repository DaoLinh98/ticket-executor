"use client";

import type { ReactNode } from "react";
import { COLORS, FONT } from "@/lib/ui";
import { useResolvedIsMobile } from "./MobileNav";

// A page the phone does not get at all. The gate is in JS rather than the CSS
// media block because hiding the markup would still let the page mount and fire
// its requests — the point here is that neither happens below the breakpoint.
export default function DesktopOnly({ title, children }: { title: string; children: ReactNode }) {
  const mobile = useResolvedIsMobile();
  if (mobile === null) return null;
  if (mobile) {
    return (
      <div style={{ height: "var(--te-app-h)", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 24px", textAlign: "center", color: COLORS.textDim, ["--accent" as string]: COLORS.accent }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "320px" }}>
          <span style={{ fontSize: FONT.lg, fontWeight: 700, color: COLORS.text }}>{title} is desktop only</span>
          <span style={{ fontSize: FONT.sm, lineHeight: 1.55 }}>Open this page on a wider screen.</span>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
