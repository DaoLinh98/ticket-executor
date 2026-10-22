"use client";

import type { ReactNode } from "react";
import { outputKind } from "@/lib/runTrace";
import { COLORS, FONT, card, codeBlock, pill, sectionCaption, tintedCard, toneTint } from "@/lib/ui";
import { MiniIcon } from "./icons";

type Blocker = { file?: string; issue?: string };
type Verification = { tests?: string; build?: string; acceptanceCriteria?: string };

function asList<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function Badge({ ok, label, warn }: { ok: boolean; label: string; warn?: boolean }) {
  const color = warn ? COLORS.warning : ok ? COLORS.success : COLORS.danger;
  return <span style={{ ...pill({ color, background: toneTint(color, 14), border: toneTint(color, 45), size: "sm" }) }}>{label}</span>;
}

function Chip({ label, value }: { label: string; value: string }) {
  const color = value === "passed" || value === "met" ? COLORS.success : value === "failed" ? COLORS.danger : value === "partial" ? COLORS.warning : COLORS.textMuted;
  return (
    <span style={pill({ color, background: toneTint(color, 12), border: toneTint(color, 35), size: "sm" })}>
      <span style={{ color: COLORS.textMuted, fontWeight: 500 }}>{label}</span>
      {value || "—"}
    </span>
  );
}

function BlockerList({ items, tone }: { items: Blocker[]; tone: "danger" | "warning" }) {
  const color = tone === "danger" ? COLORS.danger : COLORS.warning;
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
      {items.map((b, i) => (
        <li key={i} style={{ display: "flex", gap: "10px", padding: "9px 11px", borderRadius: "9px", border: `1px solid ${toneTint(color, 30)}`, background: toneTint(color, 7) }}>
          <span style={{ flex: "0 0 auto", width: "20px", height: "20px", borderRadius: "6px", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: FONT.xs, fontWeight: 800, color, background: toneTint(color, 18) }}>{i + 1}</span>
          <div style={{ minWidth: 0 }}>
            {b.file ? <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, color: COLORS.indigo, wordBreak: "break-all" }}>{b.file}</div> : null}
            <div style={{ fontSize: FONT.md, color: COLORS.textSoft, lineHeight: 1.55 }}>{b.issue}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={sectionCaption()}>{title}</span>
      {children}
    </div>
  );
}

function Review({ o }: { o: Record<string, unknown> }) {
  const pass = o.verdict === "pass";
  const blockers = asList<Blocker>(o.blockers);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <Badge ok={pass} label={pass ? "Review passed" : "Changes required"} />
        <span style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>{pass ? "Nothing blocks the pull request." : `${blockers.length} blocker(s) handed to the fix step verbatim.`}</span>
      </div>
      {blockers.length ? <BlockerList items={blockers} tone="danger" /> : null}
    </>
  );
}

