"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Reactor from "./Reactor";
import { BoltLayer, useBolts } from "./Bolts";
import Combobox from "./Combobox";
import SprintPicker, { type IterationOption } from "./SprintPicker";
import type { ExecStatus, LogLine, Ticket, TicketComment, ReviewData, ReviewSummaryEntry } from "@/lib/types";
import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";
import {
  COLORS,
  EXEC_COLOR,
  EXEC_LABEL,
  STATUS_ALL,
  STEPS,
  actionInfoFor,
  avatar,
  branchOf,
  card,
  clipCorner,
  ctaButtonStyle,
  dropdownPanelStyle,
  execDot,
  initials,
  nextStatusAfter,
  pill,
  ringBorder,
  statusColor,
  statusPill,
  statusPillActive,
  tintedCard,
  typeBadge,
} from "@/lib/ui";

const ACCENT = COLORS.accent;
const DEFAULT_SKILL = "implement-ticket-v2";

// Result-tab section split: order implementation before review, with friendly titles.
// "senior-code-review" section disabled along with the run code-review feature below.
const RESULT_SKILL_ORDER = ["implement-ticket-v2", /* "senior-code-review", */ "fix-code-review-v2"];
const RESULT_SKILL_TITLE: Record<string, string> = {
  "implement-ticket-v2": "Implementation",
  // "senior-code-review": "Code Review",
  "fix-code-review-v2": "Fix Code Review",
};

// Suggested skills for the Overview combobox — free text is still allowed.
const SKILL_OPTIONS = [
  "implement-ticket-v2",
  "fix-issue",
  "fix-code-review",
  // "senior-code-review", // run code-review feature disabled for now
  "testing-report",
  "review-re-estimate-ado-tickets",
  "tackle-requirement",
];
const COMMON_ROOT_REPOS = ["C:\\repos", "C:\\src", "D:\\repos"];

type ExecView = {
  executionId?: string;
  status: ExecStatus;
  skillName?: string;
  logLines: LogLine[];
  resultText: string;
  resultsBySkill?: Record<string, string>;
  error: string;
  prUrl?: string;
  branch?: string;
  duration?: string;
  currentStep?: number;
};

type RunSummary = {
  id: string;
  status: ExecStatus;
  skillName: string;
  prUrl: string;
  branch: string;
  startedAt: string;
  duration?: string;
};

type SettingsView = {
  provider: ProviderId;
  org: string;
  pat: string;
  hasPat: boolean;
  rootRepo: string;
  defaultProject: string;
  sprint: string;
  animatedBackground: boolean;
};

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

