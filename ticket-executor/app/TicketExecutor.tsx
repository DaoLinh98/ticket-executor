"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Reactor from "./Reactor";
import { BoltLayer, useBolts } from "./Bolts";
import type { ExecStatus, LogLine, Ticket } from "@/lib/types";
import {
  EXEC_COLOR,
  EXEC_LABEL,
  STEPS,
  avatar,
  branchOf,
  execDot,
  initials,
  statusColor,
  statusPill,
  typeBadge,
} from "@/lib/ui";

const ACCENT = "#FB7250";
const DEFAULT_SKILL = "implement-ticket";

type ExecView = {
  executionId?: string;
  status: ExecStatus;
  logLines: LogLine[];
  resultText: string;
  error: string;
  duration?: string;
  currentStep?: number;
};

type SettingsView = {
  org: string;
  pat: string;
  hasPat: boolean;
  rootRepo: string;
  defaultProject: string;
  sprint: string;
};

const chipClip = "polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)";
const cutClip = "polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)";

// Heuristic: derive how many of the 7 steps a running log has reached.
const STEP_PATTERNS = [
  /\bcd \b|working director|resolv/i,
  /\bado\b|mcp|reading ticket|ticket #|fetch.*ticket/i,
  /checkout -b|create.*branch|switched to/i,
  /implement|editing|writing|creat.*file|modif|\.tsx?|\.cs\b/i,
  /\btest\b|lint|verif|npm run|dotnet|build/i,
  /commit/i,
  /pull request|\bpr #|gh pr/i,
];
function deriveStep(logLines: LogLine[]): number {
  const text = logLines.map((l) => l.text).join("\n");
  let reached = 0;
  for (let i = 0; i < STEP_PATTERNS.length; i++) if (STEP_PATTERNS[i].test(text)) reached = i + 1;
  return reached;
}