function Gate({ o }: { o: Record<string, unknown> }) {
  const passed = o.passed === true;
  const blockers = asList<Blocker>(o.blockers);
  const companions = asList<{ name?: string; branch?: string }>(o.companions);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <Badge ok={passed} label={passed ? "Test gate passed" : "Test gate refused"} />
        {o.rootChanged === false ? <span style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>Root repository unchanged.</span> : null}
      </div>
      {blockers.length ? <BlockerList items={blockers} tone="warning" /> : null}
      {companions.length ? (
        <Section title="Other repositories changed">
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {companions.map((c, i) => (
              <span key={i} style={pill({ color: COLORS.indigo, border: COLORS.border, size: "sm" })}>{c.name} · {c.branch || "no branch"}</span>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

function Delivery({ o }: { o: Record<string, unknown> }) {
  const v = (o.verification ?? {}) as Verification;
  const deviations = asList<{ what?: string; why?: string }>(o.deviations);
  const outcome = str(o.outcome);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        {outcome ? <Badge ok label={outcome.replace(/-/g, " ")} warn={outcome === "no-fix-needed"} /> : null}
        <Badge ok={o.committed === true} label={o.committed ? "Committed" : "Nothing committed"} warn={!o.committed} />
        {str(o.branch) ? <span style={{ ...pill({ color: COLORS.indigo, border: COLORS.border, size: "sm" }), fontFamily: "var(--font-mono), monospace" }}>{str(o.branch)}</span> : null}
      </div>
      {o.verification ? (
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <Chip label="tests" value={str(v.tests)} />
          <Chip label="build" value={str(v.build)} />
          <Chip label="acceptance" value={str(v.acceptanceCriteria)} />
        </div>
      ) : null}
      {str(o.summary) ? <div style={{ fontSize: FONT.md, color: COLORS.textSoft, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{str(o.summary)}</div> : null}
      {str(o.testExemption) ? (
        <Section title="Test exemption">
          <div style={{ fontSize: FONT.md, color: COLORS.textDim }}>{str(o.testExemption)}</div>
        </Section>
      ) : null}
      {deviations.length ? (
        <Section title={`Deviations from the plan (${deviations.length})`}>
          <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "5px", fontSize: FONT.md, color: COLORS.textSoft }}>
            {deviations.map((d, i) => (
              <li key={i}><strong style={{ color: COLORS.text }}>{d.what}</strong>{d.why ? <span style={{ color: COLORS.textDim }}> — {d.why}</span> : null}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      {str(o.qaReply) ? (
        <Section title="Reply to QA">
          <div style={{ ...codeBlock(), whiteSpace: "pre-wrap" }}>{str(o.qaReply)}</div>
        </Section>
      ) : null}
    </>
  );
}

function Publish({ o }: { o: Record<string, unknown> }) {
  const prs = asList<{ repo?: string; prUrl?: string; pushed?: boolean }>(o.prs);
  const links = [...(str(o.prUrl) ? [{ repo: "", prUrl: str(o.prUrl), pushed: o.pushed === true }] : []), ...prs.filter((p) => p.prUrl && p.prUrl !== o.prUrl)];
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        {typeof o.pushed === "boolean" ? <Badge ok={o.pushed} label={o.pushed ? "Pushed" : "Not pushed"} /> : null}
        {typeof o.isDraft === "boolean" ? <Badge ok label={o.isDraft ? "Draft PR" : "Published PR"} warn={!o.isDraft} /> : null}
        {o.reusedExisting === true ? <Badge ok label="Reused existing PR" /> : null}
        {typeof o.linked === "boolean" ? <Badge ok={o.linked} label={o.linked ? "Ticket linked" : "Not linked"} warn={!o.linked} /> : null}
        {typeof o.threadsReplied === "number" ? <Badge ok label={`${o.threadsReplied} thread(s) answered`} /> : null}
      </div>
      {links.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {links.map((p, i) => (
            <a key={i} href={p.prUrl} target="_blank" rel="noreferrer" style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, color: COLORS.indigo, wordBreak: "break-all" }}>
              {p.repo ? `${p.repo}: ` : ""}{p.prUrl}
            </a>
          ))}
        </div>
      ) : null}
    </>
  );
}

function Lesson({ o }: { o: Record<string, unknown> }) {
  return (
    <>
      <Badge ok={o.recorded === true} label={o.recorded ? "Lesson recorded" : "Nothing reusable to record"} warn={!o.recorded} />
      {str(o.lesson) ? <div style={{ fontSize: FONT.md, color: COLORS.textSoft, lineHeight: 1.6 }}>{str(o.lesson)}</div> : null}
    </>
  );
}

export default function OutputCard({ output, running }: { output: Record<string, unknown>; running: boolean }) {
  const kind = outputKind(output);
  const blocked = output.blocked as { is?: boolean; reason?: string } | undefined;
  const empty = !Object.keys(output).length;
  return (
    <div style={{ ...card({ padding: "14px 15px" }), display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <MiniIcon name="arrow-out" size={14} color={COLORS.accent} />
        <span style={sectionCaption()}>Step result</span>
      </div>
      {empty ? (
        <div style={{ fontSize: FONT.sm, color: COLORS.faint }}>{running ? "The result appears here the moment this step reports it." : "This step reported no structured result."}</div>
      ) : (
        <>
          {blocked?.is ? (
            <div style={{ ...tintedCard("danger", { padding: "10px 12px", radius: "9px" }), fontSize: FONT.md, color: COLORS.textSoft }}>
              <strong style={{ color: COLORS.danger }}>Blocked</strong> — {blocked.reason || "no reason given"}
            </div>
          ) : null}
          {kind === "review" ? <Review o={output} /> : null}
          {kind === "gate" ? <Gate o={output} /> : null}
          {kind === "delivery" ? <Delivery o={output} /> : null}
          {kind === "publish" ? <Publish o={output} /> : null}
          {kind === "lesson" ? <Lesson o={output} /> : null}
          <details>
            <summary style={{ cursor: "pointer", fontSize: FONT.sm, color: COLORS.textMuted, minHeight: "28px" }}>Raw contract JSON</summary>
            <pre style={{ ...codeBlock({ fontSize: FONT.sm }), marginTop: "8px", maxHeight: "320px", overflow: "auto" }}>{JSON.stringify(output, null, 2)}</pre>
          </details>
        </>
      )}
    </div>
  );
}
