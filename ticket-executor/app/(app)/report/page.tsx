"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { reveal } from "../../Motion";
import LoadingRing from "../../ticket-executor/LoadingRing";
import SelectMenu from "../../SelectMenu";
import { useToast } from "../ToastProvider";
import { useBoltsContext } from "../../BoltsContext";
import {
  COLORS,
  FONT,
  card,
  codeBlock,
  ctaButtonStyle,
  fieldInput,
  pill,
  sectionCaption,
  statusPill,
  tintedCard,
  typeBadge,
} from "@/lib/ui";
import ProviderBadge from "../ProviderBadge";
import PageHeading from "../PageHeading";
import NotificationCenter from "../NotificationCenter";
import { useNotifications } from "../NotificationsProvider";
import PageToolbar from "../PageToolbar";
import { CONNECTION_CHANGED_EVENT } from "../../connectionEvents";
import { copyText } from "./copyText";
import {
  PROGRESS_OPTIONS,
  REPORT_TASKS,
  buildReport,
  defaultEntry,
  emptyDraft,
  formatReportDay,
  isListed,
  ticketLine,
  type ReportDraftState,
  type ReportEntry,
} from "@/lib/report";
import type { Ticket } from "@/lib/types";

// The day's work report, written by ticking boxes instead of by hand.
//
// Every line it emits is one the developer used to copy off a work item with
// Azure DevOps' own copy button, so the format is not this page's to invent —
// `lib/report.ts` owns it, and owns it without a database so the text can be
// asserted. The page is the ticking, the draft and the clipboard.

type ReportData = {
  configured: boolean;
  connected?: boolean;
  notice?: string;
  error?: string;
  day: string;
  identity?: { email: string; name: string };
  tickets: Ticket[];
  handedOff?: string[];
  draft: ReportDraftState;
  sent?: SentReport | null;
  previous?: SentReport | null;
  slack?: boolean;
};

type SentReport = { day: string; text: string; sentAt: string };

const sentTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The project a work item belongs to: the first segment of its area path. */
const projectOf = (t: Ticket): string => (t.areaPath || "").split("\\")[0] || t.project;

/** The browser's own day. Never computed during render: the server has a
 *  different clock and a different zone, and the mismatch is a hydration error. */