export default function TicketExecutor() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadError, setLoadError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");
  const [tab, setTab] = useState<"overview" | "execution" | "result">("overview");
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string } | null>(null);
  const [execs, setExecs] = useState<Record<string, ExecView>>({});
  const [overrides, setOverrides] = useState<Record<string, Partial<Record<"area" | "skill" | "rootRepo", string>>>>({});
  const [settings, setSettings] = useState<SettingsView>({
    org: "",
    pat: "",
    hasPat: false,
    rootRepo: "C:\\repos",
    defaultProject: "",
    sprint: "",
  });

  const { bolts, flashes, fireBolt, fireBoltFromEvent, statusBoltAnchor } = useBolts();
  const logRef = useRef<HTMLDivElement>(null);
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- data load ----
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/tickets");
        const data = await r.json();
        if (data.error) setLoadError(data.error);
        const list: Ticket[] = data.tickets ?? [];
        setTickets(list);
        if (list.length) setSelectedId((prev) => prev || list[0].id);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
    (async () => {
      try {
        const r = await fetch("/api/settings");
        const data = await r.json();
        if (data.settings) setSettings(data.settings);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      Object.values(pollTimers.current).forEach(clearInterval);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // autoscroll terminal
  useEffect(() => {
    if (tab === "execution" && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  });

  const showToast = useCallback((msg: string, ms = 4000) => {
    setToast({ msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  // ---- per-ticket resolved config ----
  const getArea = (t: Ticket) => overrides[t.id]?.area || t.project || settings.defaultProject;
  const getSkill = (t: Ticket) => overrides[t.id]?.skill || DEFAULT_SKILL;
  const getRootRepo = (t: Ticket) => overrides[t.id]?.rootRepo || settings.rootRepo || "C:\\repos";
  const setOverride =
    (ticketId: string, field: "area" | "skill" | "rootRepo") =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setOverrides((s) => ({ ...s, [ticketId]: { ...(s[ticketId] || {}), [field]: value } }));
      };

  // ---- polling ----
  const startPolling = useCallback(
    (ticketId: string, executionId: string) => {
      if (pollTimers.current[executionId]) return;
      const poll = async () => {
        try {
          const r = await fetch(`/api/executions/${executionId}`);
          const data = await r.json();
          const ex = data.execution;
          if (!ex) return;
          setExecs((s) => ({
            ...s,
            [ticketId]: {
              executionId,
              status: ex.status,
              logLines: ex.logLines ?? [],
              resultText: ex.resultText ?? "",
              error: ex.errorMessage ?? "",
              duration: ex.duration,
              currentStep: ex.currentStep,
            },
          }));
          if (ex.status === "completed" || ex.status === "failed") {
            clearInterval(pollTimers.current[executionId]);
            delete pollTimers.current[executionId];
            try {
              window.__reactor?.setMode(ex.status === "completed" ? "completed" : "idle");
            } catch { }
            if (ex.status === "completed") showToast(`#${ticketId} completed — result ready`);
            else showToast(`#${ticketId} failed`);
          }
        } catch {
          /* keep polling */
        }
      };
      pollTimers.current[executionId] = setInterval(poll, 1200);
      poll();
    },
    [showToast]
  );

  const startImplement = useCallback(
    async (e?: MouseEvent) => {
      fireBoltFromEvent(e, { big: true });
      const t = tickets.find((x) => x.id === selectedId);
      if (!t) return;
      const cur = execs[t.id];
      if (cur && cur.status === "running") return;
      setTab("execution");
      setExecs((s) => ({
        ...s,
        [t.id]: { status: "running", logLines: [], resultText: "", error: "" },
      }));
      try {
        window.__reactor?.setMode("running");
      } catch { }
      try {
        const r = await fetch(`/api/tickets/${t.id}/implement`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            skillName: getSkill(t),
            projectName: getArea(t),
            rootRepo: getRootRepo(t),
            title: t.title,
          }),
        });
        const data = await r.json();
        if (!r.ok || !data.executionId) {
          setExecs((s) => ({
            ...s,
            [t.id]: {
              status: "failed",
              logLines: [],
              resultText: "",
              error: data.error || "Failed to start execution",
            },
          }));
          window.__reactor?.setMode("idle");
          return;
        }
        setExecs((s) => ({ ...s, [t.id]: { ...s[t.id], executionId: data.executionId } }));
        startPolling(t.id, data.executionId);
      } catch (err) {
        setExecs((s) => ({
          ...s,
          [t.id]: {
            status: "failed",
            logLines: [],
            resultText: "",
            error: err instanceof Error ? err.message : String(err),
          },
        }));
      }
    },
    [tickets, selectedId, execs, overrides, settings, fireBoltFromEvent, startPolling]
  );

  const cancelImplement = useCallback(
    async (e?: MouseEvent) => {
      const t = tickets.find((x) => x.id === selectedId);
      const execId = t ? execs[t.id]?.executionId : undefined;
      if (!execId) return;
      fireBoltFromEvent(e, { color: "#FF6B6B" });
      try {
        await fetch(`/api/executions/${execId}/cancel`, { method: "POST" });
      } catch {
        /* ignore */
      }
    },
    [tickets, selectedId, execs, fireBoltFromEvent]
  );

  const selectTicket = (id: string, e?: MouseEvent) => {
    fireBoltFromEvent(e);
    const ex = execs[id];
    setSelectedId(id);
    setTab(ex && ex.status === "running" ? "execution" : "overview");
  };

  // ---- settings ----
  const openSettings = (e?: MouseEvent) => {
    fireBoltFromEvent(e);
    setSettingsOpen(true);
  };
  const closeSettings = (e?: MouseEvent) => {
    fireBoltFromEvent(e);
    setSettingsOpen(false);
  };
  const setField = (k: keyof SettingsView) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSettings((s) => ({ ...s, [k]: e.target.value }));
  const saveSettings = async (e?: MouseEvent) => {
    fireBoltFromEvent(e, { color: "#35D6A4" });
    setSettingsOpen(false);
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await r.json();
      if (data.settings) setSettings(data.settings);
      showToast("Settings saved", 3200);
    } catch {
      showToast("Failed to save settings", 3200);
    }
  };

  // ---- derived ----
  const execStatusOf = (id: string): ExecStatus => execs[id]?.status ?? "not started";
  const activeCount = Object.values(execs).filter((e) => e.status === "running").length;

  const q = search.trim().toLowerCase();
  const filtered = tickets.filter(
    (t) => !q || (t.id + " " + t.title + " " + t.assignee + " " + t.project).toLowerCase().includes(q)
  );

  const t = tickets.find((x) => x.id === selectedId);
  const ex = t ? execs[t.id] : undefined;
  const st: ExecStatus = ex ? ex.status : "not started";
  const execEnabled = st !== "not started";
  const resultEnabled = st === "completed";

  const tabStyle = (name: string, enabled: boolean): CSSProperties => {
    const active = tab === name;
    const base: CSSProperties = {
      padding: "6px 13px",
      fontSize: "12px",
      fontWeight: 600,
      cursor: enabled ? "pointer" : "not-allowed",
      marginBottom: "3px",
      transition: "color .15s, transform .12s",
      opacity: enabled ? 1 : 0.5,
      clipPath: chipClip,
    };
    if (active)
      return {
        ...base,
        border: "1.5px solid transparent",
        background:
          "linear-gradient(#171A21,#171A21) padding-box, conic-gradient(from var(--angle), transparent, var(--accent), #ffd8c9, var(--accent), transparent 70%) border-box",
        color: "#F3F5F9",
        animation: "spinAngle 3.2s linear infinite",
      };
    return {
      ...base,
      border: "1.5px solid transparent",
      background: "transparent",
      color: !enabled ? "#3A4150" : "#8A90A0",
    };
  };

  // action button
  type Action = { label: string; spinner: boolean; playIcon: boolean; onClick: (e?: MouseEvent) => void; style: CSSProperties };
  let action: Action;
  if (st === "running")
    action = {
      label: "Running… (cancel)",
      spinner: true,
      playIcon: false,
      onClick: cancelImplement,
      style: {
        display: "flex", alignItems: "center", gap: "7px", height: "32px", padding: "0 14px",
        border: "1.5px solid transparent",
        background: "linear-gradient(#2A2E38,#2A2E38) padding-box, conic-gradient(from var(--angle), transparent, #F5B341, transparent 55%) border-box",
        color: "#C7CCD8", fontSize: "12px", fontWeight: 700, cursor: "pointer", clipPath: cutClip,
        animation: "spinAngle 1.6s linear infinite",
      },
    };
  else if (st === "completed")
    action = {
      label: "Show Result", spinner: false, playIcon: false,
      onClick: (e) => { fireBoltFromEvent(e); setTab("result"); },
      style: {
        display: "flex", alignItems: "center", gap: "7px", height: "32px", padding: "0 14px",
        border: "1.5px solid transparent",
        background: "linear-gradient(rgba(53,214,164,.14),rgba(53,214,164,.14)) padding-box, conic-gradient(from var(--angle), transparent, #35D6A4, #baf5e3, #35D6A4, transparent 70%) border-box",
        color: "#5BE8B8", fontSize: "12px", fontWeight: 700, cursor: "pointer", clipPath: cutClip,
        animation: "spinAngle 3s linear infinite",
      },
    };
  else if (st === "failed")
    action = {
      label: "Retry Implementation", spinner: false, playIcon: true, onClick: startImplement,
      style: {
        display: "flex", alignItems: "center", gap: "7px", height: "32px", padding: "0 14px",
        border: "1.5px solid transparent",
        background: `linear-gradient(${ACCENT},${ACCENT}) padding-box, conic-gradient(from var(--angle), transparent, #ffe4d8, transparent 55%) border-box`,
        color: "#0B0C10", fontSize: "12px", fontWeight: 700, cursor: "pointer", clipPath: cutClip,
      },
    };
  else
    action = {
      label: "Implement Ticket", spinner: false, playIcon: true, onClick: startImplement,
      style: {
        display: "flex", alignItems: "center", gap: "7px", height: "32px", padding: "0 14px",
        border: "1.5px solid transparent",
        background: `linear-gradient(${ACCENT},${ACCENT}) padding-box, conic-gradient(from var(--angle), transparent, #ffe4d8, transparent 55%) border-box`,
        color: "#0B0C10", fontSize: "12px", fontWeight: 700, cursor: "pointer", clipPath: cutClip,
      },
    };
  action.style.position = "relative";
  action.style.overflow = "hidden";
  action.style.transition = "filter .18s, transform .12s, box-shadow .25s";
  if (st === "not started" || st === "failed")
    action.style.animation = "spinAngle 3s linear infinite, breathe 2.8s ease-in-out infinite";

  const ctaButtonStyle: CSSProperties = { ...action.style, height: "38px", padding: "0 20px", fontSize: "13px", flex: "0 0 auto" };
  const ctaTitle = st === "completed" ? "Implementation complete" : st === "failed" ? "Last run failed" : st === "running" ? "Claude Code is working…" : "Ready to implement";
  const ctaSub = t
    ? st === "completed" ? "Open the Result tab to review what Claude changed."
      : st === "failed" ? "Fix the blocker below, then retry the run."
        : st === "running" ? "Watch the execution stream on the Execution tab."
          : `Claude Code will cd into the repo and run ${getSkill(t)} for ${getArea(t)}.`
    : "";

  // steps
  const cur = ex?.currentStep ?? (ex ? deriveStep(ex.logLines) : 0);
  const steps = STEPS.map((label, i) => {
    let sst: "pending" | "active" | "done" | "failed" = "pending";
    if (st === "completed") sst = "done";
    else if (st === "failed") sst = i < cur ? "done" : i === cur ? "failed" : "pending";
    else if (st === "running") sst = i < cur ? "done" : i === cur ? "active" : "pending";
    const last = i === STEPS.length - 1;
    const db: CSSProperties = {
      position: "relative", width: "24px", height: "24px", borderRadius: "50%",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-mono), monospace", fontSize: "11px", fontWeight: 600, flex: "0 0 auto",
      transition: "background .3s, border-color .3s, color .3s",
    };
    let dotStyle: CSSProperties;
    if (sst === "done") dotStyle = { ...db, background: "rgba(53,214,164,.14)", border: "1px solid #35D6A4", color: "#35D6A4" };
    else if (sst === "active") dotStyle = { ...db, background: "rgba(245,179,65,.12)", border: "1px solid #F5B341", color: "#F5B341" };
    else if (sst === "failed") dotStyle = { ...db, background: "rgba(255,107,107,.14)", border: "1px solid #FF6B6B", color: "#FF6B6B" };
    else dotStyle = { ...db, background: "transparent", border: "1px solid #2A2F3A", color: "#5B6273" };
    const connectorStyle: CSSProperties =
      sst === "done"
        ? { width: "2px", height: last ? "0px" : "20px", margin: "3px 0", borderRadius: "2px", background: "linear-gradient(#35D6A4, rgba(53,214,164,.12))", backgroundSize: "100% 200%", animation: "flow 1.3s linear infinite" }
        : { width: "2px", height: last ? "0px" : "20px", margin: "3px 0", background: "#23272F" };
    const labelStyle: CSSProperties = {
      fontSize: "13px", paddingBottom: last ? "0" : "20px", lineHeight: "1.3", paddingTop: "3px",
      color: sst === "done" ? "#C7CCD8" : sst === "active" ? "#F3F5F9" : sst === "failed" ? "#FF8F8F" : "#5B6273",
      fontWeight: sst === "active" ? 600 : 500,
    };
    return { label, num: i + 1, dotStyle, connectorStyle, labelStyle, showCheck: sst === "done", showSpinner: sst === "active", showX: sst === "failed", showNum: sst === "pending" };
  });

  const kindColor: Record<string, string> = {
    cmd: ACCENT, step: "#E4E7EE", ok: "#35D6A4", muted: "#6B7283", file: "#9BA6E8",
    diff: "#8A90A0", err: "#FF6B6B", fail: "#FF6B6B", done: "#35D6A4",
  };
  const logLines = (ex ? ex.logLines : []).map((l, i) => ({
    text: l.text, num: i + 1,
    style: {
      color: kindColor[l.kind] || "#C7CCD8",
      fontWeight: (l.kind === "cmd" || l.kind === "done" || l.kind === "fail" ? 600 : 400) as number,
      whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const, flex: 1, animation: "lineIn .3s ease-out both",
    } as CSSProperties,
  }));
  const logStatusMap: Record<ExecStatus, [string, string]> = {
    running: ["running", "#F5B341"], completed: ["done", "#35D6A4"], failed: ["failed", "#FF6B6B"], "not started": ["idle", "#5B6273"],
  };
  const [lsl, lsc] = logStatusMap[st];
  const logStatusStyle: CSSProperties = {
    fontSize: "10.5px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase",
    color: lsc, padding: "2px 9px", borderRadius: "999px", background: "rgba(255,255,255,.04)", border: "1px solid " + lsc + "55",
  };

  const selProject = t ? getArea(t) : "";
  const selBranch = t ? branchOf(t.id, t.title) : "";
  const selCommand = t ? `/${getSkill(t)} ID: ${t.id} - Project name: ${getArea(t)}` : "";
  const selCdCommand = t ? `cd ${getRootRepo(t)}\\${getArea(t)} && claude` : "";
  const selExecPillStyle: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "7px", fontSize: "12px", fontWeight: 600,
    color: EXEC_COLOR[st], padding: "3px 10px", borderRadius: "999px",
    background: "rgba(255,255,255,.03)", border: "1px solid " + EXEC_COLOR[st] + "44",
  };

  const showResult = tab === "result" && !!ex?.resultText;

  return (
    <div
      style={{
        position: "relative", height: "100vh", width: "100%", display: "flex", flexDirection: "column",
        background: "transparent", color: "#ECEEF3", fontFamily: "var(--font-hanken), sans-serif",
        overflow: "hidden", ["--accent" as string]: ACCENT,
      }}
    >
      <Reactor accent={ACCENT} />
      <BoltLayer bolts={bolts} flashes={flashes} />

      {/* Header */}
      <header style={{ height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "16px", padding: "0 22px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "rgba(14,17,23,.72)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", position: "relative", zIndex: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "34px", height: "34px", border: "1.5px solid transparent", background: "linear-gradient(var(--accent),var(--accent)) padding-box,conic-gradient(from var(--angle),transparent,#ffe4d8,transparent 55%) border-box", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 22px -8px var(--accent)", clipPath: "polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)", animation: "spinAngle 3.4s linear infinite" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M8 5l8 7-8 7" stroke="#0B0C10" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
            <span style={{ fontFamily: "var(--font-space), sans-serif", fontWeight: 700, fontSize: "16px", letterSpacing: ".01em", background: "linear-gradient(90deg,var(--accent) 0%,#FFC15E 18%,#FF5F3D 36%,var(--accent) 54%,#FFC15E 72%,#FF5F3D 90%,var(--accent) 100%)", backgroundSize: "300% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "fireFlow 3.6s linear infinite,fireFlicker 2.2s ease-in-out infinite" }}>Ticket Executor</span>
            <span style={{ fontSize: "10px", letterSpacing: ".16em", fontWeight: 600, marginTop: "4px", background: "linear-gradient(90deg,#5B6273 0%,#5B6273 30%,#FFD9BE 45%,var(--accent) 52%,#5B6273 65%,#5B6273 100%)", backgroundSize: "220% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "subtitleFlow 3.2s linear infinite" }}>CLAUDE CODE · AZURE DEVOPS</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "8px", padding: "6px 13px", border: "1.5px solid transparent", borderRadius: "999px", background: "linear-gradient(#14171D,#14171D) padding-box,conic-gradient(from var(--angle),transparent,var(--accent),transparent 55%) border-box", animation: "spinAngle 4s linear infinite" }}>
          <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#35D6A4", boxShadow: "0 0 8px #35D6A4" }} />
          <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#C7CCD8", whiteSpace: "nowrap" }}>{settings.sprint || "—"}</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "12.5px", color: "#8A90A0", whiteSpace: "nowrap" }}>
          <span style={{ fontFamily: "var(--font-mono), monospace", color: "#C7CCD8", fontWeight: 600 }}>{activeCount}</span> active runs
        </div>
        <button onClick={openSettings} style={{ display: "flex", alignItems: "center", gap: "7px", height: "30px", padding: "0 13px 0 11px", border: "1.5px solid transparent", background: "linear-gradient(#14171D,#14171D) padding-box,conic-gradient(from var(--angle),transparent 0deg,var(--accent) 70deg,#ffd8c9 100deg,var(--accent) 130deg,transparent 230deg,transparent 360deg) border-box", color: "#C7CCD8", fontSize: "12px", fontWeight: 600, cursor: "pointer", transition: "filter .15s,transform .12s", clipPath: "polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)", animation: "spinAngle 3.4s linear infinite" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          Settings
        </button>
      </header>

      <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", minHeight: 0 }}>
        {/* Sidebar */}
        <aside style={{ width: "388px", flex: "0 0 388px", display: "flex", flexDirection: "column", borderRight: "1px solid rgba(255,255,255,.05)", background: "rgba(12,15,20,.74)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", minHeight: 0 }}>
          <div style={{ padding: "18px 18px 12px", display: "flex", flexDirection: "column", gap: "12px", flex: "0 0 auto" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <h2 style={{ margin: 0, fontFamily: "var(--font-space), sans-serif", fontSize: "14px", fontWeight: 700, letterSpacing: ".01em", color: "#ECEEF3" }}>Sprint Backlog</h2>
              <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "11.5px", color: "#5B6273" }}>{tickets.length} tickets</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "9px", height: "36px", padding: "0 12px", border: "1.5px solid transparent", background: "linear-gradient(#14171D,#14171D) padding-box,conic-gradient(from var(--angle),transparent,var(--accent),transparent 50%) border-box", clipPath: "polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)", animation: "spinAngle 4.2s linear infinite" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5B6273" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets, people…" style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "#ECEEF3", fontSize: "13px" }} />
            </div>
          </div>
          <div ref={undefined} style={{ flex: 1, overflowY: "auto", padding: "2px 12px 16px", display: "flex", flexDirection: "column", gap: "7px", minHeight: 0 }}>
            {loading && <div style={{ color: "#5B6273", fontSize: "13px", padding: "18px 6px" }}>Loading sprint…</div>}
            {!loading && loadError && <div style={{ color: "#FF8F8F", fontSize: "12.5px", padding: "14px", border: "1px solid #4A2626", borderRadius: "10px", background: "rgba(255,107,107,.06)", lineHeight: 1.5 }}>ADO error: {loadError}</div>}
            {!loading && !loadError && filtered.length === 0 && <div style={{ color: "#5B6273", fontSize: "13px", padding: "18px 6px" }}>No tickets match.</div>}
            {filtered.map((tk, i) => {
              const sel = tk.id === selectedId;
              const est = execStatusOf(tk.id);
              const rowStyle: CSSProperties = {
                position: "relative", overflow: "hidden", flexShrink: 0, display: "flex", flexDirection: "column",
                gap: "6px", padding: "12px 13px 12px 15px", borderRadius: "11px", cursor: "pointer", textAlign: "left",
                transition: "transform .22s cubic-bezier(.2,.8,.2,1), border-color .2s, background .2s, box-shadow .22s",
                animation: "fadeUp .45s both", animationDelay: i * 45 + "ms",
                border: sel ? "1px solid " + ACCENT : "1px solid #1A1E25",
                background: sel ? "rgba(251,114,80,.07)" : "#111419",
                boxShadow: sel ? "0 10px 34px -18px " + ACCENT : "none",
              };
              const railStyle: CSSProperties = {
                position: "absolute", left: "0", top: "9px", bottom: "9px", width: "3px", borderRadius: "0 3px 3px 0",
                background: ACCENT, boxShadow: sel ? "0 0 12px " + ACCENT : "none",
                transform: sel ? "scaleY(1)" : "scaleY(0)", transformOrigin: "center",
                transition: "transform .3s cubic-bezier(.2,.8,.2,1)",
              };
              return (
                <button key={tk.id} onClick={(e) => selectTicket(tk.id, e)} style={rowStyle}>
                  <span style={railStyle} />
                  {sel && <span style={{ position: "absolute", inset: 0, borderRadius: "11px", padding: "1.6px", background: "conic-gradient(from var(--angle),transparent 0deg,var(--accent) 55deg,#ffd2c2 92deg,var(--accent) 128deg,transparent 185deg,transparent 360deg)", WebkitMask: "linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0)", WebkitMaskComposite: "xor", maskComposite: "exclude", animation: "spinAngle 2.8s linear infinite", pointerEvents: "none", zIndex: 2 }} />}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "11.5px", fontWeight: 600, color: "var(--accent)" }}>#{tk.id}</span>
                    <span style={typeBadge(tk.type)}>{tk.type}</span>
                    <div style={{ flex: 1 }} />
                    <span style={{ ...execDot(est) }} />
                  </div>
                  <div style={{ fontSize: "13.5px", fontWeight: 600, color: "#E4E7EE", lineHeight: 1.35, textAlign: "left" }}>{tk.title}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "1px" }}>
                    <span style={statusPill(tk.status)}>{tk.status}</span>
                    <div style={{ flex: 1 }} />
                    <span style={avatar(tk.assignee)}>{initials(tk.assignee)}</span>
                    <span style={{ fontSize: "11.5px", color: "#6B7283" }}>{tk.assignee}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Main */}
        <main style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: "linear-gradient(110deg,rgba(6,7,10,.5) 0%,rgba(6,7,10,.22) 52%,rgba(6,7,10,0) 100%)" }}>
          {!t ? (
            <div style={{ margin: "auto", color: "#5B6273", fontSize: "14px" }}>{loading ? "Loading…" : "Select a ticket"}</div>
          ) : (
            <>
              <div style={{ position: "relative", zIndex: 1, flex: "0 0 auto", padding: "20px 28px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "9px" }}>
                  <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "13px", fontWeight: 600, color: "var(--accent)" }}>#{t.id}</span>
                  <span style={typeBadge(t.type)}>{t.type}</span>
                  <span style={statusPill(t.status)}>{t.status}</span>
                </div>
                <h1 style={{ margin: 0, fontFamily: "var(--font-space), sans-serif", fontSize: "24px", fontWeight: 700, lineHeight: 1.18, color: "#F3F5F9", maxWidth: "820px" }}>{t.title}</h1>
                <div style={{ display: "flex", alignItems: "center", gap: "18px", marginTop: "13px", fontSize: "12.5px", color: "#8A90A0", flexWrap: "wrap" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={avatar(t.assignee)}>{initials(t.assignee)}</span>{t.assignee}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7283" strokeWidth="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg><span style={{ fontFamily: "var(--font-mono), monospace", color: "#A6ADBB" }}>{selProject}</span></span>
                  <span style={selExecPillStyle}><span style={{ ...execDot(st), width: "7px", height: "7px" }} />{EXEC_LABEL[st]}</span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "22px", borderBottom: "1px solid #1E232C" }}>
                  <button onClick={() => setTab("overview")} style={tabStyle("overview", true)}>Overview</button>
                  <button onClick={() => execEnabled && setTab("execution")} style={tabStyle("execution", execEnabled)}>Execution</button>
                  <button onClick={() => resultEnabled && setTab("result")} style={tabStyle("result", resultEnabled)}>Result</button>
                  <div style={{ flex: 1 }} />
                  <div style={{ paddingBottom: "8px" }}>
                    <button onClick={action.onClick} style={action.style}>
                      {action.playIcon && <span style={{ position: "absolute", top: 0, left: "-45%", width: "45%", height: "100%", background: "linear-gradient(100deg,transparent,rgba(255,255,255,.32),transparent)", animation: "sheen 3.6s ease-in-out infinite", pointerEvents: "none" }} />}
                      {action.spinner && <span style={{ width: "14px", height: "14px", borderRadius: "50%", border: "2px solid rgba(11,12,16,.3)", borderTopColor: "#0B0C10", display: "inline-block", animation: "spin .7s linear infinite", position: "relative", zIndex: 1 }} />}
                      {action.playIcon && <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ position: "relative", zIndex: 1 }}><path d="M7 4l13 8-13 8z" /></svg>}
                      <span style={{ position: "relative", zIndex: 1 }}>{action.label}</span>
                    </button>
                  </div>
                </div>
              </div>

              <div ref={tab === "execution" ? undefined : undefined} style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", minHeight: 0, padding: "24px 28px 44px" }}>
                {tab === "overview" && (
                  <div style={{ maxWidth: "780px", display: "flex", flexDirection: "column", gap: "28px", animation: "fadeUp .4s both" }}>
                    <section>
                      <h3 style={{ margin: "0 0 12px", fontFamily: "var(--font-space), sans-serif", fontSize: "11px", fontWeight: 700, letterSpacing: ".16em", color: "#5B6273" }}>DESCRIPTION</h3>
                      <p style={{ margin: 0, fontSize: "14.5px", lineHeight: 1.75, color: "#B8BDC9", whiteSpace: "pre-wrap" }}>{t.description || "No description."}</p>
                    </section>
                    {t.criteria.length > 0 && (
                      <section>
                        <h3 style={{ margin: "0 0 12px", fontFamily: "var(--font-space), sans-serif", fontSize: "11px", fontWeight: 700, letterSpacing: ".16em", color: "#5B6273" }}>ACCEPTANCE CRITERIA</h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {t.criteria.map((c, i) => (
                            <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start", padding: "12px 14px", border: "1px solid #1E232C", borderRadius: "10px", background: "#111419" }}>
                              <span style={{ flex: "0 0 auto", width: "18px", height: "18px", borderRadius: "6px", border: "1.5px solid #2E3644", display: "flex", alignItems: "center", justifyContent: "center", marginTop: "1px" }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#5B6273" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg></span>
                              <span style={{ fontSize: "13.5px", color: "#C7CCD8", lineHeight: 1.5 }}>{c}</span>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                    <section style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" }}>
                      <div style={{ padding: "11px 13px", border: "1px solid #262B36", borderRadius: "10px", background: "#111419" }}><div style={{ fontSize: "10.5px", letterSpacing: ".12em", color: "#5B6273", fontWeight: 600, marginBottom: "6px" }}>ROOT REPO</div><input value={getRootRepo(t)} onChange={setOverride(t.id, "rootRepo")} style={{ width: "100%", border: "none", outline: "none", background: "transparent", padding: 0, fontFamily: "var(--font-mono), monospace", fontSize: "12.5px", color: "#E4E7EE" }} /></div>
                      <div style={{ padding: "11px 13px", border: "1px solid #262B36", borderRadius: "10px", background: "#111419" }}><div style={{ fontSize: "10.5px", letterSpacing: ".12em", color: "#5B6273", fontWeight: 600, marginBottom: "6px" }}>PROJECT <span style={{ color: "#3A4150" }}></span></div><input value={getArea(t)} onChange={setOverride(t.id, "area")} style={{ width: "100%", border: "none", outline: "none", background: "transparent", padding: 0, fontFamily: "var(--font-mono), monospace", fontSize: "13px", color: "#E4E7EE" }} /></div>
                      <div style={{ padding: "11px 13px", border: "1px solid #262B36", borderRadius: "10px", background: "#111419" }}><div style={{ fontSize: "10.5px", letterSpacing: ".12em", color: "#5B6273", fontWeight: 600, marginBottom: "6px" }}>SKILL</div><input value={getSkill(t)} onChange={setOverride(t.id, "skill")} style={{ width: "100%", border: "none", outline: "none", background: "transparent", padding: 0, fontFamily: "var(--font-mono), monospace", fontSize: "13px", color: "#E4E7EE" }} /></div>
                      <div style={{ padding: "13px 15px", border: "1px solid #1E232C", borderRadius: "10px", background: "#111419" }}><div style={{ fontSize: "10.5px", letterSpacing: ".12em", color: "#5B6273", fontWeight: 600, marginBottom: "6px" }}>TARGET BRANCH</div><div style={{ fontFamily: "var(--font-mono), monospace", fontSize: "12.5px", color: "#9BA6E8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selBranch}</div></div>
                    </section>
                    <section>
                      <h3 style={{ margin: "0 0 12px", fontFamily: "var(--font-space), sans-serif", fontSize: "11px", fontWeight: 700, letterSpacing: ".16em", color: "#5B6273" }}>COMMAND PREVIEW</h3>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "15px 18px", border: "1px solid #23272F", borderRadius: "12px", background: "#0A0B0E", fontFamily: "var(--font-mono), monospace", fontSize: "13px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><span style={{ color: "#5B6273" }}>$</span><span style={{ color: "#8A90A0" }}>{selCdCommand}</span></div>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><span style={{ color: "var(--accent)" }}>$</span><span style={{ color: "#C7CCD8" }}>{selCommand}</span></div>
                      </div>
                    </section>
                    <div style={{ display: "flex", alignItems: "center", gap: "16px", padding: "20px 22px", border: "1px solid #2A2018", borderRadius: "14px", background: "linear-gradient(120deg,rgba(251,114,80,.09),rgba(251,114,80,.02))" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: "15px", fontWeight: 700, color: "#F3F5F9", marginBottom: "3px" }}>{ctaTitle}</div>
                        <div style={{ fontSize: "13px", color: "#9A9FAD" }}>{ctaSub}</div>
                      </div>
                      <button onClick={action.onClick} style={ctaButtonStyle}>
                        {action.playIcon && <span style={{ position: "absolute", top: 0, left: "-45%", width: "45%", height: "100%", background: "linear-gradient(100deg,transparent,rgba(255,255,255,.32),transparent)", animation: "sheen 3.6s ease-in-out infinite", pointerEvents: "none" }} />}
                        {action.spinner && <span style={{ width: "15px", height: "15px", borderRadius: "50%", border: "2px solid rgba(11,12,16,.3)", borderTopColor: "#0B0C10", display: "inline-block", animation: "spin .7s linear infinite", position: "relative", zIndex: 1 }} />}
                        {action.playIcon && <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ position: "relative", zIndex: 1 }}><path d="M7 4l13 8-13 8z" /></svg>}
                        <span style={{ position: "relative", zIndex: 1 }}>{action.label}</span>
                      </button>
                    </div>
                  </div>
                )}

                {tab === "execution" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "20px", animation: "fadeUp .35s both" }}>
                    <div style={{ display: "flex", gap: "26px", alignItems: "flex-start" }}>
                      <div style={{ flex: "0 0 236px", paddingTop: "4px" }}>
                        {steps.map((s, i) => (
                          <div key={i} style={{ display: "flex", gap: "13px", alignItems: "flex-start" }}>
                            <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
                              <span style={s.dotStyle}>
                                {s.showCheck && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2"><path d="M5 13l4 4L19 7" /></svg>}
                                {s.showSpinner && <><span style={{ position: "absolute", inset: "-5px", borderRadius: "50%", border: "1px solid rgba(245,179,65,.55)", animation: "ringPulse 1.7s ease-out infinite" }} /><span style={{ position: "absolute", inset: "-5px", borderRadius: "50%", border: "1px solid rgba(245,179,65,.4)", animation: "ringPulse 1.7s ease-out .85s infinite" }} /><span style={{ width: "11px", height: "11px", borderRadius: "50%", border: "2px solid rgba(245,179,65,.3)", borderTopColor: "#F5B341", display: "inline-block", animation: "spin .7s linear infinite" }} /></>}
                                {s.showX && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2"><path d="M6 6l12 12M18 6L6 18" /></svg>}
                                {s.showNum && s.num}
                              </span>
                              <span style={s.connectorStyle} />
                            </div>
                            <span style={s.labelStyle}>{s.label}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ position: "relative", flex: 1, minWidth: 0, border: "1.5px solid transparent", borderRadius: "13px", overflow: "hidden", background: "linear-gradient(#0A0B0E,#0A0B0E) padding-box,conic-gradient(from var(--angle),transparent,var(--accent),transparent 40%) border-box", boxShadow: "0 24px 60px -34px #000", animation: "spinAngle 5.5s linear infinite" }}>
                        <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", background: "repeating-linear-gradient(0deg,rgba(255,255,255,.016) 0px,rgba(255,255,255,.016) 1px,transparent 1px,transparent 3px)" }} />
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "1px", zIndex: 0, pointerEvents: "none", background: "linear-gradient(90deg,transparent,var(--accent),transparent)", opacity: 0.55 }} />
                        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: "10px", padding: "11px 15px", borderBottom: "1px solid #1A1E25", background: "#0E1015" }}>
                          <span style={{ display: "flex", gap: "6px" }}><span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#3A3030" }} /><span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#3A3830" }} /><span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#2F3A32" }} /></span>
                          <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "11.5px", color: "#6B7283", marginLeft: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>claude-code — {selProject}</span>
                          <div style={{ flex: 1 }} />
                          <span style={logStatusStyle}>{lsl}</span>
                        </div>
                        <div ref={logRef} style={{ position: "relative", zIndex: 1, height: "430px", overflowY: "auto", padding: "14px 17px", fontFamily: "var(--font-mono), monospace", fontSize: "12.5px", lineHeight: 1.75 }}>
                          {logLines.length === 0 && <div style={{ color: "#5B6273" }}>Waiting for output…</div>}
                          {logLines.map((l, i) => (
                            <div key={i} style={{ display: "flex", gap: "12px" }}>
                              <span style={l.style}>{l.text}</span>
                            </div>
                          ))}
                          {st === "running" && <span style={{ display: "inline-block", width: "8px", height: "15px", background: "var(--accent)", verticalAlign: "text-bottom", animation: "blink 1s step-end infinite", marginLeft: "0" }} />}
                        </div>
                      </div>
                    </div>
                    {st === "failed" && ex?.error && (
                      <div style={{ display: "flex", gap: "13px", alignItems: "flex-start", padding: "15px 18px", border: "1px solid #4A2626", borderRadius: "12px", background: "rgba(255,107,107,.06)" }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" strokeWidth="2" style={{ flex: "0 0 auto", marginTop: "1px" }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
                        <div><div style={{ fontSize: "13.5px", fontWeight: 700, color: "#FF8F8F", marginBottom: "3px" }}>Execution failed</div><div style={{ fontSize: "13px", color: "#C7A8A8", lineHeight: 1.55 }}>{ex.error}</div></div>
                      </div>
                    )}
                  </div>
                )}

                {showResult && ex && (
                  <div style={{ maxWidth: "800px", display: "flex", flexDirection: "column", gap: "26px", animation: "fadeUp .35s both" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "16px 18px", border: "1px solid #24382F", borderRadius: "13px", background: "linear-gradient(120deg,rgba(53,214,164,.08),rgba(53,214,164,.02))" }}>
                      <span style={{ flex: "0 0 auto", width: "40px", height: "40px", borderRadius: "11px", background: "rgba(53,214,164,.14)", border: "1px solid #35D6A4", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#35D6A4" strokeWidth="2.6"><path d="M5 13l4 4L19 7" style={{ strokeDasharray: 26, strokeDashoffset: 26, animation: "draw .6s .2s ease forwards" }} /></svg></span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: "15px", fontWeight: 700, color: "#F3F5F9" }}>Implementation complete</div>
                        <div style={{ fontSize: "12.5px", color: "#8A90A0", marginTop: "2px" }}>Finished{ex.duration ? <> in <span style={{ color: "#C7CCD8", fontWeight: 600 }}>{ex.duration}</span></> : ""} · Claude Code output below</div>
                      </div>
                    </div>
                    <div className="md-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{ex.resultText}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {/* Settings modal */}
      {settingsOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(6,7,9,.68)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn .2s both" }} onClick={closeSettings}>
          <div style={{ width: "540px", maxWidth: "100%", border: "1px solid #262B36", borderRadius: "16px", background: "#14171D", boxShadow: "0 40px 90px -30px #000", animation: "slideIn .28s both", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 22px", borderBottom: "1px solid #1E232C" }}>
              <div><div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: "16px", fontWeight: 700, color: "#F3F5F9" }}>Settings</div><div style={{ fontSize: "12px", color: "#6B7283", marginTop: "2px" }}>Azure DevOps connection &amp; execution defaults</div></div>
              <button onClick={closeSettings} style={{ width: "26px", height: "26px", border: "1.5px solid transparent", background: "linear-gradient(#1A1E25,#1A1E25) padding-box,conic-gradient(from var(--angle),transparent,var(--accent),transparent 60%) border-box", color: "#8A90A0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", clipPath: "polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)", animation: "spinAngle 4s linear infinite" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
            </div>
            <div style={{ padding: "22px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "7px" }}><span style={{ fontSize: "11px", letterSpacing: ".1em", fontWeight: 600, color: "#8A90A0" }}>ORGANIZATION URL</span><input value={settings.org} onChange={setField("org")} style={{ height: "40px", padding: "0 13px", border: "1px solid #262B36", borderRadius: "9px", background: "#0E1015", color: "#ECEEF3", fontFamily: "var(--font-mono), monospace", fontSize: "13px", outline: "none" }} /></label>
              <label style={{ display: "flex", flexDirection: "column", gap: "7px" }}><span style={{ fontSize: "11px", letterSpacing: ".1em", fontWeight: 600, color: "#8A90A0" }}>PERSONAL ACCESS TOKEN</span><input type="password" value={settings.pat} onChange={setField("pat")} placeholder={settings.hasPat ? "•••••••••••••• (saved)" : "••••••••••••••••"} style={{ height: "40px", padding: "0 13px", border: "1px solid #262B36", borderRadius: "9px", background: "#0E1015", color: "#ECEEF3", fontFamily: "var(--font-mono), monospace", fontSize: "13px", outline: "none" }} /></label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "7px" }}><span style={{ fontSize: "11px", letterSpacing: ".1em", fontWeight: 600, color: "#8A90A0" }}>ROOT REPO</span><input value={settings.rootRepo} onChange={setField("rootRepo")} style={{ height: "40px", padding: "0 13px", border: "1px solid #262B36", borderRadius: "9px", background: "#0E1015", color: "#ECEEF3", fontFamily: "var(--font-mono), monospace", fontSize: "13px", outline: "none" }} /></label>
                <label style={{ display: "flex", flexDirection: "column", gap: "7px" }}><span style={{ fontSize: "11px", letterSpacing: ".1em", fontWeight: 600, color: "#8A90A0" }}>DEFAULT PROJECT NAME</span><input value={settings.defaultProject} onChange={setField("defaultProject")} style={{ height: "40px", padding: "0 13px", border: "1px solid #262B36", borderRadius: "9px", background: "#0E1015", color: "#ECEEF3", fontFamily: "var(--font-mono), monospace", fontSize: "13px", outline: "none" }} /></label>
              </div>
              <span style={{ fontSize: "11.5px", color: "#5B6273", marginTop: "-8px" }}>Root repo is the local folder Claude Code runs in. Default project name is the fallback used when a ticket has no Area set — skill and project are otherwise set per ticket on the Overview tab.</span>
              <label style={{ display: "flex", flexDirection: "column", gap: "7px" }}><span style={{ fontSize: "11px", letterSpacing: ".1em", fontWeight: 600, color: "#8A90A0" }}>CURRENT SPRINT</span><input value={settings.sprint} onChange={setField("sprint")} style={{ height: "40px", padding: "0 13px", border: "1px solid #262B36", borderRadius: "9px", background: "#0E1015", color: "#ECEEF3", fontSize: "13px", outline: "none" }} /></label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", padding: "18px 22px", borderTop: "1px solid #1E232C", background: "#101318" }}>
              <button onClick={closeSettings} style={{ height: "32px", padding: "0 16px", border: "1.5px solid #2A2F3A", background: "transparent", color: "#C7CCD8", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", clipPath: "polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)", transition: "border-color .15s,color .15s,transform .12s" }}>Cancel</button>
              <button onClick={saveSettings} style={{ height: "32px", padding: "0 18px", border: "1.5px solid transparent", background: "linear-gradient(var(--accent),var(--accent)) padding-box,conic-gradient(from var(--angle),transparent,#ffe4d8,transparent 55%) border-box", color: "#0B0C10", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", clipPath: "polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)", animation: "spinAngle 3s linear infinite" }}>Save changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", overflow: "hidden", bottom: "24px", right: "24px", zIndex: 60, display: "flex", alignItems: "center", gap: "11px", padding: "14px 18px", border: "1px solid #24382F", borderLeft: "3px solid #35D6A4", borderRadius: "11px", background: "#14171D", boxShadow: "0 20px 50px -20px #000", animation: "slideIn .3s both" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#35D6A4" strokeWidth="2.6"><path d="M5 13l4 4L19 7" style={{ strokeDasharray: 26, strokeDashoffset: 26, animation: "draw .5s .1s ease forwards" }} /></svg>
          <span style={{ fontSize: "13.5px", fontWeight: 600, color: "#ECEEF3" }}>{toast.msg}</span>
          <span style={{ position: "absolute", left: 0, bottom: 0, height: "2px", width: "100%", background: "#35D6A4", opacity: 0.6, transformOrigin: "left", animation: "shrink 4s linear forwards" }} />
        </div>
      )}
    </div>
  );
}
