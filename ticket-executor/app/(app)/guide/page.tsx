"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import LoadingRing from "../../ticket-executor/LoadingRing";
import { useBoltsContext } from "../../BoltsContext";
import { SECTIONS } from "../../guide/content";
import { DocsLink, SKILLS_CHANGED_EVENT, StatusBadge } from "../../guide/parts";
import type { SectionStatus } from "../../guide/parts";
import { COLORS, FONT, card, clipCorner, ctaButtonStyle, fieldLabel, pill, ringBorder, tintedCard } from "@/lib/ui";
import type { PreflightResult } from "@/lib/preflight";
import ProviderBadge from "../ProviderBadge";
import PageHeading from "../PageHeading";

/** Roll the checks of one preflight group up into a single section verdict:
 *  any blocking failure wins, then any warning, otherwise pass. */
function rollUp(result: PreflightResult | null, group?: string): { status: SectionStatus; detail?: string } {
  if (!group) return { status: "unknown" };
  if (!result) return { status: "unknown" };
  const rows = result.checks.filter((c) => c.group === group);
  if (!rows.length) return { status: "unknown" };
  const failed = rows.filter((c) => c.status === "fail" && c.level === "blocker");
  if (failed.length) return { status: "fail", detail: `${failed.length}` };
  const warned = rows.filter((c) => c.status !== "pass");
  if (warned.length) return { status: "warn", detail: `${warned.length}` };
  return { status: "pass" };
}