// Render a comment body: color @mentions and keep line breaks (ADO-style).
const MENTION_RE = /(@[A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?)/g;
function renderCommentBody(text: string) {
  return text.split("\n").map((line, li) => (
    <span key={li}>
      {li > 0 && <br />}
      {line.split(MENTION_RE).map((part, pi) =>
        /^@[A-Z]/.test(part) ? (
          <span key={pi} style={{ color: "#6C8EEF", fontWeight: 600 }}>{part}</span>
        ) : (
          part
        )
      )}
    </span>
  ));
}

// Format an ISO date as a short relative label ("2 days ago") for the PR overview.
function timeAgo(iso: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function TicketExecutor() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadError, setLoadError] = useState<string>("");
  const [ticketsNotice, setTicketsNotice] = useState<string>("");
  const [sprintLabel, setSprintLabel] = useState<string>("");
  const [sprintOptions, setSprintOptions] = useState<IterationOption[]>([]);
  const [selectedSprint, setSelectedSprint] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");
  const [tab, setTab] = useState<"overview" | "execution" | "resolve-review" | "result">("overview");
  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fType, setFType] = useState("");
  const [fAssignee, setFAssignee] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string } | null>(null);
  const [execs, setExecs] = useState<Record<string, ExecView>>({});
  const [history, setHistory] = useState<Record<string, RunSummary[]>>({});
  const [comments, setComments] = useState<Record<string, TicketComment[]>>({});
  const [skillOptions, setSkillOptions] = useState<string[]>(SKILL_OPTIONS);
  const [settingsError, setSettingsError] = useState("");
  const [connTest, setConnTest] = useState<{ status: "idle" | "testing" | "ok" | "fail"; message: string }>({ status: "idle", message: "" });
  const [overrides, setOverrides] = useState<Record<string, Partial<Record<"area" | "skill" | "rootRepo", string>>>>({});
  const [settings, setSettings] = useState<SettingsView>({
    provider: "azure-devops",
    org: "",
    pat: "",
    hasPat: false,
    rootRepo: "C:\\repos",
    defaultProject: "",
    sprint: "",
    animatedBackground: true,
  });
  const [reviews, setReviews] = useState<Record<string, ReviewData>>({});
  const [reviewSummary, setReviewSummary] = useState<ReviewSummaryEntry[]>([]);
  const [reviewReadMap, setReviewReadMap] = useState<Record<string, { count: number; readAt: string }>>({});
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  const { bolts, flashes, fireBolt, fireBoltFromEvent, statusBoltAnchor } = useBolts();
  const logRef = useRef<HTMLDivElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingCoreRef = useRef<HTMLDivElement>(null);

  // While the sprint list is (re)loading, crackle small bolts around the energy core.
  useEffect(() => {
    if (!loading) return;
    const strike = () => {
      const el = loadingCoreRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2 + (Math.random() - 0.5) * 26;
      const y = r.top + r.height / 2 + (Math.random() - 0.5) * 26;
      fireBolt(x, y, { color: ACCENT });
    };
    strike();
    const id = setInterval(strike, 420);
    return () => clearInterval(id);
  }, [loading, fireBolt]);

  // ---- data load ----
  // Fetch the ticket list for a given provider (and optional sprint override) and refresh the header sprint.
  const reloadTickets = useCallback(async (provider: ProviderId, sprint?: string) => {
    setLoading(true);
    setLoadError("");
    setTicketsNotice("");
    try {
      const qs = new URLSearchParams({ provider });
      if (sprint) qs.set("sprint", sprint);
      const r = await fetch(`/api/tickets?${qs.toString()}`);
      const data = await r.json();
      if (data.error) setLoadError(data.error);
      if (data.notice) setTicketsNotice(data.notice);
      setSprintLabel(typeof data.sprint === "string" ? data.sprint : "");
      const list: Ticket[] = data.tickets ?? [];
      setTickets(list);
      setSelectedId((prev) => (list.some((t) => t.id === prev) ? prev : list[0]?.id ?? ""));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Populate the sprint picker (Azure DevOps only) and default-select ADO's current iteration.
  const loadSprintOptions = useCallback(async (provider: ProviderId) => {
    if (provider !== "azure-devops") {
      setSprintOptions([]);
      setSelectedSprint("");
      return;
    }
    try {
      const r = await fetch("/api/sprints");
      const data = await r.json();
      setSprintOptions(Array.isArray(data.sprints) ? data.sprints : []);
      setSelectedSprint(typeof data.current === "string" ? data.current : "");
    } catch {
      setSprintOptions([]);
    }
  }, []);

  // User picked a specific sprint from the dropdown — reload tickets for it.
  const onSprintChange = (value: string, e: { clientX: number; clientY: number }) => {
    fireBoltFromEvent(e);
    setSelectedSprint(value);
    reloadTickets(settings.provider, value);
  };

  useEffect(() => {
    (async () => {
      let provider: ProviderId = "azure-devops";
      try {
        const r = await fetch("/api/settings");
        const data = await r.json();
        if (data.settings) {
          setSettings(data.settings);
          provider = data.settings.provider ?? provider;
        }
      } catch {
        /* ignore — fall back to default provider */
      }
      await loadSprintOptions(provider);
      await reloadTickets(provider);
    })();
    (async () => {
      try {
        const r = await fetch("/api/skills");
        const data = await r.json();
        if (Array.isArray(data.skills) && data.skills.length) setSkillOptions(data.skills);
      } catch {
        /* keep default SKILL_OPTIONS */
      }
    })();
    return () => {
      Object.values(pollTimers.current).forEach(clearInterval);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [reloadTickets, loadSprintOptions]);

  // ---- execution history ----
  const loadHistory = useCallback(async (ticketId: string) => {
    if (!ticketId) return;
    try {
      const r = await fetch(`/api/tickets/${ticketId}/executions`);
      const data = await r.json();
      setHistory((h) => ({ ...h, [ticketId]: data.executions ?? [] }));
    } catch {
      /* ignore */
    }
  }, []);

  // Lazily load a ticket's discussion comments when it becomes selected.
  const loadComments = useCallback(async (ticketId: string, provider: ProviderId) => {
    if (!ticketId || comments[ticketId]) return;
    try {
      const r = await fetch(`/api/tickets/${ticketId}/comments?provider=${provider}`);
      const data = await r.json();
      setComments((c) => ({ ...c, [ticketId]: data.comments ?? [] }));
    } catch {
      /* ignore — section stays hidden */
    }
  }, [comments]);

  useEffect(() => {
    if (selectedId) loadHistory(selectedId);
  }, [selectedId, loadHistory]);

  useEffect(() => {
    if (selectedId) loadComments(selectedId, settings.provider);
  }, [selectedId, settings.provider, loadComments]);

  // Fetch (or refetch) the Resolve Review data for one ticket — the linked PR
  // overview plus its open/resolved review-comment threads.
  const loadReview = useCallback(async (ticketId: string, provider: ProviderId) => {
    if (!ticketId) return;
    try {
      const r = await fetch(`/api/tickets/${ticketId}/review?provider=${provider}`);
      const data = await r.json();
      setReviews((s) => ({ ...s, [ticketId]: data.review ?? { pr: null, comments: [], unresolvedCount: 0 } }));
    } catch {
      /* ignore — Resolve Review tab shows the empty state */
    }
  }, []);

  useEffect(() => {
    if (selectedId && !reviews[selectedId]) loadReview(selectedId, settings.provider);
  }, [selectedId, settings.provider, reviews, loadReview]);

  // Review data can go stale the moment new comments land on the PR upstream —
  // force a fresh fetch every time the Resolve Review tab is (re)opened.
  useEffect(() => {
    if (selectedId && tab === "resolve-review") loadReview(selectedId, settings.provider);
  }, [selectedId, tab, settings.provider, loadReview]);

  // Load the bell's read/unread bookkeeping (persisted across reloads).
  useEffect(() => {
    try {
      const raw = localStorage.getItem("reviewReadMap");
      if (raw) setReviewReadMap(JSON.parse(raw));
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  // Mark a bell notification as read up to its current unresolved-comment count.
  const markReviewRead = useCallback((rv: ReviewSummaryEntry) => {
    setReviewReadMap((prev) => {
      const next = { ...prev, [rv.ticketId]: { count: rv.unresolvedCount, readAt: new Date().toISOString() } };
      try {
        localStorage.setItem("reviewReadMap", JSON.stringify(next));
      } catch {
        /* ignore quota errors */
      }
      return next;
    });
  }, []);

  // Poll the bell's unresolved-review-comment summary across every loaded ticket.
  useEffect(() => {
    if (tickets.length === 0) {
      setReviewSummary([]);
      return;
    }
    let cancelled = false;
    const fetchSummary = async () => {
      try {
        const ids = tickets.map((tk) => tk.id).join(",");
        const r = await fetch(`/api/reviews/summary?provider=${settings.provider}&ids=${ids}`);
        const data = await r.json();
        if (!cancelled) setReviewSummary(Array.isArray(data.reviews) ? data.reviews : []);
      } catch {
        /* keep last known summary */
      }
    };
    fetchSummary();
    const id = setInterval(fetchSummary, 45000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tickets, settings.provider]);

  // Close the bell dropdown on outside click.
  useEffect(() => {
    if (!bellOpen) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [bellOpen]);

  // Open a past run (from DB) in the viewer.
  const openRun = useCallback(async (ticketId: string, execId: string, e?: MouseEvent) => {
    fireBoltFromEvent(e);
    try {
      const r = await fetch(`/api/executions/${execId}`);
      const data = await r.json();
      const ex = data.execution;
      if (!ex) return;
      setExecs((s) => ({
        ...s,
        [ticketId]: {
          executionId: execId,
          status: ex.status,
          skillName: ex.skillName,
          logLines: ex.logLines ?? [],
          resultText: ex.resultText ?? "",
          resultsBySkill: ex.resultText ? { [ex.skillName || "implement-ticket-v2"]: ex.resultText } : {},
          error: ex.errorMessage ?? "",
          prUrl: ex.prUrl ?? "",
          branch: ex.branch ?? "",
          duration: ex.duration,
          currentStep: ex.currentStep,
        },
      }));
      setTab(ex.status === "completed" ? "result" : "execution");
    } catch {
      /* ignore */
    }
  }, [fireBoltFromEvent]);

  // autoscroll terminal
  useEffect(() => {
    if (tab === "execution" && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  });

  // Close the status dropdown on outside click.
  useEffect(() => {
    if (!statusMenuOpen) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) setStatusMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [statusMenuOpen]);

  const showToast = useCallback((msg: string, ms = 4000) => {
    setToast({ msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  // Ask for notification permission (best-effort) and fire a desktop notification
  // when a run finishes while the tab is not focused.
  const requestNotify = useCallback(() => {
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default")
        Notification.requestPermission().catch(() => {});
    } catch {}
  }, []);
  const notify = useCallback((title: string, body: string) => {
    try {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      if (typeof document !== "undefined" && !document.hidden) return; // tab visible → toast is enough
      new Notification(title, { body });
    } catch {}
  }, []);

  // ---- per-ticket resolved config ----
  // Effective status: a locally-applied override (simulated ADO sync) wins over the ADO state.
  const getStatus = (t: Ticket) => statusOverrides[t.id] || t.status;
  const selectStatus = (ticketId: string, status: string, e?: MouseEvent) => {
    fireBoltFromEvent(e, { color: "#35D6A4" });
    setStatusOverrides((s) => ({ ...s, [ticketId]: status }));
    setStatusMenuOpen(false);
    showToast(`Status set to "${status}" — synced to Azure DevOps`, 3200);
  };
  const getArea = (t: Ticket) => overrides[t.id]?.area || t.project || settings.defaultProject;
  const getSkill = (t: Ticket) => overrides[t.id]?.skill || actionInfoFor(getStatus(t))?.skill || DEFAULT_SKILL;
  const getRootRepo = (t: Ticket) => overrides[t.id]?.rootRepo || settings.rootRepo || "C:\\repos";
  const setOverrideValue = (ticketId: string, field: "area" | "skill" | "rootRepo", value: string) =>
    setOverrides((s) => ({ ...s, [ticketId]: { ...(s[ticketId] || {}), [field]: value } }));

  // Combobox option lists (values are suggestions; free text is still allowed).
  const overrideVals = Object.values(overrides);
  const projectOptions = Array.from(
    new Set([
      ...tickets.map((x) => x.project),
      ...overrideVals.map((o) => o?.area),
    ].filter(Boolean) as string[])
  );
  const rootRepoOptions = Array.from(
    new Set([
      ...COMMON_ROOT_REPOS,
      settings.rootRepo,
      ...overrideVals.map((o) => o?.rootRepo),
    ].filter(Boolean) as string[])
  );

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
              skillName: ex.skillName ?? s[ticketId]?.skillName,
              logLines: ex.logLines ?? [],
              resultText: ex.resultText ?? "",
              // Keep prior runs' results; index the new one by the skill that produced it.
              resultsBySkill: ex.resultText
                ? { ...(s[ticketId]?.resultsBySkill || {}), [ex.skillName || "implement-ticket-v2"]: ex.resultText }
                : s[ticketId]?.resultsBySkill,
              error: ex.errorMessage ?? "",
              prUrl: ex.prUrl ?? "",
              branch: ex.branch ?? "",
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
            if (ex.status === "completed") {
              // Simulated ADO sync: advance the ticket status based on the skill that ran.
              const next = nextStatusAfter(ex.skillName ?? "", "");
              if (next) {
                setStatusOverrides((so) => ({ ...so, [ticketId]: next }));
                showToast(`#${ticketId} completed — status synced to "${next}"`);
                notify("Ticket Executor", `#${ticketId} completed — status synced to "${next}"`);
              } else {
                showToast(`#${ticketId} completed — result ready`);
                notify("Ticket Executor", `#${ticketId} completed — result ready`);
              }
            } else {
              showToast(`#${ticketId} failed`);
              notify("Ticket Executor", `#${ticketId} failed`);
            }
            // A fix-code-review-v2 run resolves PR threads itself — refetch
            // the Resolve Review data so the tab reflects the new state.
            if (ex.skillName === "fix-code-review-v2") {
              setReviews((s) => {
                const { [ticketId]: _drop, ...rest } = s;
                return rest;
              });
            }
            loadHistory(ticketId);
          }
        } catch {
          /* keep polling */
        }
      };
      pollTimers.current[executionId] = setInterval(poll, 1200);
      poll();
    },
    [showToast, loadHistory, notify]
  );

  // Rehydrate a ticket's exec state from its most recent execution row —
  // covers the case where the page reloaded (or the ticket is reselected)
  // after a run finished, so the CTA/result tab don't forget it happened.
  const hydrateExecution = useCallback(
    async (ticketId: string, executionId: string, skillNameHint?: string) => {
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
            skillName: ex.skillName ?? skillNameHint,
            logLines: ex.logLines ?? [],
            resultText: ex.resultText ?? "",
            resultsBySkill: ex.resultText
              ? { ...(s[ticketId]?.resultsBySkill || {}), [ex.skillName || "implement-ticket-v2"]: ex.resultText }
              : s[ticketId]?.resultsBySkill,
            error: ex.errorMessage ?? "",
            prUrl: ex.prUrl ?? "",
            branch: ex.branch ?? "",
            duration: ex.duration,
            currentStep: ex.currentStep,
          },
        }));
        if (ex.status === "running") {
          startPolling(ticketId, executionId);
        } else if (ex.status === "completed") {
          const next = nextStatusAfter(ex.skillName ?? skillNameHint ?? "", "");
          if (next) setStatusOverrides((so) => (so[ticketId] ? so : { ...so, [ticketId]: next }));
        }
      } catch {
        /* ignore — CTA just stays in its default state */
      }
    },
    [startPolling]
  );

  // Once a ticket's history has loaded, hydrate its exec state so we don't
  // have to have been present for a run to know it happened: prefer an
  // in-progress run (resume polling it), else any completed run that has a
  // PR link — the newest record's own status doesn't matter for that check
  // (a completed run with a PR is "done" even if a later retry failed).
  useEffect(() => {
    if (!selectedId) return;
    const list = history[selectedId];
    if (!list || execs[selectedId]) return;
    const running = list.find((r) => r.status === "running");
    const completedWithPr = list.find((r) => r.status === "completed" && r.prUrl);
    const target = running ?? completedWithPr ?? list[0];
    if (target) hydrateExecution(selectedId, target.id, target.skillName);
  }, [selectedId, history, execs, hydrateExecution]);

  const startImplement = useCallback(
    async (e?: MouseEvent, skillOverride?: string, prUrl?: string) => {
      fireBoltFromEvent(e, { big: true });
      const t = tickets.find((x) => x.id === selectedId);
      if (!t) return;
      const cur = execs[t.id];
      if (cur && cur.status === "running") return;
      // Guard: only statuses with a runnable action can start a run.
      const status0 = getStatus(t);
      if (!skillOverride && !actionInfoFor(status0)) {
        showToast(`Ticket status "${status0}" has no runnable action yet.`);
        return;
      }
      requestNotify();
      const skillName = skillOverride || getSkill(t);
      // Reflect a quick-action skill choice in the per-ticket override.
      if (skillOverride) setOverrides((s) => ({ ...s, [t.id]: { ...(s[t.id] || {}), skill: skillOverride } }));
      setTab("execution");
      setExecs((s) => ({
        ...s,
        [t.id]: { status: "running", logLines: [], resultText: "", resultsBySkill: s[t.id]?.resultsBySkill || {}, error: "" },
      }));
      try {
        window.__reactor?.setMode("running");
      } catch { }
      try {
        const r = await fetch(`/api/tickets/${t.id}/implement`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            skillName,
            projectName: getArea(t),
            rootRepo: getRootRepo(t),
            title: t.title,
            provider: settings.provider,
            ...(prUrl ? { prUrl } : {}),
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
    setSettingsError("");
    setConnTest({ status: "idle", message: "" });
    setSettingsOpen(true);
  };
  const closeSettings = (e?: MouseEvent) => {
    fireBoltFromEvent(e);
    setSettingsOpen(false);
  };
  // Validate connection settings before saving; returns an error string or "".
  const validateSettings = (): string => {
    const url = settings.org.trim();
    if (!url) return `${pm.urlLabel} is required.`;
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return "URL must start with http:// or https://";
    } catch {
      return "Enter a valid URL (e.g. https://…).";
    }
    if (!settings.hasPat && !settings.pat.trim()) return `${pm.tokenLabel} is required.`;
    return "";
  };
  const setField = (k: keyof SettingsView) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSettings((s) => ({ ...s, [k]: e.target.value }));
  // Switching provider immediately reloads the sprint/tickets for that provider.
  const onProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = e.target.value as ProviderId;
    setSettings((s) => ({ ...s, provider }));
    setConnTest({ status: "idle", message: "" });
    loadSprintOptions(provider);
    reloadTickets(provider);
  };
  const testConnection = async () => {
    setConnTest({ status: "testing", message: "" });
    try {
      const r = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: settings.provider, org: settings.org, pat: settings.pat }),
      });
      const data = await r.json();
      setConnTest({ status: data.ok ? "ok" : "fail", message: data.message || (data.ok ? "Connected." : "Failed.") });
    } catch (err) {
      setConnTest({ status: "fail", message: err instanceof Error ? err.message : String(err) });
    }
  };
  const saveSettings = async (e?: MouseEvent) => {
    const err = validateSettings();
    if (err) {
      setSettingsError(err);
      return; // keep modal open, show inline error
    }
    setSettingsError("");
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
      const provider = (data.settings?.provider as ProviderId) ?? settings.provider;
      await loadSprintOptions(provider);
      await reloadTickets(provider);
    } catch {
      showToast("Failed to save settings", 3200);
    }
  };

  // ---- derived ----
  const execStatusOf = (id: string): ExecStatus => execs[id]?.status ?? "not started";
  const activeCount = Object.values(execs).filter((e) => e.status === "running").length;
  const reviewBadgeCount = reviewSummary.reduce(
    (sum, r) => sum + Math.max(0, r.unresolvedCount - (reviewReadMap[r.ticketId]?.count ?? 0)),
    0
  );

  const q = search.trim().toLowerCase();
  const statusOptions = Array.from(new Set(tickets.map((x) => getStatus(x)).filter(Boolean)));
  const typeOptions = Array.from(new Set(tickets.map((x) => x.type).filter(Boolean)));
  const assigneeOptions = Array.from(new Set(tickets.map((x) => x.assignee).filter(Boolean)));
  const filtered = tickets.filter((t) => {
    if (q && !(t.id + " " + t.title + " " + t.assignee + " " + t.project).toLowerCase().includes(q)) return false;
    if (fStatus && getStatus(t) !== fStatus) return false;
    if (fType && t.type !== fType) return false;
    if (fAssignee && t.assignee !== fAssignee) return false;
    return true;
  });
  const activeFilters = (fStatus ? 1 : 0) + (fType ? 1 : 0) + (fAssignee ? 1 : 0);
  const clearFilters = () => { setFStatus(""); setFType(""); setFAssignee(""); };
  // LED-wrapped filter dropdown styling: the border runs only when a value is selected.
  const filterWrapStyle = (active: boolean): CSSProperties =>
    active
      ? { position: "relative", flex: 1, minWidth: 0, height: "32px", borderRadius: "9px", ...ringBorder({ fill: "#14171D", shape: "none", duration: 3.4 }) }
      : { position: "relative", flex: 1, minWidth: 0, height: "32px", border: "1px solid #262B36", borderRadius: "9px", background: "#14171D" };
  const filterSelStyle = (active: boolean): CSSProperties =>
    ({ position: "absolute", inset: 0, width: "100%", height: "100%", padding: "0 26px 0 11px", border: "none", borderRadius: "9px", background: "transparent", color: active ? "#F3F5F9" : "#8A90A0", fontSize: "12px", fontWeight: 600, cursor: "pointer", outline: "none", appearance: "none", colorScheme: "dark" });

  const t = tickets.find((x) => x.id === selectedId);
  const effStatus = t ? getStatus(t) : "";
  const actionInfo = t ? actionInfoFor(effStatus) : null;
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
      clipPath: clipCorner(6),
    };
    if (active)
      return {
        ...base,
        color: "#F3F5F9",
        ...ringBorder({ fill: "#171A21", duration: 3.2, shape: "none" }),
      };
    return {
      ...base,
      border: "1.5px solid transparent",
      background: "transparent",
      color: !enabled ? "#3A4150" : "#8A90A0",
    };
  };

  // action button
  type Action = { label: string; spinner: boolean; playIcon: boolean; onClick: (e?: MouseEvent) => void; style: CSSProperties; title?: string };
  let action: Action;
  if (st === "running")
    action = {
      label: "Running… (cancel)",
      spinner: true,
      playIcon: false,
      onClick: cancelImplement,
      style: ctaButtonStyle("warning"),
    };
  else if (st === "completed")
    action = {
      label: "Show Result", spinner: false, playIcon: false,
      onClick: (e) => { fireBoltFromEvent(e); setTab("result"); },
      style: ctaButtonStyle("success"),
    };
  else if (st === "failed" && ex?.skillName === "fix-code-review-v2")
    action = {
      label: "Retry Fix Code Review",
      spinner: false,
      playIcon: true,
      onClick: (e) => startImplement(e, "fix-code-review-v2", t ? reviews[t.id]?.pr?.url : undefined),
      style: ctaButtonStyle("primary"),
    };
  else if (st === "failed")
    action = {
      label: `Retry ${actionInfo?.label ?? "Implement Ticket"}`, spinner: false, playIcon: true, onClick: startImplement,
      style: ctaButtonStyle("primary"),
    };
  else
    action = {
      label: actionInfo?.label ?? "Implement Ticket", spinner: false, playIcon: true, onClick: startImplement,
      style: ctaButtonStyle("primary"),
    };
  action.style.position = "relative";
  action.style.overflow = "hidden";
  action.style.transition = "filter .18s, transform .12s, box-shadow .25s";
  if (st === "not started" || st === "failed")
    action.style.animation = "spinAngle 3s linear infinite, breathe 2.8s ease-in-out infinite";

  // Gate: a run can only start when the effective status maps to an action.
  // Exception: retrying a failed fix-code-review-v2 run is always valid — it
  // isn't driven by ticket status, so it must bypass the status-based gate.
  const isFixReviewRetry = st === "failed" && ex?.skillName === "fix-code-review-v2";
  const startsNewRun = st === "not started" || st === "failed";
  const gated = !!t && startsNewRun && !actionInfo && !isFixReviewRetry;
  if (gated) {
    const reason = `Ticket status "${effStatus}" has no runnable action yet.`;
    action.onClick = (e) => {
      fireBoltFromEvent(e);
      showToast(reason);
    };
    action.playIcon = false;
    action.title = reason;
    action.style = {
      ...action.style,
      cursor: "not-allowed",
      opacity: 0.45,
      filter: "grayscale(.4)",
      animation: "none",
    };
  }

  // Secondary "next action" button — after a run completes, offer the action that
  // matches the (auto-advanced) status, e.g. "Review Code" once implement finishes.
  const showSecondaryAction = st === "completed" && !!actionInfo;
  const secondaryAction = showSecondaryAction
    ? { label: actionInfo!.label, onClick: (e?: MouseEvent) => startImplement(e), style: ctaButtonStyle("ghost") }
    : null;
  const secondaryCtaButtonStyle: CSSProperties = { ...ctaButtonStyle("ghost", { height: "38px" }), padding: "0 20px", fontSize: "13px", flex: "0 0 auto" };

  const bannerCtaStyle: CSSProperties = { ...action.style, height: "38px", padding: "0 20px", fontSize: "13px", flex: "0 0 auto" };
  const ctaTitle = gated ? "No action for this status" : st === "completed" ? "Implementation complete" : st === "failed" ? "Last run failed" : st === "running" ? "Claude Code is working…" : actionInfo?.label === "Review Code" ? "Ready for review" : "Ready to implement";
  const ctaSub = t
    ? gated ? `This ticket is "${effStatus}". Move it to "Ready for Dev", "In Progress", or "Code Review" to enable a run.`
      : st === "completed" ? "Open the Result tab to review what Claude changed."
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
    letterSpacing: ".1em", textTransform: "uppercase",
    ...pill({ color: lsc, background: "rgba(255,255,255,.04)", border: lsc + "55", size: "xs", weight: 700 }),
    padding: "2px 9px",
  };

  const selProject = t ? getArea(t) : "";
  const selBranch = t ? branchOf(t.id, t.title) : "";
  const selCommand = t ? `/${getSkill(t)} ID: ${t.id} - Project name: ${getArea(t)}` : "";
  const selCdCommand = t ? `cd ${getRootRepo(t)} && claude` : "";
  const selExecPillStyle: CSSProperties = pill({ color: EXEC_COLOR[st], background: "rgba(255,255,255,.03)", border: EXEC_COLOR[st] + "44", size: "md", weight: 600 });

  // Split the result into per-skill sections (Implementation / Code Review),
  // keeping the results of every run this ticket has been through.
  const resultsBySkill: Record<string, string> =
    ex?.resultsBySkill && Object.keys(ex.resultsBySkill).length
      ? ex.resultsBySkill
      : ex?.resultText
        ? { "implement-ticket-v2": ex.resultText }
        : {};
  const resultSections = Object.keys(resultsBySkill)
    .sort((a, b) => RESULT_SKILL_ORDER.indexOf(a) - RESULT_SKILL_ORDER.indexOf(b))
    .map((sk) => ({ key: sk, title: RESULT_SKILL_TITLE[sk] || sk, markdown: resultsBySkill[sk] }));

  const EMPTY_REVIEW: ReviewData = { pr: null, comments: [], unresolvedCount: 0 };
  const ticketReview: ReviewData = t ? reviews[t.id] ?? EMPTY_REVIEW : EMPTY_REVIEW;
  const fixReviewRunning = st === "running" && ex?.skillName === "fix-code-review-v2";
  const fixReviewDisabled = ticketReview.unresolvedCount === 0 || (st === "running" && !fixReviewRunning);
  const showResultSectionHeader = resultSections.length > 1;
  const showResult = tab === "result" && resultSections.length > 0;

  // active provider metadata drives Settings field labels + placeholders
  const pm = providerMeta(settings.provider);
  const fieldInputStyle: CSSProperties = {
    height: "40px", padding: "0 13px", border: "1px solid #262B36", borderRadius: "9px",
    background: "#0E1015", color: "#ECEEF3", fontFamily: "var(--font-mono), monospace",
    fontSize: "13px", outline: "none",
  };
  const fieldLabelStyle: CSSProperties = {
    fontSize: "11px", letterSpacing: ".1em", fontWeight: 600, color: "#8A90A0",
  };

  return (
    <div
      style={{
        position: "relative", height: "100vh", width: "100%", display: "flex", flexDirection: "column",
        background: "transparent", color: "#ECEEF3", fontFamily: "var(--font-hanken), sans-serif",
        overflow: "hidden", ["--accent" as string]: ACCENT,
      }}
    >
      <Reactor accent={ACCENT} frozen={!settings.animatedBackground} />
      <BoltLayer bolts={bolts} flashes={flashes} />

      {/* Header */}
      <header style={{ height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "16px", padding: "0 22px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "rgba(14,17,23,.72)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", position: "relative", zIndex: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "34px", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 22px -8px var(--accent)", ...ringBorder({ fill: "var(--accent)", variant: "filled", duration: 3.4 }) }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M8 5l8 7-8 7" stroke="#0B0C10" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
            <span style={{ fontFamily: "var(--font-space), sans-serif", fontWeight: 700, fontSize: "16px", letterSpacing: ".01em", background: "linear-gradient(90deg,var(--accent) 0%,#FFC15E 18%,#FF5F3D 36%,var(--accent) 54%,#FFC15E 72%,#FF5F3D 90%,var(--accent) 100%)", backgroundSize: "300% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "fireFlow 3.6s linear infinite,fireFlicker 2.2s ease-in-out infinite" }}>Ticket Executor</span>
            <span style={{ fontSize: "10px", letterSpacing: ".16em", fontWeight: 600, marginTop: "4px", background: "linear-gradient(90deg,#5B6273 0%,#5B6273 30%,#FFD9BE 45%,var(--accent) 52%,#5B6273 65%,#5B6273 100%)", backgroundSize: "220% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "subtitleFlow 3.2s linear infinite" }}>CLAUDE CODE · {pm.short}</span>
          </div>
        </div>
        <SprintPicker label={sprintLabel} options={sprintOptions} value={selectedSprint} onSelect={onSprintChange} />
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: "7px", height: "30px", padding: "0 13px", fontSize: "12.5px", color: "#8A90A0", whiteSpace: "nowrap", ...ringBorder({ fill: "#14171D", shape: "pill", duration: 3.4 }) }}>
          <span style={{ fontFamily: "var(--font-mono), monospace", color: "#C7CCD8", fontWeight: 600 }}>{activeCount}</span> active runs
        </div>
        <div ref={bellRef} style={{ position: "relative" }}>
          <button
            onClick={(e) => { fireBoltFromEvent(e as unknown as MouseEvent); setBellOpen((o) => !o); }}
            title="Unresolved review comments"
            style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: "30px", height: "30px", color: reviewBadgeCount > 0 ? "var(--accent)" : "#8A90A0", cursor: "pointer", transition: "filter .15s,transform .12s", ...ringBorder({ fill: reviewBadgeCount > 0 ? "rgba(251,114,80,.14)" : "#14171D", duration: 3.4, cornerPx: 7 }) }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
            {reviewBadgeCount > 0 && (
              <span style={{ position: "absolute", top: "-4px", right: "-4px", minWidth: "15px", height: "15px", padding: "0 3px", borderRadius: "999px", background: "var(--accent)", color: "#0B0C10", fontSize: "9.5px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{reviewBadgeCount}</span>
            )}
          </button>
          {bellOpen && (
            <div className="te-scroll" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40, width: "340px", animation: "fadeUp .16s ease-out both", ...dropdownPanelStyle({ maxHeight: "360px" }) }}>
              {reviewSummary.length === 0 && (
                <div style={{ padding: "16px 12px", fontSize: "12.5px", color: "#5B6273", textAlign: "center" }}>No unresolved review comments.</div>
              )}
              {reviewSummary.map((rv) => {
                const readEntry = reviewReadMap[rv.ticketId];
                const unread = Math.max(0, rv.unresolvedCount - (readEntry?.count ?? 0));
                const isUnread = unread > 0;
                return (
                  <button
                    key={rv.ticketId}
                    onClick={(e) => { markReviewRead(rv); selectTicket(rv.ticketId, e); setTab("resolve-review"); setBellOpen(false); }}
                    style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%", textAlign: "left", padding: "10px 11px", borderRadius: "9px", border: "none", cursor: "pointer", background: isUnread ? "rgba(251,114,80,.08)" : "transparent", marginBottom: "2px" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: isUnread ? "var(--accent)" : "transparent", flex: "0 0 auto" }} />
                      <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "12px", fontWeight: 700, color: isUnread ? "var(--accent)" : "#6B7283" }}>#{rv.ticketId}</span>
                      <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "12px", fontWeight: 700, color: isUnread ? "#E4E7EE" : "#6B7283" }}>PR #{rv.prId}</span>
                    </div>
                    <div style={{ fontSize: "12px", color: isUnread ? "#9A9FAD" : "#5B6273", lineHeight: 1.5, paddingLeft: "13px" }}>
                      {rv.reviewer} left {rv.unresolvedCount} review comment{rv.unresolvedCount === 1 ? "" : "s"} — {rv.prTitle}
                    </div>
                    <div style={{ fontSize: "11px", color: "#5B6273", lineHeight: 1.4, paddingLeft: "13px" }}>
                      {isUnread ? rv.latestAt : `Read ${timeAgo(readEntry!.readAt)}`}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button onClick={openSettings} style={{ display: "flex", alignItems: "center", gap: "7px", height: "30px", padding: "0 13px 0 11px", color: "#C7CCD8", fontSize: "12px", fontWeight: 600, cursor: "pointer", transition: "filter .15s,transform .12s", ...ringBorder({ fill: "#14171D", duration: 3.4, cornerPx: 7 }) }}>
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
              <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "11.5px", color: "#5B6273" }}>{(activeFilters > 0 || q) ? `${filtered.length}/${tickets.length}` : tickets.length} tickets</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "9px", height: "36px", padding: "0 12px", ...ringBorder({ fill: "#14171D", duration: 4.2 }) }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5B6273" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets, people…" style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "#ECEEF3", fontSize: "13px" }} />
              </div>
              <button onClick={() => setFiltersOpen((o) => !o)} title="Filters" style={{ position: "relative", flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", color: (filtersOpen || activeFilters > 0) ? "var(--accent)" : "#8A90A0", cursor: "pointer", ...ringBorder({ fill: (filtersOpen || activeFilters > 0) ? "rgba(251,114,80,.14)" : "#14171D", duration: 4.2 }) }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
                {activeFilters > 0 && <span style={{ position: "absolute", top: "-4px", right: "-4px", minWidth: "15px", height: "15px", padding: "0 3px", borderRadius: "999px", background: "var(--accent)", color: "#0B0C10", fontSize: "9.5px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{activeFilters}</span>}
              </button>
            </div>
            {filtersOpen && (
              <div style={{ display: "flex", alignItems: "center", gap: "7px", animation: "fadeUp .18s ease-out both" }}>
                {([
                  { v: fStatus, set: setFStatus, label: "Status", opts: statusOptions },
                  { v: fType, set: setFType, label: "Type", opts: typeOptions },
                  { v: fAssignee, set: setFAssignee, label: "Assignee", opts: assigneeOptions },
                ] as const).map((f) => (
                  <div key={f.label} style={filterWrapStyle(!!f.v)}>
                    <select value={f.v} onChange={(e) => f.set(e.target.value)} title={f.label} style={filterSelStyle(!!f.v)}>
                      <option value="" style={{ background: "#14171D", color: "#8A90A0" }}>{f.label}: All</option>
                      {f.opts.map((o) => (<option key={o} value={o} style={{ background: "#14171D", color: "#ECEEF3" }}>{o}</option>))}
                    </select>
                  </div>
                ))}
                {activeFilters > 0 && (
                  <button onClick={clearFilters} title="Clear filters" style={{ flex: "0 0 auto", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #262B36", borderRadius: "9px", background: "transparent", color: "#8A90A0", cursor: "pointer" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
                )}
              </div>
            )}
          </div>
          <div className="te-scroll te-scroll--smooth" style={{ flex: 1, overflowY: "auto", padding: "2px 12px 16px", display: "flex", flexDirection: "column", gap: "7px", minHeight: 0 }}>
            {loading && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "20px", padding: "58px 6px 46px" }}>
                <div ref={loadingCoreRef} style={{ position: "relative", width: "78px", height: "78px" }}>
                  {/* outer spinning conic-gradient ring — same technique as the header pills */}
                  <span
                    style={{
                      position: "absolute", inset: "-9px", borderRadius: "50%", padding: "2px",
                      background: "conic-gradient(from var(--angle), transparent, var(--accent), transparent 55%)",
                      WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                      WebkitMaskComposite: "xor", maskComposite: "exclude",
                      animation: "spinAngle 3.2s linear infinite",
                    }}
                  />
                  {/* counter-rotating faceted ring for extra crispness */}
                  <span
                    style={{
                      position: "absolute", inset: "9px", borderRadius: "50%", padding: "1.5px",
                      background: "conic-gradient(from var(--angle), var(--accent) 0deg 8deg, transparent 8deg 42deg, var(--accent) 42deg 50deg, transparent 50deg 92deg, var(--accent) 92deg 100deg, transparent 100deg 180deg, var(--accent) 180deg 188deg, transparent 188deg 230deg, var(--accent) 230deg 238deg, transparent 238deg 360deg)",
                      WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                      WebkitMaskComposite: "xor", maskComposite: "exclude",
                      animation: "spinAngle 2.1s linear infinite reverse",
                      opacity: 0.8,
                    }}
                  />
                  {/* shockwave rings releasing outward */}
                  <span style={{ position: "absolute", inset: "6px", borderRadius: "50%", border: "1px solid rgba(251,114,80,.55)", animation: "ringPulse 1.8s ease-out infinite" }} />
                  <span style={{ position: "absolute", inset: "6px", borderRadius: "50%", border: "1px solid rgba(251,114,80,.32)", animation: "ringPulse 1.8s ease-out .9s infinite" }} />
                  {/* orbiting sparks */}
                  <div style={{ position: "absolute", inset: 0, animation: "spin 2.3s linear infinite" }}>
                    <span style={{ position: "absolute", top: "50%", left: "50%", width: "5px", height: "5px", borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 7px var(--accent)", transform: "translate(-50%,-50%) translateX(37px)" }} />
                  </div>
                  <div style={{ position: "absolute", inset: 0, animation: "spin 1.5s linear infinite reverse" }}>
                    <span style={{ position: "absolute", top: "50%", left: "50%", width: "4px", height: "4px", borderRadius: "50%", background: "#FFD9BE", boxShadow: "0 0 6px #FFC15E", transform: "translate(-50%,-50%) translateX(29px)" }} />
                  </div>
                  {/* core sphere — off-center highlight for a sharper, dimensional look */}
                  <span
                    style={{
                      position: "absolute", inset: "22px", borderRadius: "50%",
                      background: "radial-gradient(circle at 34% 32%, #FFF3EA 0%, #FFC15E 14%, var(--accent) 40%, rgba(251,114,80,.65) 62%, transparent 80%)",
                      boxShadow: "0 0 20px 2px rgba(251,114,80,.55)",
                      animation: "corePulse 1.1s ease-in-out infinite",
                    }}
                  />
                </div>
                <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#8A90A0", letterSpacing: ".02em" }}>Loading sprint…</span>
              </div>
            )}
            {!loading && loadError && <div style={{ color: "#FF8F8F", fontSize: "12.5px", lineHeight: 1.5, ...tintedCard("danger", { padding: "14px", radius: "10px" }) }}>{loadError}</div>}
            {!loading && !loadError && ticketsNotice && <div style={{ color: "#C7A98A", fontSize: "12.5px", lineHeight: 1.5, ...tintedCard("warning", { padding: "14px", radius: "10px" }) }}>{ticketsNotice}</div>}
            {!loading && !loadError && !ticketsNotice && filtered.length === 0 && <div style={{ color: "#5B6273", fontSize: "13px", padding: "18px 6px" }}>No tickets match.</div>}
            {!loading && filtered.map((tk, i) => {
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
                    <span style={statusPill(getStatus(tk))}>{getStatus(tk)}</span>
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
                  <div ref={statusMenuRef} style={{ position: "relative" }}>
                    <button onClick={() => setStatusMenuOpen((o) => !o)} style={statusPillActive(effStatus)}>
                      {effStatus}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ transform: statusMenuOpen ? "rotate(180deg)" : "none", transition: "transform .18s" }}><path d="M6 9l6 6 6-6" /></svg>
                    </button>
                    {statusMenuOpen && (
                      <div className="te-scroll" style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 30, animation: "fadeUp .16s ease-out both", ...dropdownPanelStyle({ minWidth: "190px", maxHeight: "280px" }) }}>
                        {STATUS_ALL.map((s) => (
                          <button key={s} onClick={(e) => selectStatus(t.id, s, e)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: "8px", border: "none", cursor: "pointer", background: s === effStatus ? "rgba(251,114,80,.14)" : "transparent", color: s === effStatus ? "var(--accent)" : "#C7CCD8", fontSize: "12.5px", fontWeight: s === effStatus ? 700 : 500 }}>{s}</button>
                        ))}
                      </div>
                    )}
                  </div>
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
                  <button onClick={() => setTab("resolve-review")} style={{ ...tabStyle("resolve-review", true), display: "flex", alignItems: "center", gap: "6px" }}>
                    Resolve Review
                    {ticketReview.unresolvedCount > 0 && (
                      <span style={{ ...pill({ color: "#0B0C10", background: "var(--accent)", size: "xs", weight: 700 }), padding: "1px 6px" }}>{ticketReview.unresolvedCount}</span>
                    )}
                  </button>
                  <button onClick={() => resultEnabled && setTab("result")} style={tabStyle("result", resultEnabled)}>Result</button>
                  <div style={{ flex: 1 }} />
                  <div style={{ paddingBottom: "8px", display: "flex", alignItems: "center", gap: "7px" }}>
                    <button onClick={action.onClick} title={action.title} aria-disabled={gated} style={action.style}>
                      {action.playIcon && <span style={{ position: "absolute", top: 0, left: "-45%", width: "45%", height: "100%", background: "linear-gradient(100deg,transparent,rgba(255,255,255,.32),transparent)", animation: "sheen 3.6s ease-in-out infinite", pointerEvents: "none" }} />}
                      {action.spinner && <span style={{ width: "14px", height: "14px", borderRadius: "50%", border: "2px solid rgba(11,12,16,.3)", borderTopColor: "#0B0C10", display: "inline-block", animation: "spin .7s linear infinite", position: "relative", zIndex: 1 }} />}
                      {action.playIcon && <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ position: "relative", zIndex: 1 }}><path d="M7 4l13 8-13 8z" /></svg>}
                      <span style={{ position: "relative", zIndex: 1 }}>{action.label}</span>
                    </button>
                    {secondaryAction && (
                      <button onClick={secondaryAction.onClick} style={secondaryAction.style}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ position: "relative", zIndex: 1 }}><path d="M7 4l13 8-13 8z" /></svg>
                        <span style={{ position: "relative", zIndex: 1 }}>{secondaryAction.label}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="te-scroll te-scroll--smooth" style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", minHeight: 0, padding: "24px 28px 44px" }}>
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
                            <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start", ...card({ padding: "12px 14px", border: COLORS.borderSubtle }) }}>
                              <span style={{ flex: "0 0 auto", width: "18px", height: "18px", borderRadius: "6px", border: "1.5px solid #2E3644", display: "flex", alignItems: "center", justifyContent: "center", marginTop: "1px" }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#5B6273" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg></span>
                              <span style={{ fontSize: "13.5px", color: "#C7CCD8", lineHeight: 1.5 }}>{c}</span>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                    {(comments[t.id]?.length ?? 0) > 0 && (
                      <section>
                        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                          {comments[t.id].map((cm, i) => (
                            <div key={i} style={{ display: "flex", gap: "11px", alignItems: "flex-start" }}>
                              <span style={{ ...avatar(cm.author), flex: "0 0 auto", width: "28px", height: "28px", fontSize: "11px" }}>{initials(cm.author)}</span>
                              <div style={{ flex: 1, minWidth: 0, ...card({ padding: "11px 14px", border: COLORS.borderSubtle }) }}>
                                <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#E4E7EE" }}>{cm.author}</span>
                                  <span style={{ fontSize: "11.5px", color: "#6B7283", textDecoration: "underline", textDecorationColor: "#2A2F3A" }}>commented {cm.date}</span>
                                </div>
                                <div style={{ fontSize: "13.5px", lineHeight: 1.65, color: "#C7CCD8", marginTop: "5px" }}>{renderCommentBody(cm.text)}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                    <section style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" }}>
                      <div style={card()}><div style={{ fontSize: "10.5px", letterSpacing: ".12em", color: "#5B6273", fontWeight: 600, marginBottom: "6px" }}>ROOT REPO</div><Combobox value={getRootRepo(t)} onChange={(v) => setOverrideValue(t.id, "rootRepo", v)} options={rootRepoOptions} ariaLabel="Root repo" /></div>
                      <div style={card()}><div style={{ fontSize: "10.5px", letterSpacing: ".12em", color: "#5B6273", fontWeight: 600, marginBottom: "6px" }}>PROJECT</div><Combobox value={getArea(t)} onChange={(v) => setOverrideValue(t.id, "area", v)} options={projectOptions} ariaLabel="Project" /></div>
                      <div style={card()}><div style={{ fontSize: "10.5px", letterSpacing: ".12em", color: "#5B6273", fontWeight: 600, marginBottom: "6px" }}>SKILL</div><Combobox value={getSkill(t)} onChange={(v) => setOverrideValue(t.id, "skill", v)} options={skillOptions} ariaLabel="Skill" /></div>
                      <div style={card({ padding: "13px 15px", border: COLORS.borderSubtle })}><div style={{ fontSize: "10.5px", letterSpacing: ".12em", color: "#5B6273", fontWeight: 600, marginBottom: "6px" }}>TARGET BRANCH</div><div style={{ fontFamily: "var(--font-mono), monospace", fontSize: "12.5px", color: "#9BA6E8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selBranch}</div></div>
                    </section>
                    <section>
                      <h3 style={{ margin: "0 0 12px", fontFamily: "var(--font-space), sans-serif", fontSize: "11px", fontWeight: 700, letterSpacing: ".16em", color: "#5B6273" }}>COMMAND PREVIEW</h3>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontFamily: "var(--font-mono), monospace", fontSize: "13px", ...card({ padding: "15px 18px", radius: "12px", border: "#23272F", background: COLORS.panelBgDark }) }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><span style={{ color: "#5B6273" }}>$</span><span style={{ color: "#8A90A0" }}>{selCdCommand}</span></div>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><span style={{ color: "var(--accent)" }}>$</span><span style={{ color: "#C7CCD8" }}>{selCommand}</span></div>
                      </div>
                    </section>
                    {(history[t.id]?.length ?? 0) > 0 && (
                      <section>
                        <h3 style={{ margin: "0 0 12px", fontFamily: "var(--font-space), sans-serif", fontSize: "11px", fontWeight: 700, letterSpacing: ".16em", color: "#5B6273" }}>PAST RUNS</h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {history[t.id].map((run) => (
                            <button key={run.id} onClick={(e) => openRun(t.id, run.id, e)} style={{ display: "flex", alignItems: "center", gap: "11px", cursor: "pointer", textAlign: "left", transition: "border-color .18s, background .18s", ...card({ padding: "10px 13px", border: COLORS.borderSubtle }) }}>
                              <span style={{ ...execDot(run.status), width: "8px", height: "8px" }} />
                              <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "12px", color: "#C7CCD8", flex: "0 0 auto" }}>{run.skillName}</span>
                              <span style={{ fontSize: "12px", color: "#5B6273", flex: 1 }}>{new Date(run.startedAt).toLocaleString()}</span>
                              <span style={{ fontSize: "11.5px", fontWeight: 600, color: EXEC_COLOR[run.status] }}>{EXEC_LABEL[run.status]}</span>
                            </button>
                          ))}
                        </div>
                      </section>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: "16px", ...tintedCard("accent", { padding: "20px 22px", radius: "14px" }) }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: "15px", fontWeight: 700, color: "#F3F5F9", marginBottom: "3px" }}>{ctaTitle}</div>
                        <div style={{ fontSize: "13px", color: "#9A9FAD" }}>{ctaSub}</div>
                      </div>
                      <button onClick={action.onClick} title={action.title} aria-disabled={gated} style={bannerCtaStyle}>
                        {action.playIcon && <span style={{ position: "absolute", top: 0, left: "-45%", width: "45%", height: "100%", background: "linear-gradient(100deg,transparent,rgba(255,255,255,.32),transparent)", animation: "sheen 3.6s ease-in-out infinite", pointerEvents: "none" }} />}
                        {action.spinner && <span style={{ width: "15px", height: "15px", borderRadius: "50%", border: "2px solid rgba(11,12,16,.3)", borderTopColor: "#0B0C10", display: "inline-block", animation: "spin .7s linear infinite", position: "relative", zIndex: 1 }} />}
                        {action.playIcon && <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ position: "relative", zIndex: 1 }}><path d="M7 4l13 8-13 8z" /></svg>}
                        <span style={{ position: "relative", zIndex: 1 }}>{action.label}</span>
                      </button>
                      {secondaryAction && (
                        <button onClick={secondaryAction.onClick} style={secondaryCtaButtonStyle}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ position: "relative", zIndex: 1 }}><path d="M7 4l13 8-13 8z" /></svg>
                          <span style={{ position: "relative", zIndex: 1 }}>{secondaryAction.label}</span>
                        </button>
                      )}
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
                      <div style={{ position: "relative", flex: 1, minWidth: 0, borderRadius: "13px", overflow: "hidden", boxShadow: "0 24px 60px -34px #000", ...ringBorder({ fill: "#0A0B0E", duration: 5.5, shape: "none" }) }}>
                        <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", background: "repeating-linear-gradient(0deg,rgba(255,255,255,.016) 0px,rgba(255,255,255,.016) 1px,transparent 1px,transparent 3px)" }} />
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "1px", zIndex: 0, pointerEvents: "none", background: "linear-gradient(90deg,transparent,var(--accent),transparent)", opacity: 0.55 }} />
                        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: "10px", padding: "11px 15px", borderBottom: "1px solid #1A1E25", background: "#0E1015" }}>
                          <span style={{ display: "flex", gap: "6px" }}><span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#3A3030" }} /><span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#3A3830" }} /><span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#2F3A32" }} /></span>
                          <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "11.5px", color: "#6B7283", marginLeft: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>claude-code — {selProject}</span>
                          <div style={{ flex: 1 }} />
                          <span style={logStatusStyle}>{lsl}</span>
                        </div>
                        <div ref={logRef} className="te-scroll" style={{ position: "relative", zIndex: 1, height: "430px", overflowY: "auto", padding: "14px 17px", fontFamily: "var(--font-mono), monospace", fontSize: "12.5px", lineHeight: 1.75 }}>
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
                      <div style={{ display: "flex", gap: "13px", alignItems: "flex-start", ...tintedCard("danger") }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" strokeWidth="2" style={{ flex: "0 0 auto", marginTop: "1px" }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
                        <div><div style={{ fontSize: "13.5px", fontWeight: 700, color: "#FF8F8F", marginBottom: "3px" }}>Execution failed</div><div style={{ fontSize: "13px", color: "#C7A8A8", lineHeight: 1.55 }}>{ex.error}</div></div>
                      </div>
                    )}
                  </div>
                )}

                {tab === "resolve-review" && (
                  <div style={{ maxWidth: "800px", display: "flex", flexDirection: "column", gap: "22px", animation: "fadeUp .35s both" }}>
                    {!ticketReview.pr ? (
                      <div style={{ color: "#5B6273", fontSize: "13.5px", ...card({ padding: "22px" }) }}>
                        No pull request linked to this ticket yet.
                      </div>
                    ) : (
                      <>
                        <section style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr", gap: "10px" }}>
                          <div style={card()}>
                            <div style={{ fontSize: "10.5px", letterSpacing: ".12em", color: "#5B6273", fontWeight: 600, marginBottom: "6px" }}>PULL REQUEST</div>
                            <a href={ticketReview.pr.url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "var(--font-mono), monospace", fontSize: "13px", color: "#9BA6E8", textDecoration: "none" }}>
                              PR #{ticketReview.pr.id} — {ticketReview.pr.branch}
                            </a>
                          </div>
                          <div style={card()}>
                            <div style={{ fontSize: "10.5px", letterSpacing: ".12em", color: "#5B6273", fontWeight: 600, marginBottom: "6px" }}>STATUS</div>
                            <span style={statusPill(ticketReview.pr.status)}>{ticketReview.pr.status}</span>
                          </div>
                          <div style={card()}>
                            <div style={{ fontSize: "10.5px", letterSpacing: ".12em", color: "#5B6273", fontWeight: 600, marginBottom: "6px" }}>CREATED</div>
                            <div style={{ fontSize: "12.5px", color: "#C7CCD8" }}>{timeAgo(ticketReview.pr.createdAt)}</div>
                          </div>
                        </section>
                        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                          <div style={card()}>
                            <div style={{ fontSize: "10.5px", letterSpacing: ".12em", color: "#5B6273", fontWeight: 600, marginBottom: "6px" }}>AUTHOR</div>
                            <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#E4E7EE" }}><span style={avatar(ticketReview.pr.author)}>{initials(ticketReview.pr.author)}</span>{ticketReview.pr.author}</span>
                          </div>
                          <div style={card()}>
                            <div style={{ fontSize: "10.5px", letterSpacing: ".12em", color: "#5B6273", fontWeight: 600, marginBottom: "6px" }}>REVIEWER</div>
                            <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#E4E7EE" }}>
                              {ticketReview.pr.reviewers[0] ? (<><span style={avatar(ticketReview.pr.reviewers[0])}>{initials(ticketReview.pr.reviewers[0])}</span>{ticketReview.pr.reviewers[0]}</>) : "Unassigned"}
                            </span>
                          </div>
                        </section>
                        {ticketReview.comments.length > 0 && (
                          <section>
                            <h3 style={{ margin: "0 0 12px", fontFamily: "var(--font-space), sans-serif", fontSize: "11px", fontWeight: 700, letterSpacing: ".16em", color: "#5B6273" }}>REVIEW COMMENTS</h3>
                            <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                              {ticketReview.comments.map((c) => (
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
                        <div style={{ display: "flex", alignItems: "center", gap: "16px", ...tintedCard(ticketReview.unresolvedCount > 0 ? "danger" : "success", { padding: "18px 20px", radius: "13px" }) }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: "14.5px", fontWeight: 700, color: "#F3F5F9" }}>
                              {ticketReview.unresolvedCount > 0 ? "Unresolved review comments" : "All review comments resolved"}
                            </div>
                            <div style={{ fontSize: "13px", color: "#9A9FAD", marginTop: "2px" }}>
                              {ticketReview.unresolvedCount > 0 ? `${ticketReview.unresolvedCount} issue(s) to fix from the code review.` : "Nothing left to fix on this PR."}
                            </div>
                          </div>
                          <button
                            onClick={(e) => startImplement(e, "fix-code-review-v2", ticketReview.pr!.url)}
                            disabled={fixReviewDisabled}
                            style={{ ...ctaButtonStyle(fixReviewDisabled ? "outline" : "primary"), height: "38px", padding: "0 20px", fontSize: "13px", flex: "0 0 auto", opacity: fixReviewDisabled ? 0.5 : 1, cursor: fixReviewDisabled ? "not-allowed" : "pointer" }}
                          >
                            {fixReviewRunning && <span style={{ width: "14px", height: "14px", borderRadius: "50%", border: "2px solid rgba(11,12,16,.3)", borderTopColor: "#0B0C10", display: "inline-block", animation: "spin .7s linear infinite" }} />}
                            {!fixReviewRunning && <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z" /></svg>}
                            <span>{fixReviewRunning ? "Running…" : "Fix Code Review"}</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {showResult && ex && (
                  <div style={{ maxWidth: "800px", display: "flex", flexDirection: "column", gap: "26px", animation: "fadeUp .35s both" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px", ...tintedCard("success", { padding: "16px 18px", radius: "13px" }) }}>
                      <span style={{ flex: "0 0 auto", width: "40px", height: "40px", borderRadius: "11px", background: "rgba(53,214,164,.14)", border: "1px solid #35D6A4", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#35D6A4" strokeWidth="2.6"><path d="M5 13l4 4L19 7" style={{ strokeDasharray: 26, strokeDashoffset: 26, animation: "draw .6s .2s ease forwards" }} /></svg></span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: "15px", fontWeight: 700, color: "#F3F5F9" }}>Implementation complete</div>
                        <div style={{ fontSize: "12.5px", color: "#8A90A0", marginTop: "2px" }}>Finished{ex.duration ? <> in <span style={{ color: "#C7CCD8", fontWeight: 600 }}>{ex.duration}</span></> : ""} · Claude Code output below</div>
                      </div>
                      {ex.branch && (
                        <span
                          title="Branch"
                          style={{
                            fontFamily: "var(--font-mono), monospace",
                            maxWidth: "220px",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                            ...pill({ color: COLORS.indigo, background: "rgba(155,166,232,.08)", border: "#2E3450", size: "md" }),
                            gap: "6px",
                            padding: "5px 10px",
                            fontWeight: 400,
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flex: "0 0 auto" }}><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="8" r="2.5" /><path d="M6 8.5v7M18 10.5c0 3-3 3.5-6 3.5" /></svg>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{ex.branch}</span>
                        </span>
                      )}
                      {ex.prUrl && (
                        <a
                          href={ex.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => fireBoltFromEvent(e as unknown as MouseEvent, { color: "#35D6A4" })}
                          style={{
                            flex: "0 0 auto",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "7px",
                            height: "32px",
                            padding: "0 14px",
                            textDecoration: "none",
                            color: "#5BE8B8",
                            fontSize: "12px",
                            fontWeight: 700,
                            cursor: "pointer",
                            // Opaque fill so the spinning conic-gradient stays confined to the
                            // border ring, matching the subtle tab/CTA glow instead of bleeding
                            // through the translucent fill as a harsh diagonal sweep.
                            ...ringBorder({ fill: "#162F2C", ring: COLORS.success, highlight: "#baf5e3", duration: 3 }),
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14L21 3" /></svg>
                          Open PR
                        </a>
                      )}
                    </div>
                    {resultSections.map((rs) => (
                      <div key={rs.key}>
                        {showResultSectionHeader && (
                          <h2 style={{ margin: "0 0 10px", fontFamily: "var(--font-space), sans-serif", fontSize: "13px", fontWeight: 700, letterSpacing: ".06em", color: "var(--accent)", textTransform: "uppercase" }}>{rs.title}</h2>
                        )}
                        <div className="md-body">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{rs.markdown}</ReactMarkdown>
                        </div>
                      </div>
                    ))}
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
              <div><div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: "16px", fontWeight: 700, color: "#F3F5F9" }}>Settings</div><div style={{ fontSize: "12px", color: "#6B7283", marginTop: "2px" }}>Connect your work-tracking provider &amp; execution defaults</div></div>
              <button onClick={closeSettings} style={{ width: "26px", height: "26px", color: "#8A90A0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", ...ringBorder({ fill: "#1A1E25", duration: 4, cornerPx: 6 }) }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
            </div>
            <div style={{ padding: "22px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "7px" }}><span style={fieldLabelStyle}>PROVIDER</span><select value={settings.provider} onChange={onProviderChange} style={{ ...fieldInputStyle, fontFamily: "var(--font-hanken), sans-serif", cursor: "pointer", appearance: "none", backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238A90A0' stroke-width='2'><path d='M6 9l6 6 6-6'/></svg>\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }}>{PROVIDERS.map((p) => (<option key={p.id} value={p.id} style={{ background: "#14171D" }}>{p.name}</option>))}</select></label>
              <label style={{ display: "flex", flexDirection: "column", gap: "7px" }}><span style={fieldLabelStyle}>{pm.urlLabel}</span><input value={settings.org} onChange={setField("org")} placeholder={pm.urlPlaceholder} style={fieldInputStyle} /></label>
              <label style={{ display: "flex", flexDirection: "column", gap: "7px" }}><span style={fieldLabelStyle}>{pm.tokenLabel}</span><input type="password" value={settings.pat} onChange={setField("pat")} placeholder={settings.hasPat ? "•••••••••••••• (saved)" : "••••••••••••••••"} style={fieldInputStyle} /></label>
              <div style={{ display: "flex", alignItems: "center", gap: "11px" }}>
                <button onClick={testConnection} disabled={connTest.status === "testing"} style={{ display: "inline-flex", alignItems: "center", gap: "7px", height: "30px", padding: "0 13px", border: "1.5px solid #2A2F3A", background: "#0E1015", color: "#C7CCD8", fontSize: "12px", fontWeight: 600, cursor: connTest.status === "testing" ? "default" : "pointer", clipPath: "polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)" }}>
                  {connTest.status === "testing" ? <span style={{ width: "13px", height: "13px", borderRadius: "50%", border: "2px solid rgba(199,204,216,.3)", borderTopColor: "#C7CCD8", display: "inline-block", animation: "spin .7s linear infinite" }} /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h7l-1 8 10-12h-7z" /></svg>}
                  Test connection
                </button>
                {connTest.status !== "idle" && connTest.status !== "testing" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600, color: connTest.status === "ok" ? "#5BE8B8" : "#FF8F8F", lineHeight: 1.4 }}>
                    <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: connTest.status === "ok" ? "#35D6A4" : "#FF6B6B", boxShadow: "0 0 8px " + (connTest.status === "ok" ? "#35D6A4" : "#FF6B6B"), flex: "0 0 auto" }} />
                    {connTest.message}
                  </span>
                )}
              </div>
              <span style={{ fontSize: "11.5px", color: "#5B6273", lineHeight: 1.55 }}>Root repo, project and skill are set per ticket on the Overview tab. The current sprint is loaded automatically from the selected provider.</span>
              <div style={{ height: "1px", background: "#1E232C" }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
                <div>
                  <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#ECEEF3" }}>Animated background</div>
                  <div style={{ fontSize: "12px", color: "#6B7283", marginTop: "2px" }}>Turn off to freeze the 3D reactor backdrop.</div>
                </div>
                <button
                  onClick={() => setSettings((s) => ({ ...s, animatedBackground: !s.animatedBackground }))}
                  aria-pressed={settings.animatedBackground}
                  title="Toggle animated background"
                  style={{
                    position: "relative", flex: "0 0 auto", width: "42px", height: "24px", borderRadius: "999px",
                    border: "none", cursor: "pointer",
                    background: settings.animatedBackground ? "var(--accent)" : "#2A2F3A",
                    transition: "background .18s",
                  }}
                >
                  <span
                    style={{
                      position: "absolute", top: "3px", left: settings.animatedBackground ? "21px" : "3px",
                      width: "18px", height: "18px", borderRadius: "50%", background: "#0B0C10",
                      transition: "left .18s",
                    }}
                  />
                </button>
              </div>
              {settingsError && (
                <div style={{ display: "flex", gap: "9px", alignItems: "flex-start", ...tintedCard("danger", { padding: "11px 13px", radius: "10px" }) }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" strokeWidth="2" style={{ flex: "0 0 auto", marginTop: "1px" }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
                  <span style={{ fontSize: "12.5px", color: "#FF8F8F", lineHeight: 1.5 }}>{settingsError}</span>
                </div>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", padding: "18px 22px", borderTop: "1px solid #1E232C", background: "#101318" }}>
              <button onClick={closeSettings} style={{ height: "32px", padding: "0 16px", border: "1.5px solid #2A2F3A", background: "transparent", color: "#C7CCD8", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", clipPath: "polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)", transition: "border-color .15s,color .15s,transform .12s" }}>Cancel</button>
              <button onClick={saveSettings} style={{ height: "32px", padding: "0 18px", color: "#0B0C10", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", ...ringBorder({ fill: "var(--accent)", variant: "filled", duration: 3, cornerPx: 7 }) }}>Save changes</button>
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
