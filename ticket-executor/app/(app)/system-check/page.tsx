"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import Link from "next/link";
import LoadingRing from "../../ticket-executor/LoadingRing";
import SkillInstaller from "../../SkillInstaller";
import { useBoltsContext } from "../../BoltsContext";
import { COLORS, FONT, card, clipCorner, ctaButtonStyle, fieldLabel, pill, tintedCard } from "@/lib/ui";
import type { Check, CheckGroup, CheckStatus, PreflightResult } from "@/lib/preflight";
import ProviderBadge from "../ProviderBadge";
import PageHeading from "../PageHeading";
import NotificationCenter from "../NotificationCenter";
import { PREFLIGHT_KEY, fetchPreflight, usePreflight } from "../../queries";
import DesktopOnly from "../DesktopOnly";

// Section order + copy. Each group answers one question a new dev has.
const GROUPS: { id: CheckGroup; title: string; blurb: string }[] = [
  { id: "environment", title: "ENVIRONMENT", blurb: "Local tooling and database the app itself needs." },
  { id: "skills", title: "SKILLS", blurb: "The four skills a run can be started with. They live on your machine; this repo ships a copy you can install from here." },
  { id: "agents", title: "AGENTS", blurb: "The subagents a D-Agent workflow run spawns. They live in ~/.claude/agents; this repo ships a copy you can install from here." },
  { id: "connection", title: "PROVIDER CONNECTION", blurb: "The organization-level connection tickets are read from." },
  { id: "agent-access", title: "CLAUDE'S PROVIDER ACCESS", blurb: "How the Claude CLI itself reaches the provider — its MCP path, separate from the app's connection above. Without it a skill cannot read the ticket." },
  // No "repo" section: Root repo belongs to a ticket, not to this page. It is
  // validated per run by POST /api/tickets/[id]/implement before the CLI starts.
];

// Which Guide section explains how to clear this group's failures.
// Keys match SECTIONS ids in app/guide/content.tsx.
const GUIDE_ANCHOR: Partial<Record<CheckGroup, string>> = {
  environment: "cli",
  skills: "skills",
  agents: "agents",
  connection: "connection",
  "agent-access": "mcp",
};

const TONE: Record<CheckStatus, { color: string; label: string }> = {
  pass: { color: COLORS.success, label: "PASS" },
  warn: { color: COLORS.warning, label: "WARN" },
  fail: { color: COLORS.danger, label: "FAIL" },
};

const labelStyle: CSSProperties = fieldLabel();

function CheckRow({ c }: { c: Check }) {
  const tone = TONE[c.status];
  const shell =
    c.status === "fail"
      ? tintedCard(c.level === "blocker" ? "danger" : "warning", { padding: "11px 13px", radius: "10px" })
      : c.status === "warn"
        ? tintedCard("warning", { padding: "11px 13px", radius: "10px" })
        : card();
  return (
    <div style={{ ...shell, display: "flex", alignItems: "flex-start", gap: "11px" }}>
      <span style={{ ...pill({ color: tone.color, border: COLORS.border, size: "xs", weight: 700 }), flex: "0 0 auto", marginTop: "1px", letterSpacing: ".04em" }}>
        {tone.label}
      </span>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontSize: FONT.base, fontWeight: 700, color: COLORS.text }}>{c.label}</span>
          {c.status !== "pass" && c.level === "warning" && (
            <span style={pill({ color: COLORS.textMuted, size: "xs", weight: 600 })}>optional</span>
          )}
        </div>
        <span style={{ fontSize: FONT.sm, color: COLORS.textDim, fontFamily: "var(--font-mono), monospace", lineHeight: 1.5, wordBreak: "break-word" }}>
          {c.message}
        </span>
        {c.fix && c.status !== "pass" && (
          <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.55 }}>→ {c.fix}</span>
        )}
      </div>
    </div>
  );
}

