"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { COLORS, FONT, MOTION, ctaButtonStyle, displayText, logoText, ringBorder } from "@/lib/ui";
import { useBoltsContext } from "../../BoltsContext";

const HEADLINE: { text: string; color: string; align: "left" | "right"; x: number }[] = [
  { text: "Ship", color: COLORS.text, align: "left", x: -400 },
  { text: "Tickets", color: COLORS.accent, align: "right", x: 400 },
  { text: "Not busywork", color: COLORS.text, align: "left", x: -400 },
];

export default function HomePage() {
  const { fireBoltFromEvent } = useBoltsContext();
  const enter = (delay: number) => ({ ease: MOTION.easeExpo, duration: MOTION.enter, delay });
  return (
    <div style={{ position: "relative", height: "var(--te-app-h)", overflow: "hidden", display: "flex", flexDirection: "column", color: COLORS.text, ["--accent" as string]: COLORS.accent }}>
      <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "calc(14px + env(safe-area-inset-top)) clamp(18px, 5vw, 40px) 0 calc(clamp(18px, 5vw, 40px) + env(safe-area-inset-left))" }}>
        <motion.div initial={{ opacity: 0, x: -60 }} animate={{ opacity: 1, x: 0 }} transition={{ ease: MOTION.easeExpo, duration: MOTION.nav }} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "36px", height: "36px", flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 12px 40px -12px var(--accent)", ...ringBorder({ fill: "var(--accent)", variant: "filled", duration: 3.4 }) }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M8 5l8 7-8 7" stroke="#0B0C10" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <span style={logoText("clamp(22px, 6vw, 32px)")}>D-Agent</span>
        </motion.div>
      </div>

      <div style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", width: "100%", maxWidth: "760px", padding: "0 clamp(18px, 5vw, 40px) calc(clamp(24px, 6vh, 64px) + env(safe-area-inset-bottom)) calc(clamp(18px, 5vw, 40px) + env(safe-area-inset-left))", gap: "clamp(18px, 3vh, 28px)" }}>
        <h1 style={{ ...displayText("hero"), display: "flex", flexDirection: "column" }}>
          {HEADLINE.map((line, i) => (
            <motion.span
              key={line.text}
              initial={{ opacity: 0, x: line.x }}
              animate={{ opacity: 1, x: 0 }}
              transition={enter(i * MOTION.stagger)}
              style={{ display: "block", color: line.color, textAlign: line.align }}
            >
              {line.text}
            </motion.span>
          ))}
        </h1>

        <motion.p initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={enter(0.4)} style={{ margin: 0, fontSize: FONT.lg, lineHeight: 1.6, color: COLORS.textDim, maxWidth: "560px" }}>
          Point Claude Code at a ticket and watch it branch, implement, verify, and open a
          pull request — end to end, across every project in your organization.
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={enter(0.5)} style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          <motion.div initial="rest" animate="rest" whileHover="hover" whileTap={MOTION.tap} style={{ flex: "1 1 200px" }}>
            <Link href="/projects" onClick={(e) => fireBoltFromEvent(e)} style={{ textDecoration: "none", color: "var(--te-on-accent)", ...ctaButtonStyle("primary", { height: "48px" }), justifyContent: "space-between", fontSize: FONT.lg }}>
              Browse projects
              <motion.svg
                variants={{ rest: { rotate: -45 }, hover: { rotate: 0 } }}
                transition={{ ease: MOTION.easeExpo, duration: 0.5 }}
                width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </motion.svg>
            </Link>
          </motion.div>
          <motion.div whileTap={MOTION.tap} style={{ flex: "1 1 200px" }}>
            <Link href="/ticket-execution" onClick={(e) => fireBoltFromEvent(e)} style={{ textDecoration: "none", ...ctaButtonStyle("ghost", { height: "48px" }), justifyContent: "center", fontSize: FONT.lg }}>
              Open Ticket Execution
            </Link>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
