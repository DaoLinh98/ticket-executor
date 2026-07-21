"use client";

import type { CommitSummary, PullRequestOverview } from "@/lib/types";
import { avatar, card, initials, ringBorder } from "@/lib/ui";
import { timeAgo } from "../helpers";

type Props = {
  pr: PullRequestOverview | null;
  commits: CommitSummary[] | null; // null = still loading
  onOpenCommit: (commit: CommitSummary) => void;
};

// List of every commit on the linked PR's source branch (GitHub/ADO-style),
// newest activity surfaced first. Clicking a row opens CommitFilesModal.
export default function CommitsTab({ pr, commits, onOpenCommit }: Props) {
  if (!pr) {
    return (
      <div style={{ maxWidth: "800px", color: "#5B6273", fontSize: "13.5px", ...card({ padding: "22px" }) }}>
        No pull request linked to this ticket yet.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "800px", display: "flex", flexDirection: "column", gap: "14px", animation: "fadeUp .35s both" }}>
      <div style={{ fontSize: "11px", letterSpacing: ".08em", fontWeight: 700, color: "#5B6273", textTransform: "uppercase" }}>
        {commits ? `${commits.length} commit${commits.length === 1 ? "" : "s"} on ${pr.branch}` : "Loading commits…"}
      </div>
      {commits === null ? (
        <div style={{ color: "#5B6273", fontSize: "13px", ...card({ padding: "18px" }) }}>Loading commits…</div>
      ) : commits.length === 0 ? (
        <div style={{ color: "#5B6273", fontSize: "13px", ...card({ padding: "18px" }) }}>No commits found on this pull request.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {commits.map((c) => (
            <button
              key={c.sha}
              onClick={() => onOpenCommit(c)}
              style={{ display: "flex", alignItems: "center", gap: "12px", width: "100%", textAlign: "left", padding: "12px 14px", borderRadius: "11px", cursor: "pointer", ...ringBorder({ fill: "#111419", duration: 4.5, cornerPx: 8 }) }}
            >
              <span style={avatar(c.author)}>{initials(c.author)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", color: "#E4E7EE", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.message || "(no message)"}</div>
                <div style={{ fontSize: "11.5px", color: "#6B7283", marginTop: "2px" }}>
                  {c.author}{c.date ? ` · ${timeAgo(c.date)}` : ""}
                </div>
              </span>
              <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "11.5px", color: "#9BA6E8", flex: "0 0 auto" }}>{c.shortSha}</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#5B6273" strokeWidth="2" style={{ flex: "0 0 auto" }}><path d="M9 6l6 6-6 6" /></svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
