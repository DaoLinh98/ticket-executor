"use client";

// Presentational building blocks used by the Guide page's section bodies.
// Everything here is props-in/JSX-out — no fetching, no business logic.

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { COLORS, FONT, card, codeBlock, ctaButtonStyle, modalShellStyle, pill } from "@/lib/ui";
import { useBoltsContext } from "../BoltsContext";
import SkillInstaller from "../SkillInstaller";

// ---------------------------------------------------------------------------
// Cmd — a copyable shell command / snippet
// ---------------------------------------------------------------------------

export function Cmd({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the text is selectable anyway */
    }
  };
  return (
    <div style={{ position: "relative" }}>
      {label && (
        <span style={{ display: "block", fontSize: FONT.xs, letterSpacing: ".08em", fontWeight: 600, color: COLORS.faint, marginBottom: "5px" }}>
          {label}
        </span>
      )}
      <pre className="te-scroll" style={{ ...codeBlock({ padding: "10px 44px 10px 12px" }) }}>
        {children}
      </pre>
      <button
        onClick={copy}
        title={copied ? "Copied" : "Copy to clipboard"}
        style={{
          position: "absolute",
          top: label ? "24px" : "6px",
          right: "6px",
          width: "28px",
          height: "28px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: `1px solid ${COLORS.border}`,
          borderRadius: "7px",
          background: COLORS.panelBg,
          color: copied ? COLORS.success : COLORS.textDim,
          cursor: "pointer",
          transition: "color .18s, border-color .18s",
        }}
      >
        {copied ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocsLink — "open the matching doc" button
// ---------------------------------------------------------------------------

export function DocsLink({ href, children }: { href: string; children: ReactNode }) {
  const { fireBoltFromEvent } = useBoltsContext();
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => fireBoltFromEvent(e)}
      style={{ ...ctaButtonStyle("outline", { height: "28px", cornerPx: 6 }), display: "inline-flex", textDecoration: "none", fontSize: FONT.sm }}
    >
      {children}
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Shot — a screenshot thumbnail that opens in a lightbox
// ---------------------------------------------------------------------------

export function Shot({ src, caption }: { src: string; caption: string }) {
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState(false);

  if (missing) {
    // The image hasn't been captured yet — show the slot rather than a broken
    // icon, so it's obvious what still needs a screenshot.
    return (
      <div style={{ ...card({ padding: "22px 14px" }), borderStyle: "dashed", display: "flex", flexDirection: "column", alignItems: "center", gap: "7px" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: COLORS.faint }}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10.5" r="1.5" /><path d="M21 16l-5-5-4 4-2-2-7 7" /></svg>
        <span style={{ fontSize: FONT.sm, color: COLORS.faint, textAlign: "center", lineHeight: 1.5 }}>
          Screenshot pending — {caption}
        </span>
        <span style={{ fontSize: FONT.xs, color: COLORS.faint, fontFamily: "var(--font-mono), monospace" }}>{src}</span>
      </div>
    );
  }

  return (
    <>
      <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
        <button
          onClick={() => setOpen(true)}
          style={{ ...card({ padding: "5px" }), cursor: "zoom-in", overflow: "hidden", display: "block", width: "100%" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={caption} onError={() => setMissing(true)} style={{ display: "block", width: "100%", borderRadius: "6px" }} />
        </button>
        <figcaption style={{ fontSize: FONT.xs, color: COLORS.faint, lineHeight: 1.5 }}>{caption}</figcaption>
      </figure>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px", background: "rgba(6,7,10,.82)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", animation: "fadeIn .18s both", cursor: "zoom-out" }}
        >
          <div className="te-modal-shell" onClick={(e) => e.stopPropagation()} style={{ ...modalShellStyle(), padding: "10px", maxWidth: "min(1100px,92vw)", maxHeight: "88vh", overflow: "auto" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={caption} style={{ display: "block", maxWidth: "100%", borderRadius: "9px" }} />
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Callout — a short inline note inside a section body
// ---------------------------------------------------------------------------

export function Callout({ tone = "accent", title, children }: { tone?: "accent" | "warning" | "success" | "danger"; title: string; children: ReactNode }) {
  const color =
    tone === "warning" ? COLORS.warning : tone === "success" ? COLORS.success : tone === "danger" ? COLORS.danger : COLORS.accent;
  return (
    <div style={{ ...card({ padding: "11px 13px" }), borderLeft: `2.5px solid ${color}`, display: "flex", flexDirection: "column", gap: "4px" }}>
      <span style={{ fontSize: FONT.sm, fontWeight: 700, color }}>{title}</span>
      <div style={{ fontSize: FONT.base, color: COLORS.textDim, lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// P / Bullets — body copy primitives (kept here so section content stays terse)
// ---------------------------------------------------------------------------

const bodyText: CSSProperties = { fontSize: FONT.base, color: COLORS.textDim, lineHeight: 1.7, margin: 0 };

export function P({ children }: { children: ReactNode }) {
  return <p style={bodyText}>{children}</p>;
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul style={{ ...bodyText, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "5px" }}>
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// SkillInstallerSlot — the installer, embedded in a section body
// ---------------------------------------------------------------------------

/** Section bodies are static JSX with no access to the page's state, so a
 *  successful install announces itself on the window instead; the Guide page
 *  and System Check both listen and re-run their preflight fetch. */
export const SKILLS_CHANGED_EVENT = "te:skills-changed";

export function SkillInstallerSlot() {
  return <SkillInstaller onChanged={() => window.dispatchEvent(new Event(SKILLS_CHANGED_EVENT))} />;
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, color: COLORS.text, background: "rgba(255,255,255,.05)", padding: "1px 5px", borderRadius: "5px" }}>
      {children}
    </code>
  );
}

// ---------------------------------------------------------------------------
// AccessDiagram — the two independent provider paths
// ---------------------------------------------------------------------------

/** The single most-misunderstood part of the setup: the app's REST credential
 *  and Claude's MCP access are two separate connections to the same provider.
 *  Having one working says nothing about the other. */
export function AccessDiagram({ providerLabel = "Azure DevOps" }: { providerLabel?: string }) {
  // Geometry: two source boxes on the left, one provider box on the right,
  // joined by two curves that converge but never touch. Both curves end at the
  // provider's left edge (x=336) — nothing overshoots it.
  const box = (
    x: number, y: number, w: number, h: number,
    n: string, title: string, sub: string, color: string,
  ) => {
    // Text centres in whatever width is left after the numbered badge.
    const tx = n ? x + 30 + (w - 30) / 2 : x + w / 2;
    return (
      <g>
        {/* Colours come through `style`, never the SVG presentation attribute:
            the palette is CSS custom properties and an attribute does not
            resolve var(). Applies to every fill/stroke in this file. */}
        <rect x={x} y={y} width={w} height={h} rx="10" style={{ fill: COLORS.panelBgDark, stroke: color }} strokeWidth="1.6" />
        {n && (
          <>
            <circle cx={x + 17} cy={y + h / 2} r="9" style={{ fill: color }} />
            <text x={x + 17} y={y + h / 2 + 3.6} textAnchor="middle" style={{ fill: COLORS.panelBgDark }} fontSize="10.5" fontWeight="800">{n}</text>
          </>
        )}
        <text x={tx} y={y + h / 2 - 3} textAnchor="middle" style={{ fill: COLORS.text }} fontSize="12.5" fontWeight="700">{title}</text>
        <text x={tx} y={y + h / 2 + 12} textAnchor="middle" style={{ fill: COLORS.textDim }} fontSize="10">{sub}</text>
      </g>
    );
  };

  const lane = (d: string, color: string, marker: string) => (
    <path
      d={d}
      strokeWidth="2.2"
      strokeDasharray="7 5"
      strokeLinecap="round"
      markerEnd={`url(#${marker})`}
      style={{ stroke: color, animation: "dashFlow 1.1s linear infinite" }}
    />
  );

  const legendRow = (color: string, n: string, title: string, where: ReactNode, proof: ReactNode) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "9px" }}>
      <span style={{ flex: "0 0 auto", width: "17px", height: "17px", marginTop: "1px", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: color, color: COLORS.panelBgDark, fontSize: FONT.xs, fontWeight: 800 }}>{n}</span>
      <span style={{ fontSize: FONT.sm, color: COLORS.textDim, lineHeight: 1.6 }}>
        <strong style={{ color }}>{title}</strong> — set up {where}. Proven by {proof}.
      </span>
    </div>
  );

  return (
    <div style={{ ...card({ padding: "16px" }), display: "flex", flexDirection: "column", gap: "13px" }}>
      <svg viewBox="0 0 484 172" style={{ display: "block", width: "100%", height: "auto" }} fill="none">
        <defs>
          <marker id="gdArrowA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L10 5 L0 10 Z" style={{ fill: COLORS.accent }} />
          </marker>
          <marker id="gdArrowB" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L10 5 L0 10 Z" style={{ fill: COLORS.indigo }} />
          </marker>
        </defs>

        {/* Lanes first so the boxes paint over their endpoints */}
        {lane("M148 43 C 236 43, 248 72, 330 72", COLORS.accent, "gdArrowA")}
        {lane("M148 129 C 236 129, 248 100, 330 100", COLORS.indigo, "gdArrowB")}

        <text x="243" y="28" textAnchor="middle" style={{ fill: COLORS.accent }} fontSize="10.5" fontWeight="700">reads tickets, sprints, PR status</text>
        <text x="243" y="155" textAnchor="middle" style={{ fill: COLORS.indigo }} fontSize="10.5" fontWeight="700">reads the work item, opens the PR</text>

        {box(8, 18, 152, 50, "1", "This app", "REST + your PAT", COLORS.accent)}
        {box(8, 104, 152, 50, "2", "Claude CLI", "its own MCP server", COLORS.indigo)}
        {box(336, 51, 140, 70, "", providerLabel, "one organization", COLORS.textMuted)}
      </svg>

      <div style={{ display: "flex", flexDirection: "column", gap: "7px", paddingTop: "1px", borderTop: `1px solid ${COLORS.borderSubtle}` }}>
        <span style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.text, paddingTop: "10px" }}>
          Same provider, two separate credentials. Both must work.
        </span>
        {legendRow(COLORS.accent, "1", "The app's connection", <>on the <strong style={{ color: COLORS.text }}>Settings</strong> page</>, <><strong style={{ color: COLORS.text }}>Test connection</strong></>)}
        {legendRow(COLORS.indigo, "2", "Claude's own access", <>with <Code>claude mcp add</Code>, or by leaving <em>Manage MCP</em> on</>, <>System Check&apos;s <strong style={{ color: COLORS.text }}>deep check</strong></>)}
        <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.6, marginTop: "2px" }}>
          A green connection test only proves lane 1. If lane 2 is missing, a run still starts — then spends tokens and fails the moment the skill tries to read the ticket.
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusBadge — live preflight verdict for one guide section
// ---------------------------------------------------------------------------

export type SectionStatus = "unknown" | "pass" | "warn" | "fail";

export function StatusBadge({ status, detail }: { status: SectionStatus; detail?: string }) {
  const map: Record<SectionStatus, { color: string; label: string }> = {
    unknown: { color: COLORS.faint, label: "—" },
    pass: { color: COLORS.success, label: "DONE" },
    warn: { color: COLORS.warning, label: "WARN" },
    fail: { color: COLORS.danger, label: "TO DO" },
  };
  const t = map[status];
  return (
    <span
      title={detail}
      style={{ ...pill({ color: t.color, border: COLORS.border, size: "xs", weight: 700 }), letterSpacing: ".04em", flex: "0 0 auto", transition: "color .25s" }}
    >
      {status === "pass" && (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
      )}
      {t.label}
      {detail ? <span style={{ opacity: 0.75, fontWeight: 600 }}>{detail}</span> : null}
    </span>
  );
}