export default function GuidePage() {
  const { fireBoltFromEvent } = useBoltsContext();
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [touched, setTouched] = useState(false);
  const bodyRefs = useRef<Record<string, HTMLElement | null>>({});

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/preflight");
      const data = await r.json();
      if (r.ok && data.checks) setResult(data as PreflightResult);
    } catch {
      /* the guide is still fully readable without live status */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // An install from the embedded SkillInstaller changes what preflight sees.
  useEffect(() => {
    window.addEventListener(SKILLS_CHANGED_EVENT, load);
    return () => window.removeEventListener(SKILLS_CHANGED_EVENT, load);
  }, [load]);

  const verdicts = useMemo(
    () => SECTIONS.map((s) => ({ id: s.id, ...rollUp(result, s.checkGroup) })),
    [result],
  );

  // Once the live status lands, open what still needs doing and collapse what
  // is done — unless the reader has already started clicking around.
  useEffect(() => {
    if (!result || touched) return;
    const next: Record<string, boolean> = {};
    let firstOpen = "";
    for (const v of verdicts) {
      const needsWork = v.status === "fail" || v.status === "warn";
      next[v.id] = needsWork || v.status === "unknown";
      if (needsWork && !firstOpen) firstOpen = v.id;
    }
    // Everything green: open the first section so the page isn't a wall of headers.
    if (!Object.values(next).some(Boolean)) next[SECTIONS[0].id] = true;
    setOpen(next);
    const target = firstOpen || (typeof window !== "undefined" ? window.location.hash.slice(1) : "");
    if (target) {
      requestAnimationFrame(() => {
        bodyRefs.current[target]?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [result, verdicts, touched]);

  // Deep-link support: /guide#mcp from a System Check "How to fix" link.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash || !SECTIONS.some((s) => s.id === hash)) return;
    setTouched(true);
    setOpen((o) => ({ ...o, [hash]: true }));
    requestAnimationFrame(() => {
      bodyRefs.current[hash]?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const toggle = (id: string) => {
    setTouched(true);
    setOpen((o) => ({ ...o, [id]: !o[id] }));
  };

  const jump = (id: string) => {
    setTouched(true);
    setOpen((o) => ({ ...o, [id]: true }));
    requestAnimationFrame(() => bodyRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const blockers = verdicts.filter((v) => v.status === "fail").length;
  const warnings = verdicts.filter((v) => v.status === "warn").length;
  const banner = !result
    ? null
    : blockers > 0
      ? { tone: "danger" as const, color: COLORS.danger, title: `${blockers} step${blockers === 1 ? "" : "s"} still to do`, text: "The steps below are opened where your setup needs work. Work top to bottom — each one is a run that would otherwise fail." }
      : warnings > 0
        ? { tone: "warning" as const, color: COLORS.warning, title: "Almost there", text: "Nothing blocks a run. The steps marked WARN are the ones that commonly bite later." }
        : { tone: "success" as const, color: COLORS.success, title: "Your machine is set up", text: "Every setup step is done. The remaining sections are about getting better results out of each run." };

  return (
    <div style={{ position: "relative", height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column", color: COLORS.text, ["--accent" as string]: COLORS.accent }}>
      <header style={{ position: "relative", zIndex: 1, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "14px", padding: "0 28px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "rgba(14,17,23,.72)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <PageHeading title="Guide" kicker="D-AGENT · SETUP PATH" icon={<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>} />
        <div style={{ flex: 1 }} />
        <Link
          href="/system-check"
          onClick={(e) => fireBoltFromEvent(e)}
          style={{ ...ctaButtonStyle("outline", { height: "30px", cornerPx: 7 }), textDecoration: "none", fontSize: FONT.sm }}
        >
          Open System Check →
        </Link>
        <ProviderBadge />
      </header>

      <main className="te-scroll te-scroll--smooth" style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", padding: "28px", background: "linear-gradient(110deg,rgba(6,7,10,.5) 0%,rgba(6,7,10,.22) 52%,rgba(6,7,10,0) 100%)" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: "80px" }}><LoadingRing size={120} /></div>
        ) : (
          <div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>
            {banner && (
              <div style={{ ...tintedCard(banner.tone), display: "flex", flexDirection: "column", gap: "5px", animation: "fadeUp .32s both" }}>
                <span style={{ fontSize: FONT.md, fontWeight: 700, color: banner.color }}>{banner.title}</span>
                <span style={{ fontSize: FONT.base, color: COLORS.textDim, lineHeight: 1.6 }}>{banner.text}</span>
              </div>
            )}

            {/* Stepper — jump list with the live verdict per step */}
            <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
              <span style={fieldLabel()}>SETUP PATH</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                {SECTIONS.map((s, i) => {
                  const v = verdicts[i];
                  const color =
                    v.status === "pass" ? COLORS.success
                      : v.status === "warn" ? COLORS.warning
                        : v.status === "fail" ? COLORS.danger
                          : COLORS.textMuted;
                  return (
                    <button
                      key={s.id}
                      onClick={(e) => { fireBoltFromEvent(e); jump(s.id); }}
                      title={s.title}
                      style={{ ...pill({ color, border: COLORS.border, size: "sm", weight: 600 }), cursor: "pointer", maxWidth: "230px", animation: "fadeUp .3s both", animationDelay: `${i * 45}ms` }}
                    >
                      <span style={{ color: COLORS.faint, fontWeight: 700 }}>{i + 1}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sections */}
            {SECTIONS.map((s, i) => {
              const v = verdicts[i];
              const isOpen = !!open[s.id];
              const attention = v.status === "fail" || v.status === "warn";
              const shell = attention
                ? tintedCard(v.status === "fail" ? "danger" : "warning", { padding: "0", radius: "12px" })
                : card({ padding: "0", radius: "12px" });
              return (
                <section
                  key={s.id}
                  id={s.id}
                  ref={(el) => { bodyRefs.current[s.id] = el; }}
                  style={{ ...shell, overflow: "hidden", scrollMarginTop: "12px", animation: "fadeUp .34s both", animationDelay: `${120 + i * 55}ms` }}
                >
                  {/* Header */}
                  <button
                    onClick={(e) => { fireBoltFromEvent(e); toggle(s.id); }}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
                  >
                    <span
                      style={{
                        flex: "0 0 auto",
                        width: "26px",
                        height: "26px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: FONT.sm,
                        fontWeight: 700,
                        color: isOpen ? "#0B0C10" : COLORS.textDim,
                        ...(isOpen
                          ? ringBorder({ fill: COLORS.accent, variant: "filled", shape: "pill", duration: 3.4 })
                          : { ...card({ padding: "0", radius: "999px" }) }),
                      }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                      <span style={{ fontSize: FONT.md, fontWeight: 700, color: COLORS.text }}>{s.title}</span>
                      <span style={{ fontSize: FONT.sm, color: COLORS.textDim, lineHeight: 1.5 }}>{s.blurb}</span>
                    </span>
                    <span style={{ flex: 1 }} />
                    {s.checkGroup && <StatusBadge status={v.status} detail={v.detail} />}
                    <svg
                      width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.textMuted} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                      style={{ flex: "0 0 auto", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .28s ease" }}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>

                  {/* Body — grid-rows trick so it animates without measuring height */}
                  <div style={{ display: "grid", gridTemplateRows: isOpen ? "1fr" : "0fr", transition: "grid-template-rows .3s ease" }}>
                    <div style={{ overflow: "hidden" }}>
                      <div style={{ padding: "2px 16px 16px", display: "flex", flexDirection: "column", gap: "12px", borderTop: `1px solid ${COLORS.borderSubtle}`, marginTop: "2px", paddingTop: "14px" }}>
                        {s.body}
                        {(s.docs.length > 0 || s.checkGroup) && (
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", paddingTop: "2px" }}>
                            {s.docs.map((d) => (
                              <DocsLink key={d.href} href={d.href}>{d.label}</DocsLink>
                            ))}
                            {s.checkGroup && (
                              <Link
                                href="/system-check"
                                onClick={(e) => fireBoltFromEvent(e)}
                                style={{ fontSize: FONT.sm, color: COLORS.accent, textDecoration: "none", fontWeight: 600 }}
                              >
                                Verify in System Check →
                              </Link>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}

            {/* Payoff */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "9px", paddingTop: "4px", paddingBottom: "8px" }}>
              {blockers === 0 ? (
                <Link
                  href="/ticket-execution"
                  onClick={(e) => fireBoltFromEvent(e)}
                  style={{ ...ctaButtonStyle("primary", { height: "34px" }), textDecoration: "none" }}
                >
                  Go to Ticket Execution
                </Link>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", height: "34px", padding: "0 16px", fontSize: FONT.sm, fontWeight: 600, color: COLORS.textMuted, border: `1.5px solid ${COLORS.border}`, clipPath: clipCorner(7) }}>
                  Finish the steps above to continue
                </span>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
