"use client";

import type { ReactNode } from "react";
import { FONT, logoText, ringBorder } from "@/lib/ui";

// The identity block every page header opens with: a live accent tile carrying
// the page's own glyph, the page name, and a kicker line. It replaces the
// plain title + sentence pairs the pages used to hand-roll.
export default function PageHeading({ icon, title, kicker }: { icon: ReactNode; title: string; kicker: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: "0 0 auto", animation: "fadeUp .4s both" }}>
      <div
        style={{
          position: "relative", overflow: "hidden", width: "34px", height: "34px", flex: "0 0 auto",
          display: "flex", alignItems: "center", justifyContent: "center",
          animation: "breathe 3.6s ease-in-out infinite",
          ...ringBorder({ fill: "var(--accent)", variant: "filled", duration: 3.4 }),
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#0B0C10" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
        <span style={{ position: "absolute", top: 0, left: "-45%", width: "45%", height: "100%", background: "linear-gradient(100deg,transparent,rgba(255,255,255,.5),transparent)", animation: "sheen 4.2s ease-in-out infinite", pointerEvents: "none" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
        <span style={logoText(FONT.xl)}>{title}</span>
        <span style={{ fontSize: "11px", letterSpacing: ".16em", fontWeight: 600, marginTop: "4px", whiteSpace: "nowrap", background: "linear-gradient(90deg,#5B6273 0%,#5B6273 30%,#FFD9BE 45%,var(--accent) 52%,#5B6273 65%,#5B6273 100%)", backgroundSize: "220% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "subtitleFlow 3.2s linear infinite" }}>
          {kicker}
        </span>
      </div>
    </div>
  );
}
