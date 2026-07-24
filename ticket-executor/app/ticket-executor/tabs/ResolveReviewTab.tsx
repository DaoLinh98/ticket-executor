"use client";

import type { MouseEvent } from "react";
import type { ReviewData } from "@/lib/types";
import { COLORS, avatar, card, ctaButtonStyle, initials, pill, statusPill, tintedCard } from "@/lib/ui";
import { timeAgo } from "../helpers";
import LoadingRing from "../LoadingRing";

type Props = {
  review: ReviewData;
  loading: boolean;
  fixReviewRunning: boolean;
  fixReviewDisabled: boolean;
  onFixReview: (e: MouseEvent, prUrl: string) => void;
};

const cardLabel = { fontSize: "10.5px", letterSpacing: ".12em", color: "#5B6273", fontWeight: 600, marginBottom: "6px" } as const;

// Linked-PR overview, its review threads, and the "Fix Code Review" launcher.
export default function ResolveReviewTab({ review, loading, fixReviewRunning, fixReviewDisabled, onFixReview }: Props) {
  return (
    <div style={{ maxWidth: "800px", display: "flex", flexDirection: "column", gap: "22px", animation: "fadeUp .35s both" }}>
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}><LoadingRing size={48} /></div>
      ) : !review.pr ? (
        <div style={{ color: "#5B6273", fontSize: "13.5px", ...card({ padding: "22px" }) }}>
          No pull request linked to this ticket yet.
        </div>
      ) : (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr", gap: "10px" }}>
            <div style={card()}>
              <div style={cardLabel}>PULL REQUEST</div>
              <a href={review.pr.url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "var(--font-mono), monospace", fontSize: "13px", color: "#9BA6E8", textDecoration: "none" }}>
                PR #{review.pr.id} — {review.pr.branch}
              </a>
            </div>
            <div style={card()}>
              <div style={cardLabel}>STATUS</div>
              <span style={statusPill(review.pr.status)}>{review.pr.status}</span>
            </div>
            <div style={card()}>
              <div style={cardLabel}>CREATED</div>
              <div style={{ fontSize: "12.5px", color: "#C7CCD8" }}>{timeAgo(review.pr.createdAt)}</div>
            </div>
          </section>
          <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div style={card()}>
              <div style={cardLabel}>AUTHOR</div>
              <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#E4E7EE" }}><span style={avatar(review.pr.author)}>{initials(review.pr.author)}</span>{review.pr.author}</span>
            </div>
            <div style={card()}>
              <div style={cardLabel}>REVIEWER</div>
              <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#E4E7EE" }}>
                {review.pr.reviewers[0] ? (<><span style={avatar(review.pr.reviewers[0])}>{initials(review.pr.reviewers[0])}</span>{review.pr.reviewers[0]}</>) : "Unassigned"}
              </span>
            </div>
          </section>
          {review.comments.length > 0 && (
            <section>
              <h3 style={{ margin: "0 0 12px", fontFamily: "var(--font-space), sans-serif", fontSize: "11px", fontWeight: 700, letterSpacing: ".16em", color: "#5B6273" }}>REVIEW COMMENTS</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                {review.comments.map((c) => (
                  <div key={c.id} style={{ ...card({ padding: "12px 14px", border: c.status === "open" ? "#4A2626" : COLORS.borderSubtle, background: c.status === "open" ? "rgba(255,107,107,.05)" : COLORS.panelBg }), opacity: c.status === "resolved" ? 0.6 : 1 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "9px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#E4E7EE" }}>{c.author}</span>
                      {c.filePath && <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "11.5px", color: "#6B7283" }}>{c.filePath}{c.line ? `:${c.line}` : ""}</span>}
                      {c.status === "resolved" && <span style={{ ...pill({ color: COLORS.success, size: "xs" }) }}>Resolved</span>}
                    </div>
                    <div style={{ fontSize: "13.5px", lineHeight: 1.6, color: "#C7CCD8", marginTop: "5px" }}>{c.text}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "16px", ...tintedCard(review.unresolvedCount > 0 ? "danger" : "success", { padding: "18px 20px", radius: "13px" }) }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: "14.5px", fontWeight: 700, color: "#F3F5F9" }}>
                {review.unresolvedCount > 0 ? "Unresolved review comments" : "All review comments resolved"}
              </div>
              <div style={{ fontSize: "13px", color: "#9A9FAD", marginTop: "2px" }}>
                {review.unresolvedCount > 0 ? `${review.unresolvedCount} issue(s) to fix from the code review.` : "Nothing left to fix on this PR."}
              </div>
            </div>
            <button
              onClick={(e) => onFixReview(e, review.pr!.url)}
              disabled={fixReviewDisabled}
              style={{ ...ctaButtonStyle(fixReviewDisabled ? "outline" : "primary"), height: "38px", padding: "0 20px", fontSize: "13px", flex: "0 0 auto", opacity: fixReviewDisabled ? 0.5 : 1, cursor: fixReviewDisabled ? "not-allowed" : "pointer" }}
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
