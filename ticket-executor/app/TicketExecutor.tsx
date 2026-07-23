"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import Reactor from "./Reactor";
import { useBoltsContext } from "./BoltsContext";
import { type IterationOption } from "./SprintPicker";
import AppHeader from "./ticket-executor/AppHeader";
import CommitFilesModal from "./ticket-executor/CommitFilesModal";
import DiffModal from "./ticket-executor/DiffModal";
import LoadingRing from "./ticket-executor/LoadingRing";
import SettingsModal from "./ticket-executor/SettingsModal";
import TicketDetailHeader from "./ticket-executor/TicketDetailHeader";
import TicketSidebar from "./ticket-executor/TicketSidebar";
import Toast from "./ticket-executor/Toast";
import CommitsTab from "./ticket-executor/tabs/CommitsTab";
import ExecutionTab from "./ticket-executor/tabs/ExecutionTab";
import OverviewTab from "./ticket-executor/tabs/OverviewTab";
import PlanTab from "./ticket-executor/tabs/PlanTab";
import ResolveReviewTab from "./ticket-executor/tabs/ResolveReviewTab";
import ResultTab from "./ticket-executor/tabs/ResultTab";
import {
  ACCENT, COMMON_ROOT_REPOS, DEFAULT_SKILL, RESULT_SKILL_ORDER, RESULT_SKILL_TITLE, SKILL_OPTIONS,
} from "./ticket-executor/constants";
import { deriveStep, reviewFingerprint } from "./ticket-executor/helpers";
import type {
  Action, ConnTest, ExecView, OverrideField, ResultSection, RunSummary, SettingsView, StepView, TabId,
} from "./ticket-executor/types";
import type { CommitFile, CommitSummary, ExecStatus, FileChange, LogLine, Ticket, TicketComment, ReviewData, ReviewSummaryEntry } from "@/lib/types";
import { PROVIDERS, providerMeta, DEFAULT_PROVIDER, type ProviderId } from "@/lib/providers";
import { DEFAULT_CLAUDE_MODEL, DEFAULT_CLAUDE_EFFORT } from "@/lib/claudeOptions";
import {
  EXEC_COLOR,
  STEPS,
  actionInfoFor,
  branchOf,
  clipCorner,
  ctaButtonStyle,
  isFixReviewSkill,
  nextStatusAfter,
  pill,
  ringBorder,
} from "@/lib/ui";

