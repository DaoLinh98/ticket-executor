"use client";

import { Reveal } from "../../Collapse";
import { AnimatePresence } from "motion/react";
import { MenuPanel } from "../../MenuPanel";
import { useEffect, useState, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import LoadingRing from "../../ticket-executor/LoadingRing";
import SelectMenu from "../../SelectMenu";
import { useBoltsContext } from "../../BoltsContext";
import {
  COLORS,
  FONT,
  card,
  ctaButtonStyle,
  dropdownPanelStyle,
  fieldInput,
  fieldLabel,
  pill,
  sectionCaption,
  tintedCard,
  displayText,
} from "@/lib/ui";
import PageHeader from "../PageHeader";
import PageToolbar from "../PageToolbar";
import { SPRINT_KEY, fetchSprint, fetchTicketSearch, ticketSearchKey, useProjects } from "../../queries";
import { useLiveInvalidate } from "../../useLive";
import { useToast } from "../ToastProvider";
import { releaseDays, reorderQueue, type Lane, type QueueMove } from "@/lib/sprintPlan";
import { planCsv } from "@/lib/sprintCsv";
import { attentionOf, type AttentionActionKind, type AttentionEntry } from "@/lib/sprintAttention";
import type { Ticket } from "@/lib/types";
import ActionButton from "./ActionButton";
import { ActionLegend, IconAction } from "./actionIcons";
import AutomationPanel from "./AutomationPanel";
import ConfirmDialog from "./ConfirmDialog";
import AskPoDialog from "./AskPoDialog";
import RunOptionsDialog from "./RunOptionsDialog";
import ResolveReviewDialog from "./ResolveReviewDialog";
import NeedsYou, { type AttentionItem } from "./NeedsYou";
import PlanFilters from "./PlanFilters";
import PlanTable from "./PlanTable";
import QaFollowUps, { defaultPicks } from "./QaFollowUps";
import RebuildPreviewDialog from "./RebuildPreviewDialog";
import SchedulerLog from "./SchedulerLog";
import CapacityStrip from "./CapacityStrip";
import SpendStrip from "./SpendStrip";
import TickPreview from "./TickPreview";
import { sprintSpend } from "@/lib/sprintSpend";
import TicketTimeline from "./TicketTimeline";
import {
  LANE_COLOR,
  LANE_LABEL,
  VERDICT,
  dayLabel,
  matchesFilter,
  type PlanFilter,
  type PlanSort,
  type PlanResponse,
  type PlannedRow,
  type QaCase,
  type RebuildPreview,
  type StoredPlan,
  previewRow,
  PLAN_KEY,
  isPlanFilter,
  isPlanSort,
  sortRows,
  fetchPlan,
} from "./model";

// The developer's own view of one iteration: what they are carrying, whether it
// fits, what an agent thinks of it, and which day each finished ticket is handed
// to a reviewer.
//
// Every number here is computed server-side (`lib/sprintPlan.ts`) and every
// action calls the same code the scheduler does. This page never decides
// anything on its own — that is what keeps the plan on the screen and the plan
// the machine acts on the same plan.

type Confirm = { title: string; confirmLabel: string; busyKey: string; body: ReactNode; run: () => Promise<unknown> };

const PLAN_POLL_MS = 5000;
const PLAN_IDLE_POLL_MS = 30000;
const SPRINT_POLL_MS = 60000;
const SEARCH_STALE_MS = 30000;

const planRunning = (p?: PlanResponse) =>
  (p?.plan?.items ?? []).some((t) => t.implementState === "running") || (p?.cases ?? []).some((c) => c.status === "running" || c.status === "fixing");

export default function MySprintPage() {
  const router = useRouter();
  const { fireBoltFromEvent } = useBoltsContext();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [casePicks, setCasePicks] = useState<Record<string, number[]>>({});
  const [caseNotes, setCaseNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [legendOpen, setLegendOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeHit, setActiveHit] = useState(0);
  const [settledNeedle, setSettledNeedle] = useState("");
  const [preview, setPreview] = useState<RebuildPreview | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // The view (filter, sort, project) rides in the URL so it survives a reload and can be shared.
  const [view] = useState(() => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)));
  const [filter, setFilter] = useState<PlanFilter>(() => (isPlanFilter(view.get("filter")) ? (view.get("filter") as PlanFilter) : "all"));
  const [sort, setSort] = useState<PlanSort>(() => (isPlanSort(view.get("sort")) ? (view.get("sort") as PlanSort) : "queue"));
  const [projectFilter, setProjectFilter] = useState(() => view.get("project") ?? "");
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const [k, v, fallback] of [["filter", filter, "all"], ["sort", sort, "queue"], ["project", projectFilter, ""]] as const) {
      if (v && v !== fallback) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    }
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [filter, sort, projectFilter]);
  const [historyFor, setHistoryFor] = useState("");
  const [optionsFor, setOptionsFor] = useState("");
  const [bulkOptions, setBulkOptions] = useState(false);
  const [reviewDialogRow, setReviewDialogRow] = useState<PlannedRow | null>(null);

  const setError = (m: string) => { if (m) showToast(m, "error"); };
  const setMessage = (m: string) => { if (m) showToast(m); };

  const projectsQuery = useProjects();
  const planQuery = useQuery({
    queryKey: PLAN_KEY,
    queryFn: fetchPlan,
    refetchOnWindowFocus: true,
    refetchInterval: (q) => (planRunning(q.state.data) ? PLAN_POLL_MS : q.state.data?.plan?.status === "active" ? PLAN_IDLE_POLL_MS : false),
  });
  const sprintQuery = useQuery({
    queryKey: SPRINT_KEY,
    queryFn: fetchSprint,
    refetchOnWindowFocus: true,
    refetchInterval: () => (planQuery.data?.plan?.status === "active" ? SPRINT_POLL_MS : false),
  });

  const projects = (projectsQuery.data?.projects ?? []).map((p) => p.name);
  const data = sprintQuery.data ?? null;
  const stored = planQuery.data?.plan ?? null;
  const events = planQuery.data?.events ?? [];
  const cases = planQuery.data?.cases ?? [];
  const closedCases = planQuery.data?.closed ?? {};
  const costs = planQuery.data?.costs ?? {};
  const reviews = planQuery.data?.reviews ?? [];
  const clarifications = planQuery.data?.clarifications ?? [];
  const [askingFor, setAskingFor] = useState("");
  const initialLoading = sprintQuery.isPending || planQuery.isPending;
  const refreshing = !initialLoading && (sprintQuery.isFetching || planQuery.isFetching);
  const loadError = data?.error || (sprintQuery.error as Error | null)?.message || (planQuery.error as Error | null)?.message || "";

  const reloadSprint = () => queryClient.invalidateQueries({ queryKey: SPRINT_KEY, exact: true });
  const load = () => { void reloadSprint(); };
  const reloadPlan = () => queryClient.invalidateQueries({ queryKey: PLAN_KEY, exact: true });
  const setStored = (plan: StoredPlan | null) =>
    queryClient.setQueryData<PlanResponse>(PLAN_KEY, (old) => ({ events: [], cases: [], closed: {}, reviews: [], clarifications: [], ticketBudgetUsd: 0, costs: {}, ...old, plan }));

  useLiveInvalidate(stored?.id ? "/api/my-sprint/plan/stream?plan=" + encodeURIComponent(stored.id) : null, PLAN_KEY);

  const needle = query.trim().toLowerCase().replace(/^#/, "");
  const searchTerm = query.trim().replace(/^#/, "");
  useEffect(() => {
    const timer = setTimeout(() => setSettledNeedle(searchTerm), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);
  const searchQuery = useQuery({
    queryKey: ticketSearchKey(settledNeedle),
    queryFn: ({ signal }) => fetchTicketSearch(settledNeedle, signal),
    enabled: !!settledNeedle,
    placeholderData: keepPreviousData,
    staleTime: SEARCH_STALE_MS,
  });
  const found = searchTerm ? searchQuery.data ?? [] : [];
  const searching = !!searchTerm && (searchTerm !== settledNeedle || searchQuery.isFetching);

  const post = async (url: string, body: unknown, method = "POST") => {
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw Object.assign(new Error(d.error || d.outcome?.error || "The request failed."), {
        blocked: String(d.outcome?.blocked ?? ""),
      });
    }
    return d;
  };

  const sendToRootRepo = (e: unknown, ticketId: string) => {
    if ((e as { blocked?: string })?.blocked !== "no-root-repo") throw e;
    showToast(`#${ticketId}: ${(e as Error).message}`, "warning");
    router.push(`/ticket-execution?ticket=${encodeURIComponent(ticketId)}&tab=overview&at=${Date.now()}`);
  };

  type PlanEdit = (plan: StoredPlan) => StoredPlan;
  const track = (label: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(label);
      else next.delete(label);
      return next;
    });

  const actMutation = useMutation({
    mutationFn: ({ fn }: { label: string; fn: () => Promise<void>; optimistic?: PlanEdit }) => fn(),
    onMutate: async ({ label, optimistic }) => {
      track(label, true);
      if (!optimistic) return undefined;
      await queryClient.cancelQueries({ queryKey: PLAN_KEY, exact: true });
      const previous = queryClient.getQueryData<PlanResponse>(PLAN_KEY);
      if (previous?.plan) queryClient.setQueryData<PlanResponse>(PLAN_KEY, { ...previous, plan: optimistic(previous.plan) });
      return { previous };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(PLAN_KEY, ctx.previous);
        reloadPlan();
      }
      setError(e instanceof Error ? e.message : String(e));
    },
    onSettled: (_data, _err, vars) => track(vars.label, false),
  });

  // Resolves false when the action threw (its error is already toasted), so a batch can count what failed.
  const act = (label: string, fn: () => Promise<void>, optimistic?: PlanEdit) =>
    actMutation.mutateAsync({ label, fn, optimistic }).then(() => true, () => false);

  const editItem = (plannedId: string, patch: Partial<PlannedRow>): PlanEdit => (plan) => ({
    ...plan,
    items: plan.items.map((i) => (i.id === plannedId ? { ...i, ...patch } : i)),
  });

  const queued = (i: PlannedRow) =>
    i.implementState === "pending" && i.implementOrder > 0 && i.claim === "mine" && !i.runId && !i.prUrl && !i.releasedAt;

  const reorderEdit = (plannedId: string, move: QueueMove): PlanEdit => (plan) => {
    const next = reorderQueue(plan.items.filter(queued), plannedId, move);
    if (!next) return plan;
    return {
      ...plan,
      items: plan.items
        .map((i) => (next.has(i.id) ? { ...i, implementOrder: next.get(i.id)! } : i))
        .sort((a, b) => a.implementOrder - b.implementOrder),
    };
  };

  const changeAnchor = (anchor: string) =>
    act("anchor", async () => {
      await post("/api/settings", { sprintAnchorProject: anchor });
      await reloadSprint();
    });

  const planConfig = () => ({
    pointsPerDay: stored?.pointsPerDay ?? data?.config.pointsPerDay,
    hoursPerDay: stored?.hoursPerDay ?? data?.config.hoursPerDay,
    maxTicketsPerDay: stored?.maxTicketsPerDay ?? data?.config.maxTicketsPerDay ?? 0,
  });

  const applyRebuild = async () => {
    const d = await post("/api/my-sprint/plan", planConfig());
    setStored(d.plan);
    setMessage("Plan rebuilt.");
    if (d.warning) showToast(d.warning, "warning");
    await load();
  };

  const buildPlan = () =>
    act("plan", async () => {
      if (stored) {
        const d = await post("/api/my-sprint/plan", { ...planConfig(), dryRun: true });
        const p: RebuildPreview = d.preview;
        if (p.added.length || p.moved.length || p.redated.length || p.claimChanged.length || p.overflowPoints > 0) {
          setPreview(p);
          return;
        }
      }
      await applyRebuild();
    });

  const confirmRebuild = () =>
    act("plan", async () => {
      await applyRebuild();
      setPreview(null);
    });

  const patchPlan = (body: Record<string, unknown>, label: string) =>
    act(label, async () => {
      const d = await post("/api/my-sprint/plan", { id: stored?.id, ...body }, "PATCH");
      setStored(d.plan);
    });

  const setUnblocked = (plannedId: string, unblocked: boolean) =>
    act("unblock-" + plannedId, async () => {
      const d = await post("/api/my-sprint/plan", { item: plannedId, unblocked }, "PATCH");
      setStored(d.plan);
      setMessage(
        unblocked
          ? "Marked ready to run — the scheduler will pick it up despite the clarification flag."
          : "Back to waiting on clarification."
      );
    });

  const addToPlan = (t: Ticket) =>
    act("add-" + t.id, async () => {
      const d = await post(
        "/api/my-sprint/plan",
        { addToRelease: { ticketId: t.id, title: t.title, project: t.project, points: t.storyPoints, estimateHours: t.estimateHours, status: t.status } },
        "PUT"
      );
      if (d.plan) setStored(d.plan);
      setMessage(`#${t.id} added to the release plan.`);
    });

  const removeNow = (plannedId: string, ticketId: string) =>
    act("remove-" + plannedId, async () => {
      const d = await post("/api/my-sprint/plan", { removeFromRelease: plannedId }, "PUT");
      if (d.plan) setStored(d.plan);
      setMessage(`#${ticketId} is no longer tracked.`);
    }, (plan) => ({ ...plan, items: plan.items.filter((i) => i.id !== plannedId) }));

  const moveNow = (plannedId: string, move: QueueMove) =>
    act("move-" + plannedId, async () => {
      const d = await post("/api/my-sprint/plan", { moveInQueue: { id: plannedId, move } }, "PUT");
      if (d.plan) setStored(d.plan);
    }, reorderEdit(plannedId, move));

  const holdNow = (plannedId: string) =>
    act("hold-" + plannedId, async () => {
      const d = await post("/api/my-sprint/plan", { hold: plannedId }, "PUT");
      if (d.plan) setStored(d.plan);
      showToast("On hold — the scheduler leaves it alone until you resume it.", "success", 10000, { label: "Undo", onClick: () => void unholdNow(plannedId) });
    }, editItem(plannedId, { implementState: "skipped" }));

  // Undo of a hold: a held ticket requeues at the position it kept.
  const unholdNow = (plannedId: string) =>
    act("unhold-" + plannedId, async () => {
      const d = await post("/api/my-sprint/plan", { retry: plannedId }, "PUT");
      if (d.plan) setStored(d.plan);
      if (d.outcome && !d.outcome.ok) setError(d.outcome.error || "It could not be put back in the queue.");
      else setMessage("Back in the queue.");
    }, editItem(plannedId, { implementState: "pending" }));

  const setReleaseDayNow = (plannedId: string, day: string) =>
    act("redate-" + plannedId, async () => {
      const d = await post("/api/my-sprint/plan", { setReleaseDay: { id: plannedId, day } }, "PUT");
      if (d.plan) setStored(d.plan);
      setMessage(`Release day set to ${dayLabel(day)}.`);
    });

  const saveRunOptionsNow = (plannedId: string, model: string, effort: string) =>
    act("options-" + plannedId, async () => {
      const d = await post("/api/my-sprint/plan", { setRunOptions: { id: plannedId, model, effort } }, "PUT");
      if (d.plan) setStored(d.plan);
      setOptionsFor("");
      setMessage("Run settings saved.");
    }, editItem(plannedId, { model, effort }));

  const releaseNow = (plannedId: string) =>
    act("release-" + plannedId, async () => {
      const d = await post("/api/my-sprint/plan", { release: plannedId }, "PUT");
      if (d.plan) setStored(d.plan);
      setMessage(d.outcome?.detail || "");
      if (d.outcome && !d.outcome.ok) setError(d.outcome.error || "The release did not complete.");
      await load();
    });

  const retryNow = (plannedId: string) =>
    act("retry-" + plannedId, async () => {
      const d = await post("/api/my-sprint/plan", { retry: plannedId }, "PUT");
      if (d.plan) setStored(d.plan);
      if (d.outcome && !d.outcome.ok) setError(d.outcome.error || "This ticket could not be requeued.");
      else setMessage("Retry started — watch it on the workflow page.");
    });

  const analyzeQaNow = (plannedId: string, ticketId: string) =>
    act("analyze-" + plannedId, async () => {
      try {
        await post("/api/my-sprint/plan", { analyzeQa: plannedId }, "PUT");
        showToast("Analysing QC's feedback against the code — nothing is posted or changed until you decide.");
      } catch (e) {
        sendToRootRepo(e, ticketId);
      }
      await reloadPlan();
    });

  const approveFixNow = (c: QaCase) =>
    act("qafix-" + c.id, async () => {
      try {
        await post("/api/my-sprint/plan", { approveQaFix: { id: c.id, fix: casePicks[c.id] ?? defaultPicks(c), note: caseNotes[c.id] ?? "" } }, "PUT");
        showToast("QA fix started on the findings you picked — the reply waits until it has a pull request.");
      } catch (e) {
        sendToRootRepo(e, c.ticketId);
      }
      await reloadPlan();
    });

  const postReplyNow = (c: QaCase) =>
    act("post-" + c.id, async () => {
      await post("/api/my-sprint/plan", { postQaReply: c.id, body: draftEdits[c.id] ?? c.body }, "PUT");
      showToast(`Reply posted on #${c.ticketId}.`);
      await reloadPlan();
    });

  const dismissCaseNow = (c: QaCase) =>
    act("dismiss-" + c.id, async () => {
      await post("/api/my-sprint/plan", { dismissQaCase: c.id }, "PUT");
      await reloadPlan();
    });

  const askPoNow = (plannedId: string, body: string) =>
    act("askpo-" + plannedId, async () => {
      await post("/api/my-sprint/plan", { askPo: plannedId, body }, "PUT");
      setAskingFor("");
      showToast("Questions posted — the run rechecks readiness when the PO replies.");
      await reloadPlan();
    });

  const markReviewedNow = (plannedId: string) =>
    act("ack-" + plannedId, async () => {
      await post("/api/my-sprint/plan", { ackReview: plannedId }, "PUT");
      await reloadPlan();
    });

  const moveToQaNow = (plannedId: string) =>
    act("qa-" + plannedId, async () => {
      const d = await post("/api/my-sprint/plan", { moveToQa: plannedId }, "PUT");
      if (d.plan) setStored(d.plan);
      showToast(`Moved to "${d.outcome?.status || "In QA"}".`);
      await load();
    });

  const askResolveReview = (row: PlannedRow) => {
    setReviewDialogRow(row);
  };

  const resolveReviewNow = (row: PlannedRow, findings = "") =>
    act("fixreview-" + row.id, async () => {
      try {
        const d = await post("/api/my-sprint/plan", { resolveReview: row.id, findings }, "PUT");
        if (d.plan) setStored(d.plan);
        if (d.outcome && !d.outcome.ok) setError(d.outcome.error || "The review fix did not start.");
        else setMessage("Resolving the review comments on this pull request.");
        setReviewDialogRow(null);
      } catch (e) {
        sendToRootRepo(e, row.ticketId);
      }
    });

  const tickNow = () =>
    act("tick", async () => {
      const d = await post("/api/my-sprint/plan", { tick: true }, "PUT");
      const r = d.report ?? {};
      setMessage(
        `Scheduler ran: ${r.implementStarted ?? 0} started, ${r.released ?? 0} released, ${r.skipped ?? 0} skipped` +
          (r.reviewStarted ? `, ${r.reviewStarted} review fix(es) started` : "") +
          (r.aborted ? `, ${r.aborted} stopped (changed hands)` : "") +
          "."
      );
      await load();
    });

  // The runs spending money right now: implement, review fix and QA runs. A run parked on the PO spends nothing.
  const activeRunIds = () =>
    [...new Set([
      ...runningRows.map((t) => t.runId),
      ...reviewingRows.map((t) => t.reviewRunId),
      ...cases.filter((c) => c.status === "running").map((c) => c.runId),
      ...cases.filter((c) => c.status === "fixing").map((c) => c.fixRunId),
    ].filter(Boolean))];

  // Pause first, so the scheduler cannot start anything while the runs are being cancelled.
  const stopEverything = () =>
    act("stop-all", async () => {
      if (stored?.status === "active") {
        const d = await post("/api/my-sprint/plan", { id: stored.id, status: "draft" }, "PATCH");
        setStored(d.plan);
      }
      const ids = activeRunIds();
      // 409 = the run had already ended, which is what was asked for.
      const ok = await Promise.all(ids.map((id) => fetch(`/api/dagent/runs/${id}/cancel`, { method: "POST" }).then((r) => r.ok || r.status === 409, () => false)));
      await reloadPlan();
      const failed = ok.filter((x) => !x).length;
      if (failed) throw new Error(`Automation is paused, but ${failed} of ${ids.length} runs could not be cancelled — open them on the workflow page.`);
      setMessage(`Automation paused${ids.length ? ` and ${ids.length} run${ids.length === 1 ? "" : "s"} cancelled` : ""}.`);
    });

  const askStopEverything = () =>
    setConfirm({
      title: "Stop everything?",
      confirmLabel: "Stop all",
      busyKey: "stop-all",
      body: (
        <>
          <span>
            {[...runningRows, ...reviewingRows].map((t) => "#" + t.ticketId).filter((x, i, a) => a.indexOf(x) === i).join(", ") || "No ticket is running."}
          </span>
          <span>
            The plan is set to draft, so the scheduler starts nothing more, and every run above is cancelled now. Cost already spent is not
            refunded. Activate the plan again to resume; cancelled tickets can be retried.
          </span>
        </>
      ),
      run: stopEverything,
    });

  // A ticket's runs are watched on /workflow, which follows its live run.
  const openExecution = (ticketId: string) =>
    window.open(`/workflow?ticket=${encodeURIComponent(ticketId)}`, "_blank", "noopener");

  const askRelease = (row: PlannedRow) =>
    setConfirm({
      title: `Release #${row.ticketId}?`,
      confirmLabel: "Release",
      busyKey: "release-" + row.id,
      body: (
        <>
          <span>#{row.ticketId} · {row.title}</span>
          <span>
            This takes the pull request out of draft, assigns{" "}
            {stored?.reviewers?.length ? stored.reviewers.join(", ") : "nobody (no reviewers are set)"}, and moves the work item to Code Review.
          </span>
        </>
      ),
      run: () => releaseNow(row.id),
    });

  const askPostReply = (c: QaCase) =>
    setConfirm({
      title: `Post the reply on #${c.ticketId}?`,
      confirmLabel: "Post reply",
      busyKey: "post-" + c.id,
      body: <span>The reply is posted as a comment on the work item under your name.</span>,
      run: () => postReplyNow(c),
    });

  const askRemove = (plannedId: string, ticketId: string) =>
    setConfirm({
      title: `Stop tracking #${ticketId}?`,
      confirmLabel: "Remove",
      busyKey: "remove-" + plannedId,
      body: (
        <>
          <span>#{ticketId} · {stored?.items.find((i) => i.id === plannedId)?.title ?? ""}</span>
          <span>
            It leaves the plan: no runs, release, review or QA watch, and a rebuild will not bring it back. Its runs and
            pull requests stay as they are. Search for it and add it to track it again.
          </span>
        </>
      ),
      run: () => removeNow(plannedId, ticketId),
    });

  const runConfirm = async () => {
    if (!confirm) return;
    await confirm.run();
    setConfirm(null);
  };

  const summary = data?.plan?.summary ?? null;
  const verdict = summary ? VERDICT[summary.verdict] : null;
  const projectCount = new Set((data?.tickets ?? []).map((t) => t.project).filter(Boolean)).size;
  const rows: PlannedRow[] =
    stored?.items?.length
      ? stored.items.filter((i) => !i.untracked)
      : (data?.plan?.tickets ?? []).map(previewRow);

  // Removed from the plan by hand but still in the sprint — named so the header total matches the table.
  const untrackedCount = stored?.items?.filter((i) => i.untracked).length ?? 0;
  const planned = new Set(rows.map((t) => t.ticketId));
  const addable = needle && stored ? found.filter((t) => !planned.has(t.id)) : [];

  const runningRows = rows.filter((t) => t.implementState === "running" && !clarifications.some((c) => c.plannedTicketId === t.id));
  const reviewingRows = rows.filter((t) => t.reviewState === "running");

  const releaseDayOptions = data?.window?.startDate && data.today ? releaseDays(data.window, data.today) : [];

  // The rules live in `lib/sprintAttention.ts`; the page only turns each entry's actions into buttons.
  const attentionButton = (e: AttentionEntry, kind: AttentionActionKind) => {
    const row = rows.find((r) => r.id === e.plannedId);
    switch (kind) {
      case "result":
        return <IconAction key={kind} action="result" onClick={() => openExecution(e.ticketId)} />;
      case "fixReview":
        return row ? <IconAction key={kind} action="fixReview" onClick={() => askResolveReview(row)} busy={busy.has("fixreview-" + e.plannedId)} /> : null;
      case "release":
        return row ? <IconAction key={kind} action="release" onClick={() => askRelease(row)} busy={busy.has("release-" + e.plannedId)} /> : null;
      case "retry":
        return <IconAction key={kind} action="retry" onClick={() => retryNow(e.plannedId)} busy={busy.has("retry-" + e.plannedId)} />;
      case "moveToQa":
        return <IconAction key={kind} action="moveToQa" onClick={() => moveToQaNow(e.plannedId)} busy={busy.has("qa-" + e.plannedId)} />;
      case "markReviewed":
        return <IconAction key={kind} action="markReviewed" onClick={() => markReviewedNow(e.plannedId)} busy={busy.has("ack-" + e.plannedId)} />;
      case "readDraft":
        return <IconAction key={kind} action="readDraft" onClick={() => document.getElementById("qa-follow-ups")?.scrollIntoView({ behavior: "smooth" })} />;
    }
  };
  const attention: AttentionItem[] = attentionOf({
    rows,
    reviews,
    cases,
    costs,
    budgetUsd: planQuery.data?.ticketBudgetUsd ?? 0,
    today: data?.today ?? "",
    autoRelease: !!stored?.autoRelease,
    autoDraftQaReply: !!stored?.autoDraftQaReply,
  }).map((e): AttentionItem => {
    const buttons = e.actions.map((k) => attentionButton(e, k));
    return {
      key: e.key, ticketId: e.ticketId, title: e.title, tone: e.tone, text: e.text,
      action: buttons.length === 0 ? undefined : buttons.length === 1 ? buttons[0] : <span style={{ display: "inline-flex", gap: "6px" }}>{buttons}</span>,
    };
  });

  const attentionIds = new Set(attention.map((a) => a.ticketId));
  const filterCounts = Object.fromEntries(
    (["all", "attention", "queued", "running", "review", "done"] as PlanFilter[]).map((f) => [f, rows.filter((t) => matchesFilter(t, f, attentionIds)).length])
  ) as Record<PlanFilter, number>;
  const rowProjects = [...new Set(rows.map((t) => t.project).filter(Boolean))].sort();
  const shownRows = sortRows(rows.filter((t) => matchesFilter(t, filter, attentionIds) && (!projectFilter || t.project === projectFilter)), sort, costs);
  const reorderable = filter === "all" && sort === "queue" && !projectFilter;

  // Bulk actions reuse the per-row writes one after another, each only on the rows its row button would show on.
  // Only the rows on screen: a batch never reaches a row the current filter hides.
  const chosen = shownRows.filter((t) => t.id && selected.has(t.id));
  // A row that left the plan drops out of the selection, so it is not pre-selected if it comes back.
  const rowIds = rows.map((t) => t.id).join(",");
  useEffect(() => {
    const live = new Set(rowIds.split(","));
    setSelected((cur) => {
      const kept = [...cur].filter((id) => live.has(id));
      return kept.length === cur.size ? cur : new Set(kept);
    });
  }, [rowIds]);
  const bulkHold = chosen.filter(queued);
  const bulkRetry = chosen.filter((t) => t.claim === "mine" && !t.prUrl && t.implementOrder > 0 && (t.implementState === "failed" || t.implementState === "skipped"));
  // Run settings only matter to a ticket the scheduler has yet to run.
  const bulkSettings = chosen.filter((t) => t.claim === "mine" && !t.prUrl && ["pending", "failed", "skipped"].includes(t.implementState));
  const bulkRemove = chosen.filter((t) => t.implementState !== "running" && t.reviewState !== "running");
  const clearSelection = () => setSelected(new Set());
  const saveBulkOptions = async (model: string, effort: string) => {
    const list = bulkSettings;
    await bulk(list, (t) =>
      act("options-" + t.id, async () => {
        const d = await post("/api/my-sprint/plan", { setRunOptions: { id: t.id, model, effort } }, "PUT");
        if (d.plan) setStored(d.plan);
      }, editItem(t.id, { model, effort }))
    );
    setBulkOptions(false);
    setMessage(`Run settings saved on ${list.length} ticket${list.length === 1 ? "" : "s"}.`);
  };
  const bulk = async (list: PlannedRow[], fn: (t: PlannedRow) => Promise<unknown>) => {
    let failed = 0;
    for (const t of list) if ((await fn(t)) === false) failed++;
    clearSelection();
    if (failed) showToast(`${failed} of ${list.length} did not complete — the errors are above.`, "warning");
  };
  // Activating hands the plan to the unattended scheduler, so say what it will do before it does it.
  const askActivate = () => {
    if (!stored) return;
    const next = rows.filter(queued).sort((x, y) => x.implementOrder - y.implementOrder)[0];
    const dueToday = rows.filter((t) => !!t.prUrl && t.implementState === "implemented" && !t.releasedAt && !!data?.today && !!t.releaseDay && t.releaseDay <= data.today);
    const flag = (on: boolean) => (on ? "on" : "off");
    setConfirm({
      title: "Activate the plan?",
      confirmLabel: "Activate",
      busyKey: "activate",
      body: (
        <>
          <span>The scheduler starts acting on this plan on its next pass, with this page closed.</span>
          <span>
            Auto-implement {flag(stored.autoImplement)} · Auto-release {flag(stored.autoRelease)} · Auto-resolve review{" "}
            {flag(stored.autoResolveReview)} · Auto-analyse QC feedback {flag(stored.autoDraftQaReply)}
          </span>
          <span>
            {stored.autoImplement
              ? next
                ? `First to implement: #${next.ticketId} · ${next.title}. ${rows.filter(queued).length} tickets queued.`
                : "Nothing is queued to implement."
              : "Auto-implement is off — no run starts on its own."}
          </span>
          {dueToday.length > 0 && (
            <span>
              {stored.autoRelease ? "Released on the next pass" : "Due for release (auto-release is off)"}:{" "}
              {dueToday.map((t) => "#" + t.ticketId).join(", ")}
            </span>
          )}
        </>
      ),
      run: () => patchPlan({ status: "active" }, "activate"),
    });
  };

  // A leading BOM makes Excel read the file as UTF-8, so Vietnamese titles keep their accents.
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob(["\ufeff" + planCsv(shownRows, costs)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `plan-${(data?.sprint || "sprint").replace(/[^\w.-]+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Each retry starts a run that spends money, so a batch of them is confirmed like a single release is.
  const askBulkRetry = () =>
    setConfirm({
      title: `Retry ${bulkRetry.length} tickets?`,
      confirmLabel: "Retry",
      busyKey: "retry-" + (bulkRetry[0]?.id ?? ""),
      body: (
        <>
          <span>{bulkRetry.map((t) => "#" + t.ticketId).join(", ")}</span>
          <span>Each one starts a new run now, one after another, and every run is billed.</span>
        </>
      ),
      run: () => bulk(bulkRetry, (t) => retryNow(t.id)),
    });

  const askBulkRemove = () =>
    setConfirm({
      title: `Stop tracking ${bulkRemove.length} tickets?`,
      confirmLabel: "Remove",
      busyKey: "remove-" + (bulkRemove[0]?.id ?? ""),
      body: (
        <>
          <span>{bulkRemove.map((t) => "#" + t.ticketId).join(", ")}</span>
          <span>
            They leave the plan: no runs, release, review or QA watch, and a rebuild will not bring them back. Their runs
            and pull requests stay as they are.
          </span>
        </>
      ),
      run: () => bulk(bulkRemove, (t) => removeNow(t.id, t.ticketId)),
    });

  return (
    <div style={{ position: "relative", height: "var(--te-app-h)", overflow: "hidden", display: "flex", flexDirection: "column", color: COLORS.text, ["--accent" as string]: COLORS.accent }}>
      <PageHeader title="Flow Runner" kicker="D-AGENT · AUTOMATION" icon={<><path d="M8 2v4M16 2v4M3 10h18" /><path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>} />

      <PageToolbar>
        <span style={fieldLabel()}>SPRINT CALENDAR</span>
        <div style={{ minWidth: "clamp(150px, 44vw, 220px)" }}>
          <SelectMenu
            value={data?.anchorProject ?? ""}
            onChange={changeAnchor}
            options={projects}
            ariaLabel="Project whose current iteration sets the sprint window"
          />
        </div>
        {busy.has("anchor") && <LoadingRing size={14} />}
        <div style={{ position: "relative", flex: "1 1 200px", maxWidth: "340px", minWidth: "150px" }}>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); setActiveHit(0); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setSearchOpen(false); return; }
              if (!addable.length) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setSearchOpen(true);
                setActiveHit((i) => (i + (e.key === "ArrowDown" ? 1 : addable.length - 1)) % addable.length);
              } else if (e.key === "Enter" && searchOpen) {
                const t = addable[Math.min(activeHit, addable.length - 1)];
                if (t && !busy.has("add-" + t.id)) { e.preventDefault(); fireBoltFromEvent(); addToPlan(t); }
              }
            }}
            placeholder="Search ticket by ID or title"
            aria-label="Search tickets by ID or title"
            role="combobox"
            aria-expanded={searchOpen && addable.length > 0}
            aria-controls="sprint-search-hits"
            aria-activedescendant={searchOpen && addable.length > 0 ? "sprint-hit-" + Math.min(activeHit, addable.length - 1) : undefined}
            autoComplete="off"
            spellCheck={false}
            style={{ ...fieldInput(), width: "100%", boxSizing: "border-box" }}
          />
          <AnimatePresence>
          {searchOpen && needle && stored && addable.length === 0 && (
            <MenuPanel style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 40, ...dropdownPanelStyle({ maxHeight: "320px" }) }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "40px", padding: "0 10px", fontSize: FONT.sm, color: COLORS.textMuted }}>
                {searching ? <><LoadingRing size={14} /> Searching all projects…</> : "No other ticket matches."}
              </div>
            </MenuPanel>
          )}
          </AnimatePresence>
          <AnimatePresence>
          {searchOpen && addable.length > 0 && (
            <MenuPanel id="sprint-search-hits" role="listbox" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 40, ...dropdownPanelStyle({ maxHeight: "320px" }) }}>
              {addable.map((t, i) => (
                <div
                  key={t.id}
                  id={"sprint-hit-" + i}
                  role="option"
                  aria-selected={i === Math.min(activeHit, addable.length - 1)}
                  onMouseEnter={() => setActiveHit(i)}
                  style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "40px", padding: "0 6px 0 10px", background: i === Math.min(activeHit, addable.length - 1) ? "var(--te-accent-soft)" : "transparent" }}
                >
                  <span title={`#${t.id} · ${t.title}`} style={{ flex: 1, minWidth: 0, fontSize: FONT.sm, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    #{t.id} · {t.title}
                  </span>
                  <button
                    type="button"
                    aria-label={`Add #${t.id} to the release plan`}
                    title="Add to Release plan"
                    disabled={busy.has("add-" + t.id)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => { fireBoltFromEvent(e); addToPlan(t); }}
                    style={{ flex: "0 0 auto", width: "40px", height: "40px", display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: COLORS.accent, cursor: "pointer" }}
                  >
                    {busy.has("add-" + t.id) ? <LoadingRing size={14} /> : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>
                    )}
                  </button>
                </div>
              ))}
            </MenuPanel>
          )}
          </AnimatePresence>
        </div>
      </PageToolbar>

      <main className="te-scroll te-main" style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto", padding: "28px", background: "var(--te-page-veil)" }}>
        <div className="te-sprint-page" style={{ width: "100%", flex: "1 1 0", minHeight: 0, display: "flex", flexDirection: "column", gap: "20px" }}>
          {initialLoading ? (
            <div style={{ display: "flex", justifyContent: "center", paddingTop: "80px" }}><LoadingRing size={120} /></div>
          ) : data && !data.configured ? (
            <div style={tintedCard("warning")}>
              <span style={{ fontSize: FONT.base, color: COLORS.warning, fontWeight: 600 }}>
                {data.notice || "This organization has no identity configured."}
              </span>
            </div>
          ) : !summary ? (
            <div style={tintedCard("warning")}>
              <span style={{ fontSize: FONT.base, color: COLORS.warning, fontWeight: 600 }}>
                {loadError || "Nothing to plan yet."}
              </span>
            </div>
          ) : (
            <>
              <AnimatePresence initial={false}>
              {loadError && (
                <Reveal key="err" gap={8}>
                <div style={tintedCard("danger")}>
                  <span style={{ fontSize: FONT.base, color: COLORS.danger, fontWeight: 600 }}>{loadError}</span>
                </div>
                </Reveal>
              )}
              {data?.notice && (
                <Reveal key="r">
                <div style={tintedCard("warning")}>
                  <span style={{ fontSize: FONT.base, color: COLORS.warning, fontWeight: 600 }}>{data.notice}</span>
                </div>
                </Reveal>
              )}
              </AnimatePresence>

              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <motion.span initial={{ opacity: 0, x: -40 }} animate={{ opacity: 1, x: 0 }} style={displayText("heading")}>{data?.sprint || "Last 14 days"}</motion.span>
                {refreshing && <LoadingRing size={16} />}
                {data?.window?.startDate && (
                  <span style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>
                    {dayLabel(data.window.startDate)} → {dayLabel(data.window.finishDate)}
                  </span>
                )}
                {verdict && <span style={pill({ color: verdict.color, size: "sm", weight: 700 })}>{verdict.label}</span>}
                {stored && (
                  <span style={pill({ color: stored.status === "active" ? COLORS.success : COLORS.textDim, size: "sm", weight: 700 })}>
                    PLAN {stored.status.toUpperCase()}
                  </span>
                )}
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: FONT.sm, color: COLORS.textDim }}>
                  {summary.ticketCount} tickets across {projectCount} project{projectCount === 1 ? "" : "s"}
                  {summary.handedOff.tickets > 0 ? ` · ${summary.handedOff.tickets} handed off` : ""}
                  {untrackedCount > 0 ? ` · ${untrackedCount} untracked` : ""}
                  {data?.truncated ? " · list truncated" : ""}
                  {data?.identity?.name ? " · " + data.identity.name : ""}
                </span>
              </div>

              <div
                className="te-sprint-split"
                style={{ flex: "1 1 auto", minHeight: 0, display: "grid", gridTemplateColumns: `minmax(0, 1fr) 610px ${legendOpen ? "200px" : "40px"}`, gridTemplateRows: "minmax(0, 1fr)", gap: "20px", transition: "grid-template-columns .38s var(--te-ease-expo)" }}
              >
              <div className="te-scroll te-sprint-pane te-sprint-side" style={{ gridColumn: 2, gridRow: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "20px" }}>
              <NeedsYou items={attention} />

              <AnimatePresence initial={false}>
              {(runningRows.length > 0 || reviewingRows.length > 0) && (
                <Reveal key="working" gap={20}>
                <div style={{ ...tintedCard("accent"), display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <LoadingRing size={18} />
                  <span style={{ fontSize: FONT.base, color: COLORS.text, fontWeight: 700 }}>
                    {runningRows.length > 0 && reviewingRows.length > 0
                      ? "WORKING NOW"
                      : reviewingRows.length > 0
                        ? "RESOLVING REVIEW"
                        : "IMPLEMENTING NOW"}
                  </span>
                  {[...runningRows.map((t) => ({ t, lane: "implementing" })), ...reviewingRows.map((t) => ({ t, lane: "resolving review" }))].map(({ t, lane }) => (
                    <span key={lane + t.ticketId} style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: FONT.base, color: COLORS.textMuted, fontWeight: 600 }}>
                        #{t.ticketId} · {t.title}
                      </span>
                      {runningRows.length > 0 && reviewingRows.length > 0 && (
                        <span style={pill({ color: COLORS.textDim, size: "xs", weight: 700 })}>{lane}</span>
                      )}
                      <ActionButton label="Watch run" variant="outline" onClick={() => openExecution(t.ticketId)} />
                    </span>
                  ))}
                  <div style={{ flex: 1 }} />
                  <ActionButton label="Stop all" variant="warning" onClick={askStopEverything} busy={busy.has("stop-all")} />
                </div>
                </Reveal>
              )}
              </AnimatePresence>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                <span style={fieldLabel()} title="Tracker status of the tickets still yours — the plan table shows the run state">TRACKER STATUS</span>
                {(Object.keys(LANE_LABEL) as Lane[]).map((lane) => (
                  <span key={lane} style={{ ...card({ padding: "8px 13px" }), display: "inline-flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: LANE_COLOR[lane] }} />
                    <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, fontWeight: 600 }}>{LANE_LABEL[lane]}</span>
                    <span style={{ fontSize: FONT.sm, color: COLORS.text, fontWeight: 700 }}>
                      {summary.byLane[lane].tickets} · {summary.byLane[lane].points}pt
                    </span>
                  </span>
                ))}
              </div>

              <SpendStrip spend={sprintSpend(rows, costs, planQuery.data?.ticketBudgetUsd ?? 0, releaseDayOptions.length, Number(stored?.pointsPerDay ?? data?.config.pointsPerDay) || 0)} budgetUsd={planQuery.data?.ticketBudgetUsd ?? 0} />

              <CapacityStrip days={releaseDayOptions} rows={rows} pointsPerDay={Number(stored?.pointsPerDay ?? data?.config.pointsPerDay) || 0} today={data?.today ?? ""} />

              <AnimatePresence initial={false}>
              {(data?.plan?.overflowPoints ?? 0) > 0 && (
                <Reveal key="overflow" gap={20}>
                <div style={tintedCard("danger")}>
                  <span style={{ fontSize: FONT.base, color: COLORS.danger, fontWeight: 600 }}>
                    {data?.plan?.overflowPoints} points have no release day left in this sprint at{" "}
                    {stored?.pointsPerDay ?? data?.config.pointsPerDay} points/day. Re-order, re-estimate, or move work out.
                  </span>
                </div>
                </Reveal>
              )}
              </AnimatePresence>

              <QaFollowUps
                cases={cases}
                edits={draftEdits}
                picks={casePicks}
                notes={caseNotes}
                busy={busy}
                onEdit={(id, body) => setDraftEdits((m) => ({ ...m, [id]: body }))}
                onPick={(id, picked) => setCasePicks((m) => ({ ...m, [id]: picked }))}
                onNote={(id, note) => setCaseNotes((m) => ({ ...m, [id]: note }))}
                onAnalyze={(c) => analyzeQaNow(c.plannedTicketId, c.ticketId)}
                onApprove={approveFixNow}
                onPost={askPostReply}
                onDismiss={dismissCaseNow}
                onWatch={openExecution}
              />

              {stored?.id ? <TickPreview planId={stored.id} onOpen={openExecution} /> : null}

              <SchedulerLog events={events} onOpen={openExecution} />
              </div>

              <div style={{ gridColumn: 1, gridRow: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
                <AutomationPanel
                  stored={stored}
                  busy={busy}
                  onBuild={buildPlan}
                  onSetStatus={(status) => (status === "active" ? askActivate() : patchPlan({ status }, "activate"))}
                  onToggle={(field, on) => patchPlan({ [field]: on }, field)}
                  onTick={tickNow}
                />
                <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={sectionCaption()}>
                    RELEASE PLAN · {stored?.pointsPerDay ?? data?.config.pointsPerDay} POINTS PER WORKING DAY
                  </span>
                  <span style={{ flex: 1 }} />
                  <button type="button" className="te-action-btn" disabled={!shownRows.length} title="Save the rows shown, in the order shown, as a CSV file" onClick={exportCsv} style={ctaButtonStyle("ghost")}>Export CSV</button>
                </span>
                <PlanFilters
                  filter={filter}
                  counts={filterCounts}
                  sort={sort}
                  project={projectFilter}
                  projects={rowProjects}
                  onFilter={setFilter}
                  onSort={setSort}
                  onProject={setProjectFilter}
                />
                <AnimatePresence initial={false}>
                {chosen.length > 0 && (
                  <Reveal key="bulk-bar" gap={8}>
                  <div style={{ ...card({ padding: "8px 12px" }), display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.text }}>{chosen.length} selected</span>
                    <div style={{ flex: 1 }} />
                    <button type="button" className="te-action-btn" disabled={!bulkHold.length} onClick={() => bulk(bulkHold, (t) => holdNow(t.id))} style={{ ...ctaButtonStyle("ghost"), opacity: bulkHold.length ? 1 : 0.4 }}>Hold {bulkHold.length}</button>
                    <button type="button" className="te-action-btn" disabled={!bulkSettings.length} onClick={() => setBulkOptions(true)} style={{ ...ctaButtonStyle("ghost"), opacity: bulkSettings.length ? 1 : 0.4 }}>Settings {bulkSettings.length}</button>
                    <button type="button" className="te-action-btn" disabled={!bulkRetry.length} onClick={askBulkRetry} style={{ ...ctaButtonStyle("warning"), opacity: bulkRetry.length ? 1 : 0.4 }}>Retry / resume {bulkRetry.length}</button>
                    <button type="button" className="te-action-btn" disabled={!bulkRemove.length} onClick={askBulkRemove} style={{ ...ctaButtonStyle("outline"), opacity: bulkRemove.length ? 1 : 0.4 }}>Remove {bulkRemove.length}</button>
                    <button type="button" className="te-action-btn" onClick={clearSelection} style={ctaButtonStyle("ghost")}>Clear</button>
                  </div>
                  </Reveal>
                )}
                </AnimatePresence>
                <div className="te-scroll te-sprint-pane" style={{ flex: "1 1 auto", minHeight: "360px", minWidth: 0, display: "flex" }}>
                <PlanTable
                  rows={shownRows}
                  data={data}
                  cases={cases}
                  closed={closedCases}
                  busy={busy}
                  releaseDayOptions={releaseDayOptions}
                  costs={costs}
                  clarifications={clarifications}
                  reorderable={reorderable}
                  selected={selected}
                  onSelect={(id, on) => setSelected((cur) => { const next = new Set(cur); if (on) next.add(id); else next.delete(id); return next; })}
                  onSelectAll={(on) => setSelected(on ? new Set(shownRows.filter((t) => t.id).map((t) => t.id)) : new Set())}
                  handlers={{
                    openExecution,
                    setUnblocked,
                    resolveReview: askResolveReview,
                    retry: retryNow,
                    release: askRelease,
                    analyzeQa: analyzeQaNow,
                    moveToQa: moveToQaNow,
                    remove: askRemove,
                    move: moveNow,
                    setReleaseDay: setReleaseDayNow,
                    hold: holdNow,
                    history: setHistoryFor,
                    runOptions: (row) => setOptionsFor(row.id),
                    askPo: (row) => setAskingFor(row.id),
                  }}
                />
                </div>
              </div>
              <div className="te-scroll te-sprint-pane" style={{ gridColumn: 3, gridRow: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                <ActionLegend open={legendOpen} onToggle={() => setLegendOpen((o) => !o)} />
              </div>
              </div>
            </>
          )}
        </div>
      </main>
      <AnimatePresence>
      {preview && <RebuildPreviewDialog key="rebuild" preview={preview} busy={busy.has("plan")} onConfirm={confirmRebuild} onCancel={() => setPreview(null)} />}
      {bulkOptions && bulkSettings.length > 0 && (
        <RunOptionsDialog
          key="bulk"
          ticketId=""
          count={bulkSettings.length}
          model={bulkSettings[0].model}
          effort={bulkSettings[0].effort}
          busy={bulkSettings.some((t) => busy.has("options-" + t.id))}
          onSave={saveBulkOptions}
          onCancel={() => setBulkOptions(false)}
        />
      )}
      {historyFor && (
        <TicketTimeline key="history" ticketId={historyFor} title={rows.find((t) => t.ticketId === historyFor)?.title ?? ""} onClose={() => setHistoryFor("")} />
      )}
      {optionsFor && (() => {
        const row = rows.find((t) => t.id === optionsFor);
        return row ? (
          <RunOptionsDialog
            key="options"
            ticketId={row.ticketId}
            model={row.model}
            effort={row.effort}
            busy={busy.has("options-" + row.id)}
            onSave={(model, effort) => saveRunOptionsNow(row.id, model, effort)}
            onCancel={() => setOptionsFor("")}
          />
        ) : null;
      })()}
      {(() => {
        const c = clarifications.find((x) => x.plannedTicketId === askingFor);
        return c ? (
          <AskPoDialog
            key="askpo"
            ticketId={c.ticketId}
            questions={c.questions}
            busy={busy.has("askpo-" + c.plannedTicketId)}
            onPost={(body) => askPoNow(c.plannedTicketId, body)}
            onCancel={() => setAskingFor("")}
          />
        ) : null;
      })()}
      {confirm && (
        <ConfirmDialog key="confirm" title={confirm.title} confirmLabel={confirm.confirmLabel} busy={busy.has(confirm.busyKey)} onConfirm={runConfirm} onCancel={() => setConfirm(null)}>
          {confirm.body}
        </ConfirmDialog>
      )}
      {reviewDialogRow && (
        <ResolveReviewDialog
          key="review"
          row={reviewDialogRow}
          busy={busy.has("fixreview-" + reviewDialogRow.id)}
          onConfirm={(findings) => resolveReviewNow(reviewDialogRow, findings)}
          onCancel={() => setReviewDialogRow(null)}
        />
      )}
      </AnimatePresence>
    </div>
  );
}