function SystemCheckPageInner() {
  const { fireBoltFromEvent } = useBoltsContext();
  const queryClient = useQueryClient();
  const quick = usePreflight();
  const deep = useMutation({
    mutationFn: () => fetchPreflight(true),
    onSuccess: (data) => queryClient.setQueryData(PREFLIGHT_KEY, data),
  });
  const result = quick.data ?? null;
  const loading = quick.isPending;
  const busy: "" | "quick" | "deep" = deep.isPending ? "deep" : quick.isFetching ? "quick" : "";
  const error = deep.error?.message || quick.error?.message || "";
  const load = (opts?: { deep?: boolean }) => (opts?.deep ? deep.mutate() : void quick.refetch());

  const summary = result?.summary;
  const banner = !summary
    ? null
    : summary.blockers > 0
      ? { tone: "danger" as const, color: COLORS.danger, title: `${summary.blockers} blocker${summary.blockers === 1 ? "" : "s"} — a run would fail`, text: "Fix everything marked FAIL below. Each blocker means the Claude CLI would either not start or die partway through, after spending tokens." }
      : summary.warnings > 0
        ? { tone: "warning" as const, color: COLORS.warning, title: `Ready — with ${summary.warnings} warning${summary.warnings === 1 ? "" : "s"}`, text: "Nothing blocks a run. The warnings are things that commonly bite later; worth clearing before your first real ticket." }
        : { tone: "success" as const, color: COLORS.success, title: "Ready to run", text: "Every check passed. Head to Ticket Execution." };

  return (
    <div style={{ position: "relative", height: "var(--te-app-h)", overflow: "hidden", display: "flex", flexDirection: "column", color: COLORS.text, ["--accent" as string]: COLORS.accent }}>
      <header className="te-page-header" style={{ position: "relative", zIndex: 30, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "14px", padding: "0 28px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "var(--te-header-bg)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <PageHeading title="System Check" kicker="D-AGENT · DIAGNOSTICS" icon={<><path d="M9 11l3 3L22 4" /><path d="M21 12a9 9 0 1 1-6.2-8.56" /></>} />
        <div style={{ flex: 1 }} />
        <NotificationCenter />
        <ProviderBadge />
      </header>

      <main className="te-scroll te-main" style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto", padding: "20px 28px", background: "var(--te-page-veil)" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: "80px" }}><LoadingRing size={120} /></div>
        ) : (
          <div className="te-sprint-page" style={{ maxWidth: "1600px", width: "100%", flex: "1 1 0", minHeight: 0, margin: "0 auto" }}>
          <div className="te-sprint-split" style={{ height: "100%", display: "grid", gridTemplateColumns: "minmax(280px, 360px) minmax(0, 1fr)", gridTemplateRows: "minmax(0, 1fr)", gap: "24px" }}>
          <div className="te-scroll te-sprint-pane" style={{ gridColumn: 1, gridRow: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "20px" }}>
            {error && (
              <div style={{ ...tintedCard("danger", { padding: "11px 13px", radius: "10px" }), fontSize: FONT.base, color: COLORS.danger, lineHeight: 1.5 }}>{error}</div>
            )}

            {banner && (
              <div style={{ ...tintedCard(banner.tone), display: "flex", flexDirection: "column", gap: "5px" }}>
                <span style={{ fontSize: FONT.md, fontWeight: 700, color: banner.color }}>{banner.title}</span>
                <span style={{ fontSize: FONT.base, color: COLORS.textDim, lineHeight: 1.6 }}>{banner.text}</span>
              </div>
            )}

            {/* Controls */}
            <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button
                  onClick={(e) => { fireBoltFromEvent(e); load(); }}
                  disabled={!!busy}
                  title="Re-run the local checks"
                  style={{ ...ctaButtonStyle("ghost", { height: "36px", cornerPx: 7 }), justifyContent: "center", minWidth: "132px", whiteSpace: "nowrap", opacity: busy ? 0.55 : 1, cursor: busy ? "default" : "pointer" }}
                >
                  <span style={{ position: "relative", zIndex: 1, display: "inline-flex" }}>
                    {busy === "quick" ? <LoadingRing size={14} /> : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>
                    )}
                  </span>
                  <span style={{ position: "relative", zIndex: 1 }}>Re-run checks</span>
                </button>
                <button
                  onClick={(e) => { fireBoltFromEvent(e); load({ deep: true }); }}
                  disabled={!!busy}
                  title="Also call the provider with the saved token and health-check every MCP server (network requests — takes ~30s)"
                  style={{ ...ctaButtonStyle("ghost", { height: "36px", cornerPx: 7 }), justifyContent: "center", minWidth: "146px", whiteSpace: "nowrap", opacity: busy ? 0.55 : 1, cursor: busy ? "default" : "pointer" }}
                >
                  <span style={{ position: "relative", zIndex: 1, display: "inline-flex" }}>
                    {busy === "deep" ? <LoadingRing size={14} /> : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.4 2.5 15.6 0 18M12 3c-2.5 2.4-2.5 15.6 0 18" /></svg>
                    )}
                  </span>
                  <span style={{ position: "relative", zIndex: 1 }}>Run deep checks</span>
                </button>
              </div>
            </div>

            {/* Payoff */}
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              {summary?.ready ? (
                <Link
                  href="/ticket-execution"
                  onClick={(e) => fireBoltFromEvent(e)}
                  style={{ ...ctaButtonStyle("primary", { height: "34px" }), textDecoration: "none" }}
                >
                  Go to Ticket Execution
                </Link>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", height: "34px", padding: "0 16px", fontSize: FONT.sm, fontWeight: 600, color: COLORS.textMuted, border: `1.5px solid ${COLORS.border}`, clipPath: clipCorner(7) }}>
                  Clear the blockers to continue
                </span>
              )}
            </div>
          </div>
          <div className="te-scroll te-sprint-pane" style={{ gridColumn: 2, gridRow: 1, minHeight: 0, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: "20px", alignContent: "start", alignItems: "start", paddingRight: "4px" }}>
            {/* Groups */}
            {GROUPS.map((g) => {
              const rows = result?.checks.filter((c) => c.group === g.id) ?? [];
              if (!rows.length) return null;
              const failed = rows.filter((c) => c.status !== "pass").length;
              return (
                <div key={g.id} style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                    <span style={labelStyle}>{g.title}</span>
                    <span style={pill({ color: failed ? COLORS.warning : COLORS.success, border: COLORS.border, size: "xs", weight: 700 })}>
                      {rows.length - failed}/{rows.length}
                    </span>
                    {(g.id === "connection" || g.id === "agent-access") && (
                      <Link href="/settings" style={{ fontSize: FONT.sm, color: COLORS.accent, textDecoration: "none", fontWeight: 600 }}>Open Settings →</Link>
                    )}
                    {failed > 0 && GUIDE_ANCHOR[g.id] && (
                      <Link href={`/guide#${GUIDE_ANCHOR[g.id]}`} style={{ fontSize: FONT.sm, color: COLORS.accent, textDecoration: "none", fontWeight: 600 }}>How to fix →</Link>
                    )}
                  </div>
                  <span style={{ fontSize: FONT.sm, color: COLORS.faint, lineHeight: 1.5, marginTop: "-4px" }}>{g.blurb}</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                    {rows.map((c) => <CheckRow key={c.id} c={c} />)}
                    {/* The skills ship in this repo, so this group is the one
                        thing on this page the user can fix without leaving it. */}
                    {g.id === "skills" && <SkillInstaller onChanged={() => load()} />}
                    {g.id === "agents" && <SkillInstaller pack="agents" onChanged={() => load()} />}
                  </div>
                </div>
              );
            })}

          </div>
          </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function SystemCheckPage() {
  return (
    <DesktopOnly title="System Check">
      <SystemCheckPageInner />
    </DesktopOnly>
  );
}
