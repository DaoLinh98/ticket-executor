"use client";

import { useState, type MouseEvent } from "react";
import type { ReviewData } from "@/lib/types";
import { COLORS, FONT, avatar, card, ctaButtonStyle, initials, pill, statusPill, tintedCard } from "@/lib/ui";
import { timeAgo } from "../helpers";
import LoadingRing from "../LoadingRing";

type Props = {
  review: ReviewData;
  loading: boolean;
  fixReviewRunning: boolean;
  fixReviewDisabled: boolean;
  onFixReview: (e: MouseEvent, prUrl: string) => void;
};

// One size / one contrast level up from the original 10.5px on #5B6273 — these
// labels sit above values a reviewer has to read, not decoration.
const cardLabel = { fontSize: FONT.sm, letterSpacing: ".12em", color: COLORS.textDim, fontWeight: 600, marginBottom: "6px" } as const;

// Linked-PR overview, its review threads, and the "Fix Code Review" launcher.
export default function ResolveReviewTab({ review, loading, fixReviewRunning, fixReviewDisabled, onFixReview }: Props) {
  return (
    <div style={{ maxWidth: "800px", display: "flex", flexDirection: "column", gap: "22px", animation: "fadeUp .35s both" }}>
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}><LoadingRing size={48} /></div>
      ) : !review.pr ? (
        <div style={{ color: COLORS.textDim, fontSize: FONT.md, ...card({ padding: "22px" }) }}>
          No pull request linked to this ticket yet.
        </div>
      ) : (
        <>
          <section className="te-grid-3" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr", gap: "10px" }}>
            {/* The whole card is the link, not just the text — a click landing on
                the card's padding used to do nothing at all. Falls back to plain
                text when the provider gave us no URL, so a click can never
                navigate somewhere wrong. */}
            {review.pr.url ? (
              <a href={review.pr.url} target="_blank" rel="noopener noreferrer" style={{ ...card(), display: "block", textDecoration: "none" }}>
                <div style={cardLabel}>PULL REQUEST</div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                  <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.md, color: COLORS.indigo }}>
                    PR #{review.pr.id} — {review.pr.branch}
                  </span>
                  <CopyBranchButton branch={review.pr.branch} />
                </div>
              </a>
            ) : (
              <div style={card()}>
                <div style={cardLabel}>PULL REQUEST</div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                  <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.md, color: COLORS.indigo }}>
                    PR #{review.pr.id} — {review.pr.branch}
                  </span>
                  <CopyBranchButton branch={review.pr.branch} />
                </div>
              </div>
            )}
            <div style={card()}>
              <div style={cardLabel}>STATUS</div>
              <span style={statusPill(review.pr.status)}>{review.pr.status}</span>
            </div>
            <div style={card()}>
              <div style={cardLabel}>CREATED</div>
              <div style={{ fontSize: FONT.md, color: COLORS.textSoft }}>{timeAgo(review.pr.createdAt)}</div>
            </div>
          </section>
          <section className="te-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div style={card()}>
              <div style={cardLabel}>AUTHOR</div>
              <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: FONT.md, color: COLORS.text }}><span style={avatar(review.pr.author)}>{initials(review.pr.author)}</span>{review.pr.author}</span>
            </div>
            <div style={card()}>
              <div style={cardLabel}>REVIEWER</div>
              <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: FONT.md, color: COLORS.text }}>
                {review.pr.reviewers[0] ? (<><span style={avatar(review.pr.reviewers[0])}>{initials(review.pr.reviewers[0])}</span>{review.pr.reviewers[0]}</>) : "Unassigned"}
              </span>
            </div>
          </section>
          {review.comments.length > 0 && (
            <section>
              <h3 style={{ margin: "0 0 12px", fontFamily: "var(--te-font-display)", fontSize: FONT.sm, fontWeight: 700, letterSpacing: ".16em", color: COLORS.textDim }}>REVIEW COMMENTS</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                {review.comments.map((c) => (
                  <div key={c.id} style={{ ...card({ padding: "12px 14px", border: c.status === "open" ? "#4A2626" : COLORS.borderSubtle, background: c.status === "open" ? "rgba(255,107,107,.05)" : COLORS.panelBg }), opacity: c.status === "resolved" ? 0.6 : 1 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "9px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: FONT.md, fontWeight: 700, color: COLORS.text }}>{c.author}</span>
                      {c.filePath && <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, color: COLORS.textMuted }}>{c.filePath}{c.line ? `:${c.line}` : ""}</span>}
                      {c.status === "resolved" && <span style={{ ...pill({ color: COLORS.success, size: "xs" }) }}>Resolved</span>}
                    </div>
                    <div style={{ fontSize: FONT.lg, lineHeight: 1.6, color: COLORS.textSoft, marginTop: "5px" }}>{c.text}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "16px", ...tintedCard(review.unresolvedCount > 0 ? "danger" : "success", { padding: "18px 20px", radius: "13px" }) }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--te-font-display)", fontSize: FONT.lg, fontWeight: 700, color: "var(--te-text)" }}>
                {review.unresolvedCount > 0 ? "Unresolved review comments" : "All review comments resolved"}
              </div>
              <div style={{ fontSize: FONT.base, color: "#9A9FAD", marginTop: "2px" }}>
                {review.unresolvedCount > 0 ? `${review.unresolvedCount} issue(s) to fix from the code review.` : "Nothing left to fix on this PR."}
              </div>
            </div>
            <button
              onClick={(e) => onFixReview(e, review.pr!.url)}
              disabled={fixReviewDisabled}
              style={{ ...ctaButtonStyle(fixReviewDisabled ? "outline" : "primary"), height: "38px", padding: "0 20px", fontSize: FONT.base, flex: "0 0 auto", opacity: fixReviewDisabled ? 0.5 : 1, cursor: fixReviewDisabled ? "not-allowed" : "pointer" }}
            >
              {fixReviewRunning && <LoadingRing size={14} />}
              {!fixReviewRunning && <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z" /></svg>}
              <span>{fixReviewRunning ? "Running…" : "Fix Code Review"}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CopyBranchButton({ branch }: { branch: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={copied ? "Copied" : "Copy branch name"}
      aria-label="Copy branch name"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void navigator.clipboard.writeText(branch).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 900);
        });
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        width: "26px",
        height: "26px",
        padding: 0,
        borderRadius: "7px",
        border: `1px solid ${COLORS.borderSubtle}`,
        background: "transparent",
        color: copied ? COLORS.success : COLORS.textDim,
        cursor: "pointer",
      }}
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  );
}