function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ReportPage() {
  const { fireBoltFromEvent } = useBoltsContext();
  const [day, setDay] = useState("");
  const [data, setData] = useState<ReportData | null>(null);
  const [draft, setDraft] = useState<ReportDraftState>(emptyDraft(""));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  // What the server is known to hold, so an edit is saved and a reload is not
  // saved straight back.
  const savedRef = useRef("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useToast();
  const { refresh: refreshNotifications } = useNotifications();

  useEffect(() => { setDay(localDay()); }, []);

  const load = useCallback(async (d: string) => {
    if (!d) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ day: d });
      const res: ReportData = await fetch("/api/report?" + qs.toString(), { cache: "no-store" }).then((r) => r.json());
      if (res.error) setError(res.error);
      setData(res);
      const loaded = res.draft ?? emptyDraft(res.identity?.name ?? "");
      setDraft(loaded);
      savedRef.current = JSON.stringify(loaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(day); }, [day, load]);

  // The organization switched in the header — this list belongs to the old one.
  useEffect(() => {
    const onChanged = () => { load(day); };
    window.addEventListener(CONNECTION_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONNECTION_CHANGED_EVENT, onChanged);
  }, [load, day]);

  // The draft is the same fact on the phone and on the laptop, so an edit made
  // on one has to reach the other. Written on a short delay — a checkbox is
  // clicked in bursts — and re-read whenever this copy comes back into view,
  // but never while an edit of its own is still on its way to the server.
  useEffect(() => {
    if (!day || loading) return;
    const body = JSON.stringify(draft);
    if (body === savedRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null;
      try {
        const qs = new URLSearchParams({ day });
        const r = await fetch("/api/report?" + qs.toString(), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ draft }),
        });
        if (!r.ok) throw new Error(`PUT /api/report -> ${r.status}`);
        savedRef.current = body;
      } catch (e) {
        // Not swallowed: an unsaved draft is one that will not be there on the
        // phone, which is the whole reason it is on the server.
        showToast(`Draft not saved — ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    }, 600);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [draft, day, loading, showToast]);

  useEffect(() => {
    const onShow = () => {
      if (document.hidden || saveTimer.current) return;
      load(day);
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pageshow", onShow);
    };
  }, [load, day]);

  const tickets = data?.tickets ?? [];
  const handedOff = new Set(data?.handedOff ?? []);
  // An untouched ticket has no stored entry — its defaults are computed here
  // rather than written into the draft, so nothing is persisted until something
  // is actually chosen, and a ticket that leaves the sprint leaves no residue.
  const entryOf = (t: Ticket): ReportEntry => draft.entries[String(t.id)] ?? defaultEntry(t);

  const patch = (t: Ticket, p: Partial<ReportEntry>) =>
    setDraft((d) => ({
      ...d,
      entries: { ...d.entries, [String(t.id)]: { ...(d.entries[String(t.id)] ?? defaultEntry(t)), ...p } },
    }));

  const name = draft.name || data?.identity?.name || "";
  const text = useMemo(
    () => buildReport({ day: day || localDay(), name, tickets, draft }),
    [day, name, tickets, draft]
  );

  const onCopy = async (e: { clientX: number; clientY: number }) => {
    fireBoltFromEvent(e);
    const ok = await copyText(text);
    if (ok) showToast("Report copied — paste it into the group.");
    else showToast("Could not reach the clipboard. Copy the preview below by hand.", "warning");
  };

  const onSendSlack = async (e: { clientX: number; clientY: number }) => {
    if (sending) return;
    fireBoltFromEvent(e);
    setSending(true);
    try {
      const qs = new URLSearchParams({ day });
      const r = await fetch("/api/report/slack?" + qs.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, draft }),
      });
      const res = (await r.json().catch(() => ({}))) as { error?: string; sent?: SentReport };
      if (!r.ok) throw new Error(res.error || `POST /api/report/slack -> ${r.status}`);
      savedRef.current = JSON.stringify(draft);
      setData((d) => (d ? { ...d, sent: res.sent ?? null } : d));
      showToast("Report sent to Slack.");
      void refreshNotifications({ force: true });
    } catch (err) {
      showToast(`Not sent — ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setSending(false);
    }
  };

  const selectedCount = tickets.filter((t) => isListed(entryOf(t))).length;

  return (
    <div style={{ position: "relative", height: "var(--te-app-h)", overflow: "hidden", display: "flex", flexDirection: "column", color: COLORS.text, ["--accent" as string]: COLORS.accent }}>
      <header className="te-page-header" style={{ position: "relative", zIndex: 30, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "14px", padding: "0 28px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "var(--te-header-bg)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <PageHeading title="Report" kicker="D-AGENT · DAILY" icon={<path d="M8 3h8l4 4v14H4V3zM8 12h8M8 16h5" />} />
        <div style={{ flex: 1 }} />
        <NotificationCenter />
        <ProviderBadge />
      </header>

      <PageToolbar>
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          aria-label="Report date"
          style={{ ...fieldInput({ height: "32px" }), width: "clamp(140px, 40vw, 170px)" }}
        />
        <input
          value={name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="Your name"
          aria-label="Reported by"
          style={{ ...fieldInput({ height: "32px" }), width: "clamp(150px, 45vw, 210px)" }}
        />
      </PageToolbar>

      <main className="te-scroll te-main" style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", padding: "28px", background: "var(--te-page-veil)" }}>
        <div style={{ maxWidth: "980px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "18px" }}>
          {error && (
            <div style={tintedCard("danger")}>
              <div style={{ fontSize: FONT.base, color: COLORS.danger, fontWeight: 600 }}>{error}</div>
            </div>
          )}
          {data && !data.configured && data.notice && (
            <div style={tintedCard("warning")}>
              <div style={{ fontSize: FONT.base, color: COLORS.warning, fontWeight: 600 }}>{data.notice}</div>
            </div>
          )}

          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", paddingTop: "60px" }}><LoadingRing size={120} /></div>
          ) : (
            <>
              {data?.previous && (
                <motion.section {...reveal()} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={sectionCaption()}>Last sent report</span>
                    <span style={{ fontSize: FONT.sm, color: COLORS.textDim }}>
                      {formatReportDay(data.previous.day)} · sent {sentTime(data.previous.sentAt)}
                    </span>
                  </div>
                  <pre style={{ ...codeBlock({ padding: "14px 16px" }), opacity: 0.8 }}>{data.previous.text}</pre>
                </motion.section>
              )}

              <section style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={sectionCaption()}>Assigned to you</span>
                  <span style={{ fontSize: FONT.sm, color: COLORS.textDim }}>{selectedCount} of {tickets.length} in this report</span>
                </div>

                {REPORT_TASKS.map((task, i) => (
                  <motion.div key={task.id} {...reveal({ from: "left", index: i })} style={{ ...card({ padding: "6px 13px" }), display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: FONT.md, fontWeight: 700, color: COLORS.text }}>{task.label}</span>
                    <div style={{ flex: 1 }} />
                    <Check
                      label="Today"
                      checked={draft.tasks[task.id].today}
                      onChange={(v) => setDraft((d) => ({ ...d, tasks: { ...d.tasks, [task.id]: { ...d.tasks[task.id], today: v } } }))}
                    />
                    <Check
                      label="Tomorrow"
                      checked={draft.tasks[task.id].tomorrow}
                      onChange={(v) => setDraft((d) => ({ ...d, tasks: { ...d.tasks, [task.id]: { ...d.tasks[task.id], tomorrow: v } } }))}
                    />
                  </motion.div>
                ))}

                {tickets.length === 0 ? (
                  <div style={{ ...card(), fontSize: FONT.base, color: COLORS.textDim }}>
                    {data?.notice || "Nothing open is assigned to you right now."}
                  </div>
                ) : (
                  tickets.map((t, i) => {
                    const e = entryOf(t);
                    return (
                      <motion.div key={t.id} {...reveal({ index: i })} style={{ ...card({ padding: "11px 13px" }), display: "flex", flexDirection: "column", gap: "9px", opacity: isListed(e) ? 1 : 0.72 }}>
                        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "5px" }}>
                          <span style={{ fontSize: FONT.md, fontWeight: 600, color: COLORS.text, lineHeight: 1.45, overflowWrap: "anywhere" }}>{ticketLine(t)}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap" }}>
                            <span style={typeBadge(t.type)}>{t.type}</span>
                            <span style={statusPill(t.status)}>{t.boardColumn || t.status}</span>
                            {/* The list spans the whole organization, so which
                                project a row came from is part of reading it.
                                Taken off the area path's first segment, not
                                `Ticket.project` — that is its *last* segment,
                                which is a team or a component, not the project. */}
                            {projectOf(t) && <span style={pill({ color: COLORS.textDim, size: "xs" })}>{projectOf(t)}</span>}
                            {handedOff.has(t.id) && <span style={pill({ color: COLORS.warning, size: "xs" })}>→ {t.assignee || "Unassigned"}</span>}
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                          {/* Today and Tomorrow are not a choice between two:
                              work carried overnight is reported in both. */}
                          <Check label="Today" checked={e.today} onChange={(v) => patch(t, { today: v })} />
                          {/* Progress belongs to Today only — tomorrow's line is
                              intent, not state — so the control follows it. */}
                          {e.today && (
                            <div style={{ width: "140px" }}>
                              <SelectMenu
                                value={e.progress}
                                onChange={(v) => patch(t, { progress: v })}
                                options={[...PROGRESS_OPTIONS]}
                                ariaLabel="Progress"
                                variant="filter"
                                alwaysGlow
                                maxHeight="180px"
                              />
                            </div>
                          )}
                          <Check label="Tomorrow" checked={e.tomorrow} onChange={(v) => patch(t, { tomorrow: v })} />
                          <div style={{ flex: 1 }} />
                          <Check label="Comment" checked={e.comment} onChange={(v) => patch(t, { comment: v })} />
                          <Check label="Block" checked={e.block} onChange={(v) => patch(t, { block: v })} />
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </section>

              <motion.section {...reveal()} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={sectionCaption()}>Preview</span>
                  <div style={{ flex: 1 }} />
                  {data?.slack && (
                    <button onClick={onSendSlack} disabled={sending} style={{ ...ctaButtonStyle("primary"), opacity: sending ? 0.55 : 1, cursor: sending ? "default" : "pointer" }}>
                      <span style={{ position: "relative", zIndex: 1, display: "inline-flex" }}>
                        {sending ? <LoadingRing size={14} /> : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></svg>
                        )}
                      </span>
                      <span style={{ position: "relative", zIndex: 1 }}>Send to Slack</span>
                    </button>
                  )}
                  <button onClick={onCopy} style={ctaButtonStyle(data?.slack ? "outline" : "primary")}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></svg>
                  </button>
                </div>
                {data?.sent && (
                  <div style={{ display: "flex" }}>
                    <span style={{ ...pill({ color: data.sent.text === text ? COLORS.success : COLORS.warning, size: "xs" }), whiteSpace: "nowrap" }}>
                      {data.sent.text === text ? "Sent" : "Changed since sent"} · {sentTime(data.sent.sentAt)}
                    </span>
                  </div>
                )}
                <pre style={codeBlock({ padding: "14px 16px" })}>{text}</pre>
                <span style={{ fontSize: FONT.sm, color: COLORS.faint }}>
                  Copy and Send to Slack both use exactly this.
                </span>
              </motion.section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/** A labelled checkbox with a tap target the phone can actually hit. The label
 *  is part of the target, which is what makes 18px of checkbox enough. */
function Check({ label, checked, onChange, strong }: { label: string; checked: boolean; onChange: (v: boolean) => void; strong?: boolean }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: "7px", minHeight: "40px", cursor: "pointer", userSelect: "none" }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(ev) => onChange(ev.target.checked)}
        aria-label={label || "Include in report"}
        style={{ width: "18px", height: "18px", accentColor: COLORS.accent, cursor: "pointer", flex: "0 0 auto" }}
      />
      {label && (
        <span style={{ fontSize: FONT.base, fontWeight: strong ? 700 : 600, color: checked ? COLORS.text : COLORS.textDim, whiteSpace: "nowrap" }}>{label}</span>
      )}
    </label>
  );
}
