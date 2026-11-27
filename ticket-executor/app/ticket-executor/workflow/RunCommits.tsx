"use client";

import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CommitSummary } from "@/lib/types";
import { COLORS, FONT, card, ctaButtonStyle, sectionCaption, tintedCard } from "@/lib/ui";
import { commitFilesKey, fetchCommitFiles, fetchTicketCommits, ticketCommitsKey } from "../../queries";
import CommitFilesModal from "../CommitFilesModal";
import { timeAgo } from "../helpers";
import { MONO } from "./parts";

/** The run's pull request commits; a row opens the same per-file diff popup as the Commits tab. */
export default function RunCommits({ ticketId, provider }: { ticketId: string; provider: string }) {
  const [open, setOpen] = useState<CommitSummary | null>(null);
  const commitsQ = useQuery({ queryKey: ticketCommitsKey(ticketId, provider), queryFn: () => fetchTicketCommits(ticketId, provider), staleTime: 0 });
  const filesQ = useQuery({
    queryKey: commitFilesKey(ticketId, provider, open?.sha ?? ""),
    queryFn: () => fetchCommitFiles(ticketId, provider, open!.sha),
    enabled: !!open,
    staleTime: Infinity,
  });
  const commits = commitsQ.data ?? [];
  if (!commits.length) return null;

  return (
    <section aria-label="Commits on the pull request" style={{ ...card({ padding: "10px 12px" }), marginTop: 12 }}>
      <b style={{ ...sectionCaption(), display: "block", fontSize: FONT.xs }}>
        {commits.length} commit{commits.length === 1 ? "" : "s"} on the pull request
      </b>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
        {commits.map((c) => (
          <button
            key={c.sha}
            type="button"
            className="te-wf-tap"
            onClick={() => setOpen(c)}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 40, textAlign: "left", padding: "6px 8px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: COLORS.text }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: FONT.sm, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.message || "(no message)"}</span>
              <span style={{ display: "block", fontSize: FONT.xs, color: COLORS.textMuted }}>
                {c.author}
                {c.date ? ` · ${timeAgo(c.date)}` : ""}
              </span>
            </span>
            <span style={{ flex: "0 0 auto", fontFamily: MONO, fontSize: FONT.xs, color: "var(--te-indigo)" }}>{c.shortSha}</span>
          </button>
        ))}
      </div>
      {open && filesQ.isError ? (
        <div role="alert" style={{ ...tintedCard("danger"), marginTop: 8, display: "flex", alignItems: "center", gap: 8, fontSize: FONT.sm }}>
          <span style={{ flex: 1, minWidth: 0 }}>Could not load the files of {open.shortSha}.</span>
          <button type="button" className="te-wf-tap" onClick={() => void filesQ.refetch()} style={{ minHeight: 40, padding: "0 12px", ...ctaButtonStyle("ghost") }}>
            Retry
          </button>
          <button type="button" className="te-wf-tap" onClick={() => setOpen(null)} style={{ minHeight: 40, padding: "0 12px", ...ctaButtonStyle("ghost") }}>
            Dismiss
          </button>
        </div>
      ) : null}
      <AnimatePresence>
        {open && !filesQ.isError ? (
          <CommitFilesModal key="commit" commit={open} files={filesQ.data ?? null} onClose={() => setOpen(null)} />
        ) : null}
      </AnimatePresence>
    </section>
  );
}