// Container for the whole app: owns all state (tickets, executions, settings,
// reviews) and the polling/SSE plumbing, and composes the presentational pieces
// in ./ticket-executor/*.
export default function TicketExecutor() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadError, setLoadError] = useState<string>("");
  const [ticketsNotice, setTicketsNotice] = useState<string>("");
  const [sprintLabel, setSprintLabel] = useState<string>("");
  const [sprintOptions, setSprintOptions] = useState<IterationOption[]>([]);
  const [selectedSprint, setSelectedSprint] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");
  const [tab, setTab] = useState<TabId>("overview");
  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fType, setFType] = useState("");
  const [fAssignee, setFAssignee] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [statusMenuOptions, setStatusMenuOptions] = useState<string[]>([]);
  const [statusMenuLoading, setStatusMenuLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: "success" | "error" } | null>(null);
  const [execs, setExecs] = useState<Record<string, ExecView>>({});
  const [history, setHistory] = useState<Record<string, RunSummary[]>>({});
  const [diffFile, setDiffFile] = useState<FileChange | null>(null);
  const [comments, setComments] = useState<Record<string, TicketComment[]>>({});
  const [skillOptions, setSkillOptions] = useState<string[]>(SKILL_OPTIONS);
  const [settingsError, setSettingsError] = useState("");
  const [connTest, setConnTest] = useState<ConnTest>({ status: "idle", message: "" });
  const [overrides, setOverrides] = useState<Record<string, Partial<Record<OverrideField, string>>>>({});
  const [savedOptions, setSavedOptions] = useState<Record<"rootRepo" | "project" | "skill", string[]>>({ rootRepo: [], project: [], skill: [] });
  const [settings, setSettings] = useState<SettingsView>({
    provider: "azure-devops",
    org: "",
    pat: "",
    hasPat: false,
    animatedBackground: true,
    autoImplement: true,
    autoResolveCodeReview: true,
    scope: "team",
    personalAccount: "",
    concurrentRuns: 2,
    multiTicketMode: true,
  });
  const [reviews, setReviews] = useState<Record<string, ReviewData>>({});
  const [commits, setCommits] = useState<Record<string, CommitSummary[]>>({});
  const [openCommit, setOpenCommit] = useState<CommitSummary | null>(null);
  const [commitFiles, setCommitFiles] = useState<CommitFile[] | null>(null);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummaryEntry[]>([]);
  const [reviewReadMap, setReviewReadMap] = useState<Record<string, { seen: string; readAt: string }>>({});
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  // Mirror of selectedId for use inside stable callbacks (SSE handlers) without
  // re-memoizing them on every selection change.
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  // Per-ticket "resolving the plan" flag — disables the Plan tab's buttons while
  // the approve/revise/cancel POST is in flight.
  const [planBusy, setPlanBusy] = useState<Record<string, boolean>>({});

  const { fireBoltFromEvent } = useBoltsContext();
  const logRef = useRef<HTMLDivElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const sseConnections = useRef<Record<string, EventSource>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Batch "Run selected" scheduler: tickets waiting for a free slot, and
  // tickets currently occupying one — capped by settings.concurrentRuns.
  const batchQueueRef = useRef<string[]>([]);
  const batchRunningRef = useRef<Set<string>>(new Set());
  const tryStartNextQueuedRef = useRef<() => void>(() => { });

  // ---- data load ----
  // Fetch the ticket list for a given provider (and optional sprint override) and refresh the header sprint.
  const reloadTickets = useCallback(async (provider: ProviderId, sprint?: string, opts?: { notify?: boolean }) => {
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
      if (opts?.notify) {
        if (data.error) showToast(data.error, 3200, "error");
        else if (data.notice) showToast(data.notice, 3200, "error");
        else showToast(`Loaded ${list.length} ticket${list.length === 1 ? "" : "s"}`, 2600);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      setTickets([]);
      if (opts?.notify) showToast(msg, 3200, "error");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showToast is declared later but stable (empty-dep useCallback)
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
    (async () => {
      try {
        const r = await fetch("/api/options");
        const data = await r.json();
        setSavedOptions({
          rootRepo: Array.isArray(data.rootRepo) ? data.rootRepo : [],
          project: Array.isArray(data.project) ? data.project : [],
          skill: Array.isArray(data.skill) ? data.skill : [],
        });
      } catch {
        /* no saved options yet */
      }
    })();
    return () => {
      Object.values(pollTimers.current).forEach(clearInterval);
      Object.values(sseConnections.current).forEach((es) => es.close());
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

  // Fetch the linked PR's commit list — refetched every time the Commits tab
  // is (re)opened, same freshness policy as Resolve Review.
  const loadCommits = useCallback(async (ticketId: string, provider: ProviderId) => {
    if (!ticketId) return;
    try {
      const r = await fetch(`/api/tickets/${ticketId}/commits?provider=${provider}`);
      const data = await r.json();
      setCommits((s) => ({ ...s, [ticketId]: Array.isArray(data.commits) ? data.commits : [] }));
    } catch {
      setCommits((s) => ({ ...s, [ticketId]: [] }));
    }
  }, []);

  useEffect(() => {
    if (selectedId && tab === "commits") loadCommits(selectedId, settings.provider);
  }, [selectedId, tab, settings.provider, loadCommits]);

  // Open the commit-files popup for one commit, lazily fetching its per-file diffs.
  const openCommitFiles = useCallback(async (ticketId: string, provider: ProviderId, commit: CommitSummary) => {
    setOpenCommit(commit);
    setCommitFiles(null);
    try {
      const r = await fetch(`/api/tickets/${ticketId}/commits/${commit.sha}?provider=${provider}`);
      const data = await r.json();
      setCommitFiles(Array.isArray(data.files) ? data.files : []);
    } catch {
      setCommitFiles([]);
    }
  }, []);

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
      const next = { ...prev, [rv.ticketId]: { seen: reviewFingerprint(rv), readAt: new Date().toISOString() } };
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
          error: ex.errorMessage ?? "",
          prUrl: ex.prUrl ?? "",
          branch: ex.branch ?? "",
          duration: ex.duration,
          currentStep: ex.currentStep,
          phase: ex.phase,
          planStatus: ex.planStatus,
          planMarkdown: ex.planMarkdown,
        },
      }));
      setTab(ex.status === "completed" ? "result" : ex.status === "awaiting-approval" ? "plan" : "execution");
    } catch {
      /* ignore */
    }
  }, [fireBoltFromEvent]);

  // autoscroll terminal
  useEffect(() => {
    if (tab === "execution" && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  });

  // Multi-select only makes sense in multi-ticket mode — drop out of it if the
  // setting is turned off while a selection is in progress.
  useEffect(() => {
    if (!settings.multiTicketMode && selectMode) {
      setSelectMode(false);
      setSelectedIds(new Set());
    }
  }, [settings.multiTicketMode, selectMode]);

  // Close the status dropdown on outside click.
  useEffect(() => {
    if (!statusMenuOpen) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) setStatusMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [statusMenuOpen]);

  const showToast = useCallback((msg: string, ms = 4000, kind: "success" | "error" = "success") => {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  // Ask for notification permission (best-effort) and fire a desktop notification
  // when a run finishes while the tab is not focused.
  const requestNotify = useCallback(() => {
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default")
        Notification.requestPermission().catch(() => { });
    } catch { }
  }, []);
  const notify = useCallback((title: string, body: string) => {
    try {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      if (typeof document !== "undefined" && !document.hidden) return; // tab visible → toast is enough
      new Notification(title, { body });
    } catch { }
  }, []);

  // ---- per-ticket resolved config ----
  // Effective status: a locally-applied override (confirmed by the provider write below) wins over the fetched state.
  const getStatus = (t: Ticket) => statusOverrides[t.id] || t.status;

  // Real per-ticket status options, fetched from the ticket's provider (see
  // lib/tickets.ts#getStatusOptions) — replaces the old hard-coded STATUS_ALL list.
  // Cached in localStorage per ticket+provider so subsequent opens of the dropdown
  // render instantly from cache instead of re-hitting the provider API; a background
  // refetch still runs to keep the cache from going stale.
  const statusOptionsCacheKey = (ticket: Ticket) => `te.statusOptions.${settings.provider}.${ticket.id}`;

  const loadStatusMenuOptions = async (ticket: Ticket) => {
    const cacheKey = statusOptionsCacheKey(ticket);
    let hadCache = false;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setStatusMenuOptions(parsed);
          hadCache = true;
        }
      }
    } catch { }
    if (!hadCache) setStatusMenuLoading(true);
    try {
      const r = await fetch(`/api/tickets/${ticket.id}/status?provider=${settings.provider}&type=${encodeURIComponent(ticket.type)}`);
      const data = await r.json();
      const options = Array.isArray(data.options) ? data.options : [];
      setStatusMenuOptions(options);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(options));
      } catch { }
    } catch {
      if (!hadCache) setStatusMenuOptions([]);
    } finally {
      setStatusMenuLoading(false);
    }
  };

  const selectStatus = async (ticketId: string, status: string, e?: MouseEvent) => {
    fireBoltFromEvent(e);
    setStatusMenuOpen(false);
    const prev = statusOverrides[ticketId];
    setStatusOverrides((s) => ({ ...s, [ticketId]: status })); // optimistic
    try {
      const r = await fetch(`/api/tickets/${ticketId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: settings.provider, status }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to update status");
      showToast(`Status set to "${status}" — synced to ${providerMeta(settings.provider).name}`, 3200);
    } catch (err) {
      setStatusOverrides((s) => {
        const next = { ...s };
        if (prev === undefined) delete next[ticketId];
        else next[ticketId] = prev;
        return next;
      });
      showToast(err instanceof Error ? err.message : "Failed to sync status to the provider", 4200, "error");
    }
  };
  // Note: use `??` (not `||`) against the override so that clearing a field to ""
  // stays empty instead of instantly snapping back to the fallback default.
  const getArea = (t: Ticket) => overrides[t.id]?.area ?? t.project;
  // The Implement action maps to implement-ticket-v3 (plan-review flow) by default;
  // the "Auto-implementation" setting flips it back to the original one-shot v2 flow.
  // An explicit per-ticket skill override always wins over both.
  const getSkill = (t: Ticket) => {
    if (overrides[t.id]?.skill) return overrides[t.id]!.skill!;
    const resolved = actionInfoFor(getStatus(t))?.skill || DEFAULT_SKILL;
    if (resolved === "implement-ticket-v3" && settings.autoImplement) return "implement-ticket-v2";
    return resolved;
  };
  // Same on/off split as getSkill, for the Resolve Review flow: the
  // "Auto resolve code review" setting picks the one-shot v2 vs the
  // plan-review-gated v3.
  const getReviewSkill = () => (settings.autoResolveCodeReview ? "fix-code-review-v2" : "fix-code-review-v3");
  const getRootRepo = (t: Ticket) => overrides[t.id]?.rootRepo ?? "C:\\repos";
  const getModel = (t: Ticket) => overrides[t.id]?.model ?? DEFAULT_CLAUDE_MODEL;
  const getEffort = (t: Ticket) => overrides[t.id]?.effort ?? DEFAULT_CLAUDE_EFFORT;
  const setOverrideValue = (ticketId: string, field: OverrideField, value: string) =>
    setOverrides((s) => ({ ...s, [ticketId]: { ...(s[ticketId] || {}), [field]: value } }));

  // Remember a Root Repo / Project / Skill value in the DB so it shows up as a
  // saved option next time (any ticket, any session) instead of only being a
  // per-session suggestion.
  const savedOptionKeys = useRef<Set<string>>(new Set());
  const rememberOption = useCallback((kind: "rootRepo" | "project" | "skill", value: string) => {
    if (!value) return;
    const key = `${kind}:${value}`;
    if (savedOptionKeys.current.has(key)) return;
    savedOptionKeys.current.add(key);
    setSavedOptions((s) => (s[kind].includes(value) ? s : { ...s, [kind]: [...s[kind], value] }));
    fetch("/api/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, value }),
    }).catch(() => {
      savedOptionKeys.current.delete(key); // allow a retry on the next run
    });
  }, []);

  // When Project changes, auto-select the Root Repo it was last run with (if any) —
  // unless the user already picked one explicitly for this ticket in this session.
  const onProjectChange = useCallback(
    (ticketId: string, value: string) => {
      setOverrideValue(ticketId, "area", value);
      if (overrides[ticketId]?.rootRepo || !value) return;
      fetch(`/api/options/mapping?project=${encodeURIComponent(value)}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.rootRepo) setOverrideValue(ticketId, "rootRepo", data.rootRepo);
        })
        .catch(() => { });
    },
    [overrides]
  );

  // Prefill a newly-selected ticket's Root Repo from its project's saved mapping
  // (DB-backed) as soon as it's viewed, so Overview shows the last-used repo
  // instead of falling back to the Settings default before the user edits anything.
  const mappingFetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!selectedId) return;
    if (overrides[selectedId]?.rootRepo) return;
    if (mappingFetchedRef.current.has(selectedId)) return;
    const t = tickets.find((x) => x.id === selectedId);
    const project = t?.project;
    if (!project) return;
    mappingFetchedRef.current.add(selectedId);
    fetch(`/api/options/mapping?project=${encodeURIComponent(project)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.rootRepo) setOverrideValue(selectedId, "rootRepo", data.rootRepo);
      })
      .catch(() => { });
  }, [selectedId, tickets, overrides]);

  // Combobox option lists (values are suggestions; free text is still allowed).
  const overrideVals = Object.values(overrides);
  const projectOptions = Array.from(
    new Set([
      ...tickets.map((x) => x.project),
      ...overrideVals.map((o) => o?.area),
      ...savedOptions.project,
    ].filter(Boolean) as string[])
  );
  const rootRepoOptions = Array.from(
    new Set([
      ...COMMON_ROOT_REPOS,
      ...overrideVals.map((o) => o?.rootRepo),
      ...savedOptions.rootRepo,
    ].filter(Boolean) as string[])
  );
  const mergedSkillOptions = Array.from(new Set([...skillOptions, ...savedOptions.skill]));

  // ---- live execution updates: SSE (falls back to 1.2s polling) ----
  const stopTracking = useCallback((executionId: string) => {
    if (pollTimers.current[executionId]) {
      clearInterval(pollTimers.current[executionId]);
      delete pollTimers.current[executionId];
    }
    if (sseConnections.current[executionId]) {
      sseConnections.current[executionId].close();
      delete sseConnections.current[executionId];
    }
  }, []);

  // Applies one execution snapshot (from either the SSE stream or a polled
  // fetch) to state, and — on first reaching a terminal status — runs the
  // completion side effects (toast/notify, provider status sync, history
  // reload, batch-queue slot release). Returns true once terminal.
  const applyExecutionUpdate = useCallback(
    async (ticketId: string, executionId: string, ex: Record<string, unknown> | undefined) => {
      if (!ex) return false;
      const status = ex.status as ExecStatus;
      setExecs((s) => ({
        ...s,
        [ticketId]: {
          executionId,
          status,
          skillName: (ex.skillName as string) ?? s[ticketId]?.skillName,
          logLines: (ex.logLines as LogLine[]) ?? [],
          resultText: (ex.resultText as string) ?? "",
          error: (ex.errorMessage as string) ?? "",
          prUrl: (ex.prUrl as string) ?? "",
          branch: (ex.branch as string) ?? "",
          duration: ex.duration as string | undefined,
          currentStep: ex.currentStep as number,
          phase: ex.phase as ExecView["phase"],
          planStatus: ex.planStatus as ExecView["planStatus"],
          planMarkdown: (ex.planMarkdown as string) ?? s[ticketId]?.planMarkdown,
        },
      }));

      // Plan gate: the run parked itself with no live process. Stop the stream,
      // free any batch slot, surface the plan for review — but run none of the
      // completion side effects (status sync, PR toast, history reload).
      if (status === "awaiting-approval") {
        stopTracking(executionId);
        try { window.__reactor?.setMode("idle"); } catch { }
        if (ticketId === selectedIdRef.current) setTab("plan");
        showToast(`#${ticketId} — plan ready for review`);
        notify("Ticket Executor", `#${ticketId} plan is ready for your review`);
        if (batchRunningRef.current.delete(ticketId)) tryStartNextQueuedRef.current();
        return true;
      }

      if (status !== "completed" && status !== "failed") return false;

      stopTracking(executionId);
      try {
        window.__reactor?.setMode(status === "completed" ? "completed" : "idle");
      } catch { }
      if (status === "completed") {
        // Advance the ticket status based on the skill that ran, and sync it to the
        // real provider (ADO work item state / GitHub status label) — not just locally.
        const next = nextStatusAfter((ex.skillName as string) ?? "", "");
        if (next) {
          try {
            const sr = await fetch(`/api/tickets/${ticketId}/status`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ provider: settings.provider, status: next }),
            });
            const data = await sr.json().catch(() => ({}));
            if (!sr.ok) throw new Error(data.error || "sync failed");
            const applied = (data.status as string) || next;
            setStatusOverrides((so) => ({ ...so, [ticketId]: applied }));
            showToast(`#${ticketId} completed — status set to "${applied}"`);
            notify("Ticket Executor", `#${ticketId} completed — status set to "${applied}"`);
          } catch (err) {
            const message = err instanceof Error ? err.message : "";
            showToast(`#${ticketId} status sync to the provider failed${message ? ` — ${message}` : ""}`, 4200, "error");
          }
        } else {
          showToast(`#${ticketId} completed — result ready`);
          notify("Ticket Executor", `#${ticketId} completed — result ready`);
        }
      } else {
        showToast(`#${ticketId} failed`, 4000, "error");
        notify("Ticket Executor", `#${ticketId} failed`);
      }
      // A fix-code-review run (v2 or v3) resolves PR threads itself — refetch
      // the Resolve Review data so the tab reflects the new state.
      if (isFixReviewSkill(ex.skillName as string)) {
        setReviews((s) => {
          const { [ticketId]: _drop, ...rest } = s;
          return rest;
        });
      }
      loadHistory(ticketId);
      // Free this ticket's batch-queue slot (no-op if it wasn't batch-started)
      // and let the next queued ticket, if any, take its place.
      if (batchRunningRef.current.delete(ticketId)) tryStartNextQueuedRef.current();
      return true;
    },
    [showToast, loadHistory, notify, settings.provider, stopTracking]
  );

  const startPollingFallback = useCallback(
    (ticketId: string, executionId: string) => {
      if (pollTimers.current[executionId]) return;
      const poll = async () => {
        try {
          const r = await fetch(`/api/executions/${executionId}`);
          const data = await r.json();
          await applyExecutionUpdate(ticketId, executionId, data.execution);
        } catch {
          /* keep polling */
        }
      };
      pollTimers.current[executionId] = setInterval(poll, 1200);
      poll();
    },
    [applyExecutionUpdate]
  );

  const startPolling = useCallback(
    (ticketId: string, executionId: string) => {
      if (pollTimers.current[executionId] || sseConnections.current[executionId]) return;
      if (typeof EventSource === "undefined") {
        startPollingFallback(ticketId, executionId);
        return;
      }
      const es = new EventSource(`/api/executions/${executionId}/stream`);
      sseConnections.current[executionId] = es;
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          void applyExecutionUpdate(ticketId, executionId, data.execution);
        } catch {
          /* ignore malformed frame */
        }
      };
      es.onerror = () => {
        // The stream endpoint closes the connection normally once the run
        // reaches a terminal status — only fall back to polling if we're
        // still tracking this execution (i.e. it errored before finishing).
        if (!sseConnections.current[executionId]) return;
        es.close();
        delete sseConnections.current[executionId];
        startPollingFallback(ticketId, executionId);
      };
    },
    [startPollingFallback]
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
            error: ex.errorMessage ?? "",
            prUrl: ex.prUrl ?? "",
            branch: ex.branch ?? "",
            duration: ex.duration,
            currentStep: ex.currentStep,
            phase: ex.phase,
            planStatus: ex.planStatus,
            planMarkdown: ex.planMarkdown,
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
    const running = list.find((r) => r.status === "running" || r.status === "awaiting-approval");
    const completedWithPr = list.find((r) => r.status === "completed" && r.prUrl);
    const target = running ?? completedWithPr ?? list[0];
    if (target) hydrateExecution(selectedId, target.id, target.skillName);
  }, [selectedId, history, execs, hydrateExecution]);

  // Core "start a run for this ticket" logic, usable both for the selected
  // ticket's CTA button and for batch runs kicked off from multi-select
  // (which may target tickets other than the one currently in view).
  // `isActive` gates the UI side-effects (tab switch, reactor mode, gate
  // toast) that only make sense for the ticket the user is actively looking at.
  // Resolves to whether the run actually started.
  const runTicket = useCallback(
    async (t: Ticket, opts?: { skillOverride?: string; prUrl?: string; isActive?: boolean }): Promise<boolean> => {
      const { skillOverride, prUrl, isActive = t.id === selectedId } = opts ?? {};
      const cur = execs[t.id];
      if (cur && (cur.status === "running" || cur.status === "awaiting-approval")) return false;
      // Single-ticket mode: refuse to start a second run while another ticket
      // occupies the one slot (mirrors the CTA's disabled state; guards the
      // batch-run path too, which bypasses that button).
      if (!settings.multiTicketMode) {
        const busyId = Object.entries(execs).find(
          ([id, e]) => id !== t.id && (e.status === "running" || e.status === "awaiting-approval")
        )?.[0];
        if (busyId) {
          if (isActive) showToast(`Ticket #${busyId} is currently running. Multi-ticket mode is off — finish or cancel it first.`);
          return false;
        }
      }
      // Guard: only statuses with a runnable action can start a run.
      const status0 = getStatus(t);
      if (!skillOverride && !actionInfoFor(status0)) {
        if (isActive) showToast(`Ticket status "${status0}" has no runnable action yet.`);
        return false;
      }
      requestNotify();
      const skillName = skillOverride || getSkill(t);
      // Reflect a quick-action skill choice in the per-ticket override.
      if (skillOverride) setOverrides((s) => ({ ...s, [t.id]: { ...(s[t.id] || {}), skill: skillOverride } }));
      const projectName = getArea(t);
      const rootRepo = getRootRepo(t);
      const model = getModel(t);
      const effort = getEffort(t);
      // Remember these values as saved options + the project→rootRepo mapping
      // so the next ticket opened with the same project defaults sensibly.
      rememberOption("rootRepo", rootRepo);
      rememberOption("project", projectName);
      rememberOption("skill", skillName);
      fetch("/api/options/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, rootRepo }),
      }).catch(() => { });
      if (isActive) setTab("execution");
      setExecs((s) => ({
        ...s,
        [t.id]: { status: "running", logLines: [], resultText: "", error: "" },
      }));
      if (isActive) {
        try {
          window.__reactor?.setMode("running");
        } catch { }
      }
      try {
        const r = await fetch(`/api/tickets/${t.id}/implement`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            skillName,
            projectName,
            rootRepo,
            model,
            effort,
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
          if (isActive) window.__reactor?.setMode("idle");
          return false;
        }
        setExecs((s) => ({ ...s, [t.id]: { ...s[t.id], executionId: data.executionId } }));
        startPolling(t.id, data.executionId);
        return true;
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
        return false;
      }
    },
    [selectedId, execs, overrides, settings, startPolling, rememberOption]
  );

  const startImplement = useCallback(
    (e?: MouseEvent, skillOverride?: string, prUrl?: string) => {
      fireBoltFromEvent(e, { big: true });
      const t = tickets.find((x) => x.id === selectedId);
      if (!t) return;
      void runTicket(t, { skillOverride, prUrl, isActive: true });
    },
    [tickets, selectedId, runTicket, fireBoltFromEvent]
  );

  // Pull queued batch tickets in as slots free up, capped by settings.concurrentRuns.
  // Exposed via a ref (tryStartNextQueuedRef) so the startPolling completion
  // handler — memoized separately — always calls the current version.
  const tryStartNextQueued = useCallback(() => {
    const cap = Math.max(1, settings.concurrentRuns || 2);
    while (batchRunningRef.current.size < cap && batchQueueRef.current.length > 0) {
      const nextId = batchQueueRef.current.shift()!;
      setQueuedIds((s) => {
        const n = new Set(s);
        n.delete(nextId);
        return n;
      });
      const nt = tickets.find((x) => x.id === nextId);
      if (!nt) continue;
      batchRunningRef.current.add(nextId);
      void runTicket(nt, { isActive: nextId === selectedId }).then((started) => {
        if (!started) {
          batchRunningRef.current.delete(nextId);
          tryStartNextQueuedRef.current();
        }
      });
    }
  }, [settings.concurrentRuns, tickets, selectedId, runTicket]);
  tryStartNextQueuedRef.current = tryStartNextQueued;

  // "Run selected" — start up to the concurrency cap immediately, queue the rest.
  const runSelected = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const cap = Math.max(1, settings.concurrentRuns || 2);
    const toStartNow = ids.slice(0, cap);
    const toQueue = ids.slice(cap);
    setSelectMode(false);
    setSelectedIds(new Set());
    setQueuedIds(new Set(toQueue));
    batchQueueRef.current = toQueue;
    toStartNow.forEach((id) => {
      const nt = tickets.find((x) => x.id === id);
      if (!nt) return;
      batchRunningRef.current.add(id);
      void runTicket(nt, { isActive: id === selectedId }).then((started) => {
        if (!started) {
          batchRunningRef.current.delete(id);
          tryStartNextQueuedRef.current();
        }
      });
    });
    showToast(`Started ${toStartNow.length} run${toStartNow.length === 1 ? "" : "s"}${toQueue.length ? `, ${toQueue.length} queued` : ""}`);
  }, [selectedIds, settings.concurrentRuns, tickets, selectedId, runTicket, showToast]);

  const cancelImplement = useCallback(
    async (e?: MouseEvent) => {
      const t = tickets.find((x) => x.id === selectedId);
      const execId = t ? execs[t.id]?.executionId : undefined;
      if (!execId) return;
      fireBoltFromEvent(e);
      try {
        await fetch(`/api/executions/${execId}/cancel`, { method: "POST" });
      } catch {
        /* ignore */
      }
    },
    [tickets, selectedId, execs, fireBoltFromEvent]
  );

  // Resolve a run parked at the plan gate. On approve/revise the run resumes,
  // so we flip it back to "running" locally and re-attach the live stream; on
  // cancel it becomes a failed run. `plan` is the (possibly edited) markdown.
  const resolvePlan = useCallback(
    async (ticketId: string, action: "approve" | "revise" | "cancel", plan?: string, feedback?: string) => {
      const execId = execs[ticketId]?.executionId;
      if (!execId) return;
      setPlanBusy((b) => ({ ...b, [ticketId]: true }));
      try {
        const r = await fetch(`/api/executions/${execId}/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, plan, feedback }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          showToast(data.error || "Failed to resolve the plan", 3600, "error");
          return;
        }
        if (action === "cancel") {
          setExecs((s) => ({ ...s, [ticketId]: { ...s[ticketId], status: "failed", error: "Plan rejected — run cancelled." } }));
          showToast(`#${ticketId} run cancelled`);
          loadHistory(ticketId);
          return;
        }
        // Approve or revise → the run is live again; resume tracking it.
        setExecs((s) => ({ ...s, [ticketId]: { ...s[ticketId], status: "running", planStatus: action === "approve" ? "approved" : "rejected" } }));
        if (ticketId === selectedIdRef.current) {
          setTab(action === "approve" ? "execution" : "plan");
          try { window.__reactor?.setMode("running"); } catch { }
        }
        startPolling(ticketId, execId);
      } finally {
        setPlanBusy((b) => ({ ...b, [ticketId]: false }));
      }
    },
    [execs, showToast, loadHistory, startPolling]
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
  // Switching provider prefills that provider's own saved URL/token (if any),
  // then immediately reloads the sprint/tickets for that provider.
  const onProviderChange = async (label: string) => {
    const provider = PROVIDERS.find((p) => p.name === label)?.id ?? DEFAULT_PROVIDER;
    setConnTest({ status: "idle", message: "" });
    try {
      const r = await fetch(`/api/settings?provider=${provider}`);
      const data = await r.json();
      setSettings((s) => ({
        ...s,
        provider,
        org: data.settings?.org ?? "",
        hasPat: !!data.settings?.hasPat,
        pat: "",
      }));
    } catch {
      setSettings((s) => ({ ...s, provider, org: "", hasPat: false, pat: "" }));
    }
    loadSprintOptions(provider);
    reloadTickets(provider, undefined, { notify: true });
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
      // Only reports whether the credentials work — the form isn't persisted yet,
      // so tickets stay as they are until Save.
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
    fireBoltFromEvent(e);
    setSettingsOpen(false);
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await r.json();
      if (!r.ok || !data.settings) {
        showToast(data.error || "Failed to save settings", 3200, "error");
        return;
      }
      setSettings(data.settings);
      showToast("Settings saved", 3200);
      const provider = (data.settings?.provider as ProviderId) ?? settings.provider;
      await loadSprintOptions(provider);
      await reloadTickets(provider, undefined, { notify: true });
    } catch {
      showToast("Failed to save settings", 3200, "error");
    }
  };

  // ---- derived ----
  const execStatusOf = (id: string): ExecStatus => execs[id]?.status ?? "not started";
  const activeCount = Object.values(execs).filter((e) => e.status === "running" || e.status === "awaiting-approval").length;
  const reviewBadgeCount = reviewSummary.filter((r) => reviewReadMap[r.ticketId]?.seen !== reviewFingerprint(r)).length;

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

  const t = tickets.find((x) => x.id === selectedId);
  const effStatus = t ? getStatus(t) : "";
  const actionInfo = t ? actionInfoFor(effStatus) : null;
  const ex = t ? execs[t.id] : undefined;
  const st: ExecStatus = ex ? ex.status : "not started";
  const execEnabled = st !== "not started";
  const resultEnabled = st === "completed";
  // The Plan tab exists only for a two-phase run that has produced (or is
  // producing) a plan — i.e. once a v3 run is underway.
  const planEnabled = !!ex?.planMarkdown || st === "awaiting-approval" || (ex?.phase === "plan" && st === "running");
  const planBusyForSel = t ? !!planBusy[t.id] : false;

  // Single-ticket mode: only one run at a time. Find any other ticket currently
  // occupying the one slot, so this ticket's CTA can be blocked while it does.
  const busyOtherTicketId = !settings.multiTicketMode
    ? Object.entries(execs).find(
        ([id, e]) => id !== selectedId && (e.status === "running" || e.status === "awaiting-approval")
      )?.[0]
    : undefined;

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
  let action: Action;
  if (st === "running")
    action = {
      label: "Running… (cancel)",
      spinner: true,
      playIcon: false,
      onClick: cancelImplement,
      style: ctaButtonStyle("warning"),
    };
  else if (st === "awaiting-approval")
    action = {
      label: "Review Plan", spinner: false, playIcon: false,
      onClick: (e) => { fireBoltFromEvent(e); setTab("plan"); },
      style: ctaButtonStyle("ghost"),
    };
  else if (st === "completed")
    action = {
      label: "Show Result", spinner: false, playIcon: false,
      onClick: (e) => { fireBoltFromEvent(e); setTab("result"); },
      style: ctaButtonStyle("success"),
    };
  else if (st === "failed" && isFixReviewSkill(ex?.skillName))
    action = {
      label: "Retry Fix Code Review",
      spinner: false,
      playIcon: true,
      onClick: (e) => startImplement(e, getReviewSkill(), t ? reviews[t.id]?.pr?.url : undefined),
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
  // Exception: retrying a failed fix-code-review run (v2 or v3) is always valid —
  // it isn't driven by ticket status, so it must bypass the status-based gate.
  const isFixReviewRetry = st === "failed" && isFixReviewSkill(ex?.skillName);
  const startsNewRun = st === "not started" || st === "failed";
  // In single-ticket mode, a run already occupying the one slot blocks every
  // other ticket's CTA, regardless of what action it would otherwise show.
  const blockedBySingleMode = !!t && !!busyOtherTicketId && (startsNewRun || isFixReviewRetry);
  const gated = !!t && ((startsNewRun && !actionInfo && !isFixReviewRetry) || blockedBySingleMode);
  if (gated) {
    const reason = blockedBySingleMode
      ? `Ticket #${busyOtherTicketId} is currently running. Multi-ticket mode is off — finish or cancel it first.`
      : `Ticket status "${effStatus}" has no runnable action yet.`;
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
  const ctaTitle = blockedBySingleMode ? "Another ticket is running" : gated ? "No action for this status" : st === "completed" ? "Implementation complete" : st === "failed" ? "Last run failed" : st === "running" ? "Claude Code is working…" : actionInfo?.label === "Review Code" ? "Ready for review" : "Ready to implement";
  const ctaSub = t
    ? blockedBySingleMode ? `Ticket #${busyOtherTicketId} is currently running. Multi-ticket mode is off — finish or cancel it first.`
      : gated ? `This ticket is "${effStatus}". Move it to "Ready for Dev", "In Progress", or "Code Review" to enable a run.`
      : st === "completed" ? "Open the Result tab to review what Claude changed."
        : st === "failed" ? "Fix the blocker below, then retry the run."
          : st === "running" ? "Watch the execution stream on the Execution tab."
            : `Claude Code will cd into the repo and run ${getSkill(t)} for ${getArea(t)}.`
    : "";

  // steps
  const cur = ex?.currentStep ?? (ex ? deriveStep(ex.logLines) : 0);
  const steps: StepView[] = STEPS.map((label, i) => {
    let sst: "pending" | "active" | "done" | "failed" = "pending";
    if (st === "completed") sst = "done";
    else if (st === "failed") sst = i < cur ? "done" : i === cur ? "failed" : "pending";
    else if (st === "running" || st === "awaiting-approval") sst = i < cur ? "done" : i === cur ? "active" : "pending";
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
    running: ["running", "#F5B341"], "awaiting-approval": ["plan review", "#9BA6E8"], completed: ["done", "#35D6A4"], failed: ["failed", "#FF6B6B"], "not started": ["idle", "#5B6273"],
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
  const selCdCommand = t ? `cd ${getRootRepo(t)} && claude --model ${getModel(t)} --effort ${getEffort(t)}` : "";
  const selExecPillStyle: CSSProperties = pill({ color: EXEC_COLOR[st], background: "rgba(255,255,255,.03)", border: EXEC_COLOR[st] + "44", size: "md", weight: 600 });

  // Split the result into per-skill sections (Implementation / Code Review),
  // one section per completed run this ticket has been through (not just the
  // latest of each skill) — sourced from history so it survives page reloads.
  const completedRuns = (t ? history[t.id] : undefined)?.filter((r) => r.status === "completed" && r.resultText) ?? [];
  const runsPerSkill = completedRuns.reduce<Record<string, number>>((acc, r) => {
    acc[r.skillName] = (acc[r.skillName] ?? 0) + 1;
    return acc;
  }, {});
  const resultSections: ResultSection[] = completedRuns
    .map((r) => ({
      key: r.id,
      skill: r.skillName,
      title: runsPerSkill[r.skillName] > 1
        ? `${RESULT_SKILL_TITLE[r.skillName] || r.skillName} — ${new Date(r.startedAt).toLocaleString()}`
        : RESULT_SKILL_TITLE[r.skillName] || r.skillName,
      markdown: r.resultText!,
      filesChanged: r.filesChanged ?? [],
    }))
    .sort((a, b) => RESULT_SKILL_ORDER.indexOf(a.skill) - RESULT_SKILL_ORDER.indexOf(b.skill));

  const EMPTY_REVIEW: ReviewData = { pr: null, comments: [], unresolvedCount: 0 };
  const ticketReview: ReviewData = t ? reviews[t.id] ?? EMPTY_REVIEW : EMPTY_REVIEW;
  const fixReviewRunning = (st === "running" || st === "awaiting-approval") && isFixReviewSkill(ex?.skillName);
  const fixReviewDisabled = ticketReview.unresolvedCount === 0 || (st === "running" && !fixReviewRunning);
  const showResultSectionHeader = resultSections.length > 1;
  const showResult = tab === "result" && resultSections.length > 0;

  // active provider metadata drives Settings field labels + placeholders
  const pm = providerMeta(settings.provider);

  return (
    <div
      style={{
        position: "relative", height: "100vh", width: "100%", display: "flex", flexDirection: "column",
        background: "transparent", color: "#ECEEF3", fontFamily: "var(--font-hanken), sans-serif",
        overflow: "hidden", ["--accent" as string]: ACCENT,
      }}
    >
      <Reactor accent={ACCENT} frozen={!settings.animatedBackground} />

      <AppHeader
        pm={pm}
        sprintLabel={sprintLabel}
        sprintOptions={sprintOptions}
        selectedSprint={selectedSprint}
        onSprintChange={onSprintChange}
        activeCount={activeCount}
        bellRef={bellRef}
        bellOpen={bellOpen}
        onToggleBell={(e) => { fireBoltFromEvent(e); setBellOpen((o) => !o); }}
        reviewBadgeCount={reviewBadgeCount}
        reviewSummary={reviewSummary}
        reviewReadMap={reviewReadMap}
        onOpenReview={(rv, e) => { markReviewRead(rv); selectTicket(rv.ticketId, e); setTab("resolve-review"); setBellOpen(false); }}
        onOpenSettings={openSettings}
        onLogout={async () => {
          await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
          window.location.href = "/login";
        }}
      />

      <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", minHeight: 0 }}>
        <TicketSidebar
          tickets={tickets}
          filtered={filtered}
          loading={loading}
          loadError={loadError}
          ticketsNotice={ticketsNotice}
          search={search}
          setSearch={setSearch}
          filtersOpen={filtersOpen}
          setFiltersOpen={setFiltersOpen}
          activeFilters={activeFilters}
          clearFilters={clearFilters}
          fStatus={fStatus}
          setFStatus={setFStatus}
          fType={fType}
          setFType={setFType}
          fAssignee={fAssignee}
          setFAssignee={setFAssignee}
          statusOptions={statusOptions}
          typeOptions={typeOptions}
          assigneeOptions={assigneeOptions}
          multiTicketMode={settings.multiTicketMode}
          selectMode={selectMode}
          onToggleSelectMode={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}
          onCancelSelect={() => { setSelectMode(false); setSelectedIds(new Set()); }}
          selectedIds={selectedIds}
          onToggleTicketSelected={(id) => setSelectedIds((s) => {
            const n = new Set(s);
            if (n.has(id)) n.delete(id); else n.add(id);
            return n;
          })}
          queuedIds={queuedIds}
          onRunSelected={runSelected}
          selectedId={selectedId}
          execStatusOf={execStatusOf}
          getStatus={getStatus}
          onSelectTicket={selectTicket}
        />

        {/* Main */}
        <main style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: "linear-gradient(110deg,rgba(6,7,10,.5) 0%,rgba(6,7,10,.22) 52%,rgba(6,7,10,0) 100%)" }}>
          {!t ? (
            <div style={{ margin: "auto" }}>{loading ? <LoadingRing size={140} /> : <span style={{ color: "#5B6273", fontSize: "14px" }}></span>}</div>
          ) : (
            <>
              <TicketDetailHeader
                ticket={t}
                effStatus={effStatus}
                projectName={selProject}
                status={st}
                execPillStyle={selExecPillStyle}
                onOpenTicketLink={(e) => fireBoltFromEvent(e)}
                statusMenuRef={statusMenuRef}
                statusMenuOpen={statusMenuOpen}
                statusMenuLoading={statusMenuLoading}
                statusMenuOptions={statusMenuOptions}
                onToggleStatusMenu={() => {
                  const next = !statusMenuOpen;
                  setStatusMenuOpen(next);
                  if (next) loadStatusMenuOptions(t);
                }}
                onSelectStatus={(s, e) => selectStatus(t.id, s, e)}
                tab={tab}
                setTab={setTab}
                tabStyle={tabStyle}
                execEnabled={execEnabled}
                planEnabled={planEnabled}
                planNeedsReview={st === "awaiting-approval"}
                resultEnabled={resultEnabled}
                unresolvedCount={ticketReview.unresolvedCount}
                action={action}
                gated={gated}
                secondaryAction={secondaryAction}
              />

              <div className="te-scroll te-scroll--smooth" style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", minHeight: 0, padding: "24px 28px 44px" }}>
                {tab === "overview" && (
                  <OverviewTab
                    ticket={t}
                    comments={comments[t.id] ?? []}
                    history={history[t.id] ?? []}
                    onOpenRun={openRun}
                    rootRepo={getRootRepo(t)}
                    project={getArea(t)}
                    skill={getSkill(t)}
                    model={getModel(t)}
                    effort={getEffort(t)}
                    setOverrideValue={setOverrideValue}
                    onProjectChange={onProjectChange}
                    rootRepoOptions={rootRepoOptions}
                    projectOptions={projectOptions}
                    skillOptions={mergedSkillOptions}
                    branch={selBranch}
                    cdCommand={selCdCommand}
                    command={selCommand}
                    ctaTitle={ctaTitle}
                    ctaSub={ctaSub}
                    action={action}
                    gated={gated}
                    bannerCtaStyle={bannerCtaStyle}
                    secondaryAction={secondaryAction}
                    secondaryCtaButtonStyle={secondaryCtaButtonStyle}
                  />
                )}

                {tab === "execution" && (
                  <ExecutionTab
                    steps={steps}
                    logLines={logLines}
                    logRef={logRef}
                    projectName={selProject}
                    status={st}
                    statusLabel={lsl}
                    logStatusStyle={logStatusStyle}
                    error={ex?.error}
                  />
                )}

                {tab === "plan" && ex && (
                  <PlanTab
                    plan={ex.planMarkdown ?? ""}
                    awaiting={st === "awaiting-approval"}
                    busy={planBusyForSel}
                    onApprove={(plan) => resolvePlan(t.id, "approve", plan)}
                    onRevise={(plan, feedback) => resolvePlan(t.id, "revise", plan, feedback)}
                    onCancel={() => resolvePlan(t.id, "cancel")}
                  />
                )}

                {tab === "resolve-review" && (
                  <ResolveReviewTab
                    review={ticketReview}
                    fixReviewRunning={fixReviewRunning}
                    fixReviewDisabled={fixReviewDisabled}
                    onFixReview={(e, prUrl) => startImplement(e, getReviewSkill(), prUrl)}
                  />
                )}

                {tab === "commits" && (
                  <CommitsTab
                    pr={ticketReview.pr}
                    commits={commits[t.id] ?? null}
                    onOpenCommit={(commit) => openCommitFiles(t.id, settings.provider, commit)}
                  />
                )}

                {showResult && ex && (
                  <ResultTab
                    exec={ex}
                    sections={resultSections}
                    showSectionHeader={showResultSectionHeader}
                    onOpenDiff={setDiffFile}
                    onOpenPr={(e) => fireBoltFromEvent(e)}
                  />
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          setSettings={setSettings}
          setField={setField}
          pm={pm}
          connTest={connTest}
          settingsError={settingsError}
          onProviderChange={onProviderChange}
          onTestConnection={testConnection}
          onSave={saveSettings}
          onClose={closeSettings}
        />
      )}

      {diffFile && <DiffModal file={diffFile} onClose={() => setDiffFile(null)} />}

      {openCommit && (
        <CommitFilesModal
          commit={openCommit}
          files={commitFiles}
          onClose={() => { setOpenCommit(null); setCommitFiles(null); }}
        />
      )}

      {toast && <Toast toast={toast} />}
    </div>
  );
}
