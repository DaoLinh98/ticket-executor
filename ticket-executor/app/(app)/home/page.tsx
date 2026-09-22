"use client";

import Link from "next/link";
import { COLORS, FONT, ctaButtonStyle, logoText, ringBorder } from "@/lib/ui";
import { useBoltsContext } from "../../BoltsContext";
import MobileNavToggle from "../MobileNavToggle";

export default function HomePage() {
  const { fireBoltFromEvent } = useBoltsContext();
  return (
    <div style={{ position: "relative", height: "var(--te-app-h)", overflow: "hidden", display: "flex", flexDirection: "column", color: COLORS.text, ["--accent" as string]: COLORS.accent }}>
      {/* Home is the only page without a header, so the drawer's trigger has
          nowhere to sit — it floats in the corner instead. */}
      <div style={{ position: "absolute", zIndex: 2, top: "calc(12px + env(safe-area-inset-top))", left: "calc(14px + env(safe-area-inset-left))" }}>
        <MobileNavToggle />
      </div>
      <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 clamp(18px, 6vw, 32px)", gap: "clamp(18px, 4vw, 26px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", animation: "fadeUp .5s both" }}>
          <div style={{ width: "clamp(44px, 13vw, 56px)", height: "clamp(44px, 13vw, 56px)", flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 12px 40px -12px var(--accent)", ...ringBorder({ fill: "var(--accent)", variant: "filled", duration: 3.4 }) }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M8 5l8 7-8 7" stroke="#0B0C10" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <span style={logoText("clamp(32px, 11vw, 46px)")}>D-Agent</span>
        </div>

        <h1 style={{ margin: 0, fontFamily: "var(--font-space), sans-serif", fontSize: "clamp(22px, 6.5vw, 30px)", fontWeight: 700, lineHeight: 1.2, maxWidth: "760px", animation: "fadeUp .5s both", animationDelay: "70ms" }}>
          Ship tickets, not busywork.
        </h1>
        <p style={{ margin: 0, fontSize: FONT.lg, lineHeight: 1.6, color: COLORS.textDim, maxWidth: "620px", animation: "fadeUp .5s both", animationDelay: "140ms" }}>
          Point Claude Code at a ticket and watch it branch, implement, verify, and open a
          pull request — end to end, across every project in your organization.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "12px", marginTop: "6px", animation: "fadeUp .5s both", animationDelay: "210ms" }}>
          <Link href="/projects" onClick={(e) => fireBoltFromEvent(e)} style={{ textDecoration: "none", color: "#0B0C10", ...ctaButtonStyle("primary", { height: "40px" }) }}>
            Browse projects
          </Link>
          <Link href="/ticket-execution" onClick={(e) => fireBoltFromEvent(e)} style={{ textDecoration: "none", ...ctaButtonStyle("ghost", { height: "40px" }) }}>
            Open Ticket Execution
          </Link>
        </div>
      </div>
    </div>
  );
}
