"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { COLORS, FONT, card, pill, ringBorder, tintedCard } from "@/lib/ui";

type Props = {
  /** The plan markdown as the run last produced it. */
  plan: string;
};

// Section headings the skills' plan.md templates use — each gets its own
// accent-colored marker icon so the eye has something to latch onto instead of
// a wall of uniform headings. The implement and review flows share most of
// them; "Scope" is the implement template's, "Thread Decisions" the review one's.
const SECTION_ICON: Record<string, { glyph: string; color: string }> = {
  Understanding: { glyph: "◎", color: COLORS.info },
  Scope: { glyph: "◫", color: COLORS.indigo },
  "Thread Decisions": { glyph: "◫", color: COLORS.indigo },
  Changes: { glyph: "✎", color: COLORS.accent },
  Verification: { glyph: "✓", color: COLORS.success },
  "Risks / Assumptions": { glyph: "!", color: COLORS.warning },
};

// A read-only record. No run stops for approval: the plan is written before any
// source file is touched and the run carries straight on, to be judged on its
// finished diff by the test gate and the independent reviewer. The plan is kept
// so the run can be read back without reconstructing its intent from the diff.
export default function PlanTab({ plan }: Props) {
  const hasPlan = !!plan.trim();

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "18px", animation: "fadeUp .35s both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", ...tintedCard(hasPlan ? "success" : "warning", { padding: "16px 18px", radius: "13px" }) }}>
        <span style={{ flex: "0 0 auto", width: "40px", height: "40px", borderRadius: "11px", background: "rgba(251,114,80,.14)", border: `1px solid ${COLORS.accent}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" style={{ stroke: COLORS.accent }}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "var(--te-font-display)", fontSize: FONT.lg, fontWeight: 700, color: COLORS.text }}>
            {hasPlan ? "Implementation plan" : "Drafting the plan…"}
          </div>
          <div style={{ fontSize: FONT.base, color: COLORS.textDim, marginTop: "2px" }}>
            {hasPlan
              ? "What Claude set out to do, written before it touched any file. Nobody approves it — the finished change is checked by the test gate and an independent reviewer instead."
              : "Claude is reading the ticket and the codebase. The plan will appear here when it's done."}
          </div>
        </div>
      </div>

      {hasPlan ? (
        <div className="md-body te-scroll" style={{ ...card({ padding: "20px 26px", radius: "13px" }), maxHeight: "620px", overflowY: "auto" }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h2: ({ children, ...props }) => {
                const text = String(children);
                const icon = SECTION_ICON[text];
                return (
                  <h2 {...props} style={icon ? { borderLeftColor: icon.color } : undefined}>
                    {icon && <span style={{ color: icon.color, marginRight: "8px" }}>{icon.glyph}</span>}
                    {children}
                  </h2>
                );
              },
            }}
          >
            {plan}
          </ReactMarkdown>
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0" }}>
          <span style={{ ...pill({ color: COLORS.warning, border: COLORS.border, size: "md" }), ...ringBorder({ fill: "var(--te-btn-ghost-fill)", ring: COLORS.warning, highlight: COLORS.warning, duration: 3, shape: "pill" }) }}>
            Analyzing…
          </span>
        </div>
      )}
    </div>
  );
}
