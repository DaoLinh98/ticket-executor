"use client";

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
import ProviderBadge from "../ProviderBadge";
// import TriageReport from "./TriageReport";
import PageHeading from "../PageHeading";
import NotificationCenter from "../NotificationCenter";
import PageToolbar from "../PageToolbar";
import { useProjects } from "../../queries";
import { useLiveInvalidate } from "../../useLive";
import { useToast } from "../ToastProvider";
import { releaseDays, reorderQueue, type Lane, type QueueMove } from "@/lib/sprintPlan";
import { isFixingQa, MAX_QA_ROUNDS } from "@/lib/ticketLifecycle";
import type { Ticket } from "@/lib/types";
import type { TriagedTicket } from "@/lib/execution/triage";
import ActionButton from "./ActionButton";
import { ActionLegend, IconAction } from "./actionIcons";
import AutomationPanel from "./AutomationPanel";
import ConfirmDialog from "./ConfirmDialog";
import RunOptionsDialog from "./RunOptionsDialog";
import { DEFAULT_PLAN_EFFORT, DEFAULT_PLAN_MODEL } from "@/lib/claudeOptions";
import NeedsYou, { type AttentionItem } from "./NeedsYou";
import PlanFilters from "./PlanFilters";
import PlanTable from "./PlanTable";
import QcReplies from "./QcReplies";
import RebuildPreviewDialog from "./RebuildPreviewDialog";
import SchedulerLog from "./SchedulerLog";
import CapacityStrip from "./CapacityStrip";
import TicketTimeline from "./TicketTimeline";
import {
  LANE_COLOR,
  LANE_LABEL,
  VERDICT,
  dayLabel,
  matchesFilter,
  type MySprint,
  type PlanFilter,
  type PlanSort,
  type PlanResponse,
  type PlannedRow,
  type QaDraft,
  type RebuildPreview,
  type StoredPlan,
  PLAN_KEY,
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

type Confirm = { title: string; confirmLabel: string; busyKey: string; body: ReactNode; run: () => Promise<void> };

const SPRINT_KEY = ["my-sprint"] as const;
const PLAN_POLL_MS = 5000;
const PLAN_IDLE_POLL_MS = 30000;
const SPRINT_POLL_MS = 60000;
const SEARCH_STALE_MS = 30000;
const TONE_RANK = { danger: 0, warning: 1, accent: 2 } as const;

const planRunning = (p?: PlanResponse) =>
  (p?.plan?.items ?? []).some((t) => t.implementState === "running") || (p?.drafts ?? []).some((d) => d.status === "running");

export default function MySprintPage() {
  const router = useRouter();
  const { fireBoltFromEvent } = useBoltsContext();
  const showToast = useToast();
  const queryClient = useQueryClient();
  // Triage is switched off on this page for now.
  // const [triage, setTriage] = useState<TriageRow | null>(null);
  // const [reportOpen, setReportOpen] = useState(false);
  // const triagePoll = useRef<ReturnType<typeof setInterval> | null>(null);
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [legendOpen, setLegendOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [settledNeedle, setSettledNeedle] = useState("");
  const [preview, setPreview] = useState<RebuildPreview | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [filter, setFilter] = useState<PlanFilter>("all");
  const [sort, setSort] = useState<PlanSort>("queue");
  const [projectFilter, setProjectFilter] = useState("");
  const [historyFor, setHistoryFor] = useState("");
  const [optionsFor, setOptionsFor] = useState("");

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
    queryFn: (): Promise<MySprint> => fetch("/api/my-sprint").then((r) => r.json()),
    refetchOnWindowFocus: true,
    refetchInterval: () => (planQuery.data?.plan?.status === "active" ? SPRINT_POLL_MS : false),
  });

  const projects = (projectsQuery.data?.projects ?? []).map((p) => p.name);
  const data = sprintQuery.data ?? null;
  const stored = planQuery.data?.plan ?? null;
  const events = planQuery.data?.events ?? [];
  const drafts = planQuery.data?.drafts ?? [];
  const costs = planQuery.data?.costs ?? {};
  const initialLoading = sprintQuery.isPending || planQuery.isPending;
  const refreshing = !initialLoading && (sprintQuery.isFetching || planQuery.isFetching);
  const loadError = data?.error || (sprintQuery.error as Error | null)?.message || (planQuery.error as Error | null)?.message || "";

  const reloadSprint = () => queryClient.invalidateQueries({ queryKey: SPRINT_KEY, exact: true });
  const load = () => { void reloadSprint(); };
  const reloadPlan = () => queryClient.invalidateQueries({ queryKey: PLAN_KEY, exact: true });
  const setStored = (plan: StoredPlan | null) =>
    queryClient.setQueryData<PlanResponse>(PLAN_KEY, (old) => ({ events: [], drafts: [], costs: {}, ...old, plan }));

  // A triage turn outlives the request that started it, so the row is polled
  // rather than awaited.
  // useEffect(() => {
  //   if (triage?.status !== "running") {
  //     if (triagePoll.current) { clearInterval(triagePoll.current); triagePoll.current = null; }
  //     return;
  //   }
  //   triagePoll.current = setInterval(async () => {
  //     try {
  //       const r = await fetch("/api/my-sprint/triage?id=" + encodeURIComponent(triage.id));
  //       const d = await r.json();
  //       if (d.triage) setTriage(d.triage);
  //     } catch { /* the next tick tries again */ }
  //   }, 5000);
  //   return () => { if (triagePoll.current) clearInterval(triagePoll.current); };
  // }, [triage?.status, triage?.id]);

  useLiveInvalidate(stored?.id ? "/api/my-sprint/plan/stream?plan=" + encodeURIComponent(stored.id) : null, PLAN_KEY);

  const needle = query.trim().toLowerCase().replace(/^#/, "");
  const searchTerm = query.trim().replace(/^#/, "");
  useEffect(() => {
    const timer = setTimeout(() => setSettledNeedle(searchTerm), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);
  const searchQuery = useQuery({
    queryKey: ["ticket-search", settledNeedle],
    queryFn: ({ signal }): Promise<Ticket[]> =>
      fetch("/api/tickets/search?q=" + encodeURIComponent(settledNeedle), { signal })
        .then((r) => r.json())
        .then((d) => (Array.isArray(d.tickets) ? d.tickets : [])),
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

  const act = (label: string, fn: () => Promise<void>, optimistic?: PlanEdit) =>
    actMutation.mutateAsync({ label, fn, optimistic }).catch(() => undefined);

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

  // const runTriage = () =>
  //   act("triage", async () => {
  //     const d = await post("/api/my-sprint/triage", {});
  //     setTriage({ id: d.id, status: "running", result: {}, errorMessage: "", costUsd: 0 });
  //   });

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
      setMessage("On hold — the scheduler leaves it alone until you resume it.");
    }, editItem(plannedId, { implementState: "skipped" }));

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
      else setMessage("Back in the queue — the scheduler starts it on its next pass.");
    });

  const draftReplyNow = (plannedId: string) =>
    act("draft-" + plannedId, async () => {
      await post("/api/my-sprint/plan", { draftQaReply: plannedId }, "PUT");
      showToast("Drafting a reply to QC — nothing is posted until you confirm.");
      await reloadPlan();
    });

  const postReplyNow = (draft: QaDraft) =>
    act("post-" + draft.id, async () => {
      await post("/api/my-sprint/plan", { postQaReply: draft.id, body: draftEdits[draft.id] ?? draft.body }, "PUT");
      showToast(`Reply posted on #${draft.ticketId}.`);
      await reloadPlan();
    });

  const dismissReplyNow = (draft: QaDraft) =>
    act("dismiss-" + draft.id, async () => {
      await post("/api/my-sprint/plan", { dismissQaReply: draft.id }, "PUT");
      await reloadPlan();
    });

  const startQaFixNow = (plannedId: string, ticketId: string) =>
    act("qafix-" + plannedId, async () => {
      try {
        const d = await post("/api/my-sprint/plan", { startQaFix: plannedId }, "PUT");
        if (d.plan) setStored(d.plan);
        showToast("QA fix started — it reviews QC's findings, then fixes the real defects or drafts a reply.");
      } catch (e) {
        sendToRootRepo(e, ticketId);
      }
    });

  const moveToQaNow = (plannedId: string) =>
    act("qa-" + plannedId, async () => {
      const d = await post("/api/my-sprint/plan", { moveToQa: plannedId }, "PUT");
      if (d.plan) setStored(d.plan);
      showToast(`Moved to "${d.outcome?.status || "In QA"}".`);
      await load();
    });

  const resolveReviewNow = (plannedId: string, ticketId: string) =>
    act("fixreview-" + plannedId, async () => {
      try {
        const d = await post("/api/my-sprint/plan", { resolveReview: plannedId }, "PUT");
        if (d.plan) setStored(d.plan);
        if (d.outcome && !d.outcome.ok) setError(d.outcome.error || "The review fix did not start.");
        else setMessage("Resolving the review comments on this pull request.");
      } catch (e) {
        sendToRootRepo(e, ticketId);
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

  const askPostReply = (draft: QaDraft) =>
    setConfirm({
      title: `Post the reply on #${draft.ticketId}?`,
      confirmLabel: "Post reply",
      busyKey: "post-" + draft.id,
      body: <span>The reply is posted as a comment on the work item under your name.</span>,
      run: () => postReplyNow(draft),
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
  const triaged = new Map<string, TriagedTicket>();
  // const triaged = new Map<string, TriagedTicket>(
  //   (triage?.result?.tickets ?? []).map((t) => [String(t.id), t])
  // );
  const projectCount = new Set((data?.tickets ?? []).map((t) => t.project).filter(Boolean)).size;
  const rows: PlannedRow[] =
    stored?.items?.length
      ? stored.items.filter((i) => !i.untracked)
      : (data?.plan?.tickets ?? []).map((t) => ({
          id: "", ticketId: t.ticketId, title: t.title, project: t.project, implementOrder: t.implementOrder,
          points: t.points, estimateHours: t.estimateHours, releaseDay: t.releaseDay,
          blocked: t.blocked, unblockedByUser: false, implementState: "pending", runId: "", prUrl: "",
          prPublished: false, reviewersSet: false, statusMoved: false, releasedAt: null, releaseError: "",
          reviewState: "idle", reviewRunId: "", openComments: 0, threadsReplied: 0, threadsResolved: 0,
          reviewRounds: 0, reviewError: "",
          claim: t.claim, assigneeNow: t.assigneeNow,
          model: DEFAULT_PLAN_MODEL, effort: DEFAULT_PLAN_EFFORT,
          stage: "", prMerged: false, pendingAction: "", qaRounds: 0,
        }));

  // Removed from the plan by hand but still in the sprint — named so the header total matches the table.
  const untrackedCount = stored?.items?.filter((i) => i.untracked).length ?? 0;
  const planned = new Set(rows.map((t) => t.ticketId));
  const addable = needle && stored ? found.filter((t) => !planned.has(t.id)) : [];

  const runningRows = rows.filter((t) => t.implementState === "running");
  const reviewingRows = rows.filter((t) => t.reviewState === "running");

  const releaseDayOptions = data?.window?.startDate && data.today ? releaseDays(data.window, data.today) : [];

  const attention: AttentionItem[] = [];
  for (const t of rows) {
    if (!t.id || t.claim !== "mine") continue;
    const base = { ticketId: t.ticketId, title: t.title };
    const due = !!t.prUrl && t.implementState === "implemented" && !t.releasedAt;
    const replyWaiting = drafts.some((d) => d.plannedTicketId === t.id && d.status !== "failed");
    const result = <IconAction action="result" onClick={() => openExecution(t.ticketId)} />;
    if (t.reviewState === "needs-human") {
      attention.push({ ...base, key: "nh-" + t.id, tone: "warning", text: `${t.reviewRounds} rounds of automatic review fixes did not close it — the rest needs a decision.`, action: result });
    }
    if (t.reviewState === "failed") {
      attention.push({
        ...base, key: "rf-" + t.id, tone: "danger", text: "The review fix run failed.",
        action: t.prPublished && !t.prMerged && t.openComments > 0
          ? <IconAction action="fixReview" onClick={() => resolveReviewNow(t.id, t.ticketId)} busy={busy.has("fixreview-" + t.id)} />
          : result,
      });
    }
    if (t.releaseError) {
      attention.push({
        ...base, key: "re-" + t.id, tone: "danger", text: t.releaseError,
        action: due ? <IconAction action="release" onClick={() => askRelease(t)} busy={busy.has("release-" + t.id)} /> : undefined,
      });
    }
    if (t.implementState === "failed") {
      attention.push({
        ...base, key: "if-" + t.id, tone: "danger",
        text: t.prUrl ? "The run failed after opening a pull request — look at the result." : "The implement run failed.",
        action: !t.prUrl && t.implementOrder > 0
          ? <IconAction action="retry" onClick={() => retryNow(t.id)} busy={busy.has("retry-" + t.id)} />
          : result,
      });
    }
    if (t.pendingAction === "move-to-qa") {
      attention.push({
        ...base, key: "mq-" + t.id, tone: "accent", text: "Pull request merged — confirm to move it to In QA.",
        action: <IconAction action="moveToQa" onClick={() => moveToQaNow(t.id)} busy={busy.has("qa-" + t.id)} />,
      });
    }
    if (t.pendingAction === "fix-qa" && !isFixingQa(t) && t.implementState !== "running" && t.reviewState !== "running") {
      if (t.qaRounds >= MAX_QA_ROUNDS) {
        attention.push({ ...base, key: "qx-" + t.id, tone: "danger", text: `${t.qaRounds} QA fixes did not close this ticket — it needs you.`, action: result });
      } else if (!replyWaiting) {
        attention.push({
          ...base, key: "qf-" + t.id, tone: "warning", text: "Came back from QA — start the QA fix.",
          action: <IconAction action="qaFix" onClick={() => startQaFixNow(t.id, t.ticketId)} busy={busy.has("qafix-" + t.id)} />,
        });
      }
    }
    if (due && !stored?.autoRelease && data?.today && t.releaseDay && t.releaseDay <= data.today && !t.releaseError) {
      attention.push({
        ...base, key: "rd-" + t.id, tone: "accent", text: "Its release day has come and auto-release is off.",
        action: <IconAction action="release" onClick={() => askRelease(t)} busy={busy.has("release-" + t.id)} />,
      });
    }
  }
  for (const d of drafts) {
    if (d.status !== "ready") continue;
    const row = rows.find((r) => r.id === d.plannedTicketId);
    attention.push({
      key: "dr-" + d.id, ticketId: d.ticketId, title: row?.title ?? "", tone: "warning",
      text: d.needsHuman ? "A reply to QC is drafted and needs your decision." : "A reply to QC is drafted — post or dismiss it.",
      action: <IconAction action="readDraft" onClick={() => document.getElementById("qc-replies")?.scrollIntoView({ behavior: "smooth" })} />,
    });
  }
  attention.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);

  const attentionIds = new Set(attention.map((a) => a.ticketId));
  const filterCounts = Object.fromEntries(
    (["all", "attention", "queued", "running", "review", "done"] as PlanFilter[]).map((f) => [f, rows.filter((t) => matchesFilter(t, f, attentionIds)).length])
  ) as Record<PlanFilter, number>;
  const rowProjects = [...new Set(rows.map((t) => t.project).filter(Boolean))].sort();
  const shownRows = rows
    .filter((t) => matchesFilter(t, filter, attentionIds) && (!projectFilter || t.project === projectFilter))
    .sort((a, b) => (sort === "release" ? (a.releaseDay || "9999").localeCompare(b.releaseDay || "9999") : 0));
  const reorderable = filter === "all" && sort === "queue" && !projectFilter;

  // Bulk actions reuse the per-row writes one after another, each only on the rows its row button would show on.
  const chosen = rows.filter((t) => t.id && selected.has(t.id));
  const bulkHold = chosen.filter(queued);
  const bulkRetry = chosen.filter((t) => t.claim === "mine" && !t.prUrl && t.implementOrder > 0 && (t.implementState === "failed" || t.implementState === "skipped"));
  const bulkRemove = chosen.filter((t) => t.implementState !== "running" && t.reviewState !== "running");
  const clearSelection = () => setSelected(new Set());
  const bulk = async (list: PlannedRow[], fn: (t: PlannedRow) => Promise<unknown>) => {
    for (const t of list) await fn(t);
    clearSelection();
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
            {flag(stored.autoResolveReview)} · Auto-draft QC reply {flag(stored.autoDraftQaReply)}
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
      <header className="te-page-header" style={{ position: "relative", zIndex: 30, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "14px", padding: "0 28px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "var(--te-header-bg)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <PageHeading title="Flow Runner"kicker="D-AGENT · AUTOMATION" icon={<><path d="M8 2v4M16 2v4M3 10h18" /><path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>} />
        <div style={{ flex: 1 }} />
        <NotificationCenter />
        <ProviderBadge />
      </header>

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
            onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            placeholder="Search ticket by ID or title"
            aria-label="Search tickets by ID or title"
            autoComplete="off"
            spellCheck={false}
            style={{ ...fieldInput(), width: "100%", boxSizing: "border-box" }}
          />
          {searchOpen && needle && stored && addable.length === 0 && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 40, ...dropdownPanelStyle({ maxHeight: "320px" }) }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "40px", padding: "0 10px", fontSize: FONT.sm, color: COLORS.textMuted }}>
                {searching ? <><LoadingRing size={14} /> Searching all projects…</> : "No other ticket matches."}
              </div>
            </div>
          )}
          {searchOpen && addable.length > 0 && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 40, ...dropdownPanelStyle({ maxHeight: "320px" }) }}>
              {addable.map((t) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "40px", padding: "0 6px 0 10px" }}>
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
            </div>
          )}
        </div>
      </PageToolbar>

      <main className="te-scroll te-main" style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto", padding: "28px", background: "var(--te-page-veil)" }}>
        <div className="te-sprint-page" style={{ maxWidth: "1820px", width: "100%", flex: "1 1 0", minHeight: 0, margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>
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
              {loadError && (
                <div style={tintedCard("danger")}>
                  <span style={{ fontSize: FONT.base, color: COLORS.danger, fontWeight: 600 }}>{loadError}</span>
                </div>
              )}
              {data?.notice && (
                <div style={tintedCard("warning")}>
                  <span style={{ fontSize: FONT.base, color: COLORS.warning, fontWeight: 600 }}>{data.notice}</span>
                </div>
              )}

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
                style={{ flex: "1 1 auto", minHeight: 0, display: "grid", gridTemplateColumns: `minmax(0, 1fr) 460px ${legendOpen ? "200px" : "40px"}`, gridTemplateRows: "minmax(0, 1fr)", gap: "20px", transition: "grid-template-columns .38s var(--te-ease-expo)" }}
              >
              <div className="te-scroll te-sprint-pane te-sprint-side" style={{ gridColumn: 2, gridRow: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "20px" }}>
              <NeedsYou items={attention} />

              {(runningRows.length > 0 || reviewingRows.length > 0) && (
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
                </div>
              )}

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

              {/* ---- triage (switched off for now) ---- */}
              {/*
              <div style={{ ...card({ padding: "16px" }), display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <span style={sectionCaption()}>TRIAGE</span>
                  {triage?.status === "running" && <LoadingRing size={14} />}
                  {triage?.status === "succeeded" && (
                    <span style={pill({ color: COLORS.textMuted, size: "xs", weight: 600 })}>
                      ${triage.costUsd.toFixed(2)}
                    </span>
                  )}
                  {!rootRepo.trim() && (
                    <span
                      title="Fill in the root repo below and re-run to get verdicts the code actually backs."
                      style={pill({ color: COLORS.warning, size: "xs", weight: 700 })}
                    >
                      No repo — work items only
                    </span>
                  )}
                  <div style={{ flex: 1 }} />
                  {button(triage ? "Re-run triage" : "Triage sprint", "outline", runTriage, "triage", triage?.status === "running")}
                </div>
                <span style={{ fontSize: FONT.sm, color: COLORS.textDim, lineHeight: 1.6 }}>
                  An agent reads your tickets and judges readiness, sizing and work order. It writes nothing — no
                  comment, no story point, no state. You apply what you accept.
                </span>
                <label style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "520px" }}>
                  <span style={fieldLabel()}>ROOT REPO FOR THIS PROJECT (OPTIONAL)</span>
                  <input
                    value={rootRepo}
                    onChange={(e) => setRootRepo(e.target.value)}
                    onBlur={saveRootRepo}
                    placeholder="C:\repos\my-project"
                    autoComplete="off"
                    spellCheck={false}
                    style={fieldInput()}
                  />
                  <span style={{ fontSize: FONT.sm, color: COLORS.textDim, lineHeight: 1.6 }}>
                    {rootRepo.trim()
                      ? "Triage reads this clone's own conventions, and scheduled runs work in it."
                      : "Without one, triage judges from the work item text alone — it cannot tell a requirement the "
                        + "codebase already answers from one that is genuinely ambiguous, and its sizing is directional. "
                        + "Automatic runs cannot start at all."}
                  </span>
                </label>
                {triage?.status === "failed" && (
                  <span style={{ fontSize: FONT.base, color: COLORS.danger, fontWeight: 600 }}>{triage.errorMessage}</span>
                )}
                {triage?.result?.summary && (
                  <span style={{ fontSize: FONT.base, color: COLORS.textMuted, lineHeight: 1.6 }}>{triage.result.summary}</span>
                )}
                {triage?.status === "succeeded" && (triage.result?.tickets?.length ?? 0) > 0 && (
                  <div style={{ display: "flex" }}>
                    {button(
                      `View full report · ${triage.result?.tickets?.length ?? 0} tickets`,
                      "primary",
                      () => setReportOpen(true),
                      "report"
                    )}
                  </div>
                )}
              </div>
              */}

              <CapacityStrip days={releaseDayOptions} rows={rows} pointsPerDay={Number(stored?.pointsPerDay ?? data?.config.pointsPerDay) || 0} today={data?.today ?? ""} />

              {(data?.plan?.overflowPoints ?? 0) > 0 && (
                <div style={tintedCard("danger")}>
                  <span style={{ fontSize: FONT.base, color: COLORS.danger, fontWeight: 600 }}>
                    {data?.plan?.overflowPoints} points have no release day left in this sprint at{" "}
                    {stored?.pointsPerDay ?? data?.config.pointsPerDay} points/day. Re-order, re-estimate, or move work out.
                  </span>
                </div>
              )}

              <QcReplies
                drafts={drafts}
                edits={draftEdits}
                busy={busy}
                onEdit={(id, body) => setDraftEdits((m) => ({ ...m, [id]: body }))}
                onPost={askPostReply}
                onDismiss={dismissReplyNow}
              />

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
                <span style={sectionCaption()}>
                  RELEASE PLAN · {stored?.pointsPerDay ?? data?.config.pointsPerDay} POINTS PER WORKING DAY
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
                {chosen.length > 0 && (
                  <div style={{ ...card({ padding: "8px 12px" }), display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.text }}>{chosen.length} selected</span>
                    <div style={{ flex: 1 }} />
                    <button type="button" className="te-action-btn" disabled={!bulkHold.length} onClick={() => bulk(bulkHold, (t) => holdNow(t.id))} style={{ ...ctaButtonStyle("ghost"), opacity: bulkHold.length ? 1 : 0.4 }}>Hold {bulkHold.length}</button>
                    <button type="button" className="te-action-btn" disabled={!bulkRetry.length} onClick={() => bulk(bulkRetry, (t) => retryNow(t.id))} style={{ ...ctaButtonStyle("warning"), opacity: bulkRetry.length ? 1 : 0.4 }}>Retry / resume {bulkRetry.length}</button>
                    <button type="button" className="te-action-btn" disabled={!bulkRemove.length} onClick={askBulkRemove} style={{ ...ctaButtonStyle("outline"), opacity: bulkRemove.length ? 1 : 0.4 }}>Remove {bulkRemove.length}</button>
                    <button type="button" className="te-action-btn" onClick={clearSelection} style={ctaButtonStyle("ghost")}>Clear</button>
                  </div>
                )}
                <div className="te-scroll te-sprint-pane" style={{ flex: "1 1 auto", minHeight: "360px", minWidth: 0, display: "flex" }}>
                <PlanTable
                  rows={shownRows}
                  data={data}
                  drafts={drafts}
                  triaged={triaged}
                  busy={busy}
                  releaseDayOptions={releaseDayOptions}
                  costs={costs}
                  reorderable={reorderable}
                  selected={selected}
                  onSelect={(id, on) => setSelected((cur) => { const next = new Set(cur); if (on) next.add(id); else next.delete(id); return next; })}
                  handlers={{
                    openExecution,
                    setUnblocked,
                    resolveReview: resolveReviewNow,
                    retry: retryNow,
                    release: askRelease,
                    draftReply: draftReplyNow,
                    startQaFix: startQaFixNow,
                    moveToQa: moveToQaNow,
                    remove: askRemove,
                    move: moveNow,
                    setReleaseDay: setReleaseDayNow,
                    hold: holdNow,
                    history: setHistoryFor,
                    runOptions: (row) => setOptionsFor(row.id),
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
      {preview && <RebuildPreviewDialog preview={preview} busy={busy.has("plan")} onConfirm={confirmRebuild} onCancel={() => setPreview(null)} />}
      {historyFor && (
        <TicketTimeline ticketId={historyFor} title={rows.find((t) => t.ticketId === historyFor)?.title ?? ""} onClose={() => setHistoryFor("")} />
      )}
      {optionsFor && (() => {
        const row = rows.find((t) => t.id === optionsFor);
        return row ? (
          <RunOptionsDialog
            ticketId={row.ticketId}
            model={row.model}
            effort={row.effort}
            busy={busy.has("options-" + row.id)}
            onSave={(model, effort) => saveRunOptionsNow(row.id, model, effort)}
            onCancel={() => setOptionsFor("")}
          />
        ) : null;
      })()}
      {confirm && (
        <ConfirmDialog title={confirm.title} confirmLabel={confirm.confirmLabel} busy={busy.has(confirm.busyKey)} onConfirm={runConfirm} onCancel={() => setConfirm(null)}>
          {confirm.body}
        </ConfirmDialog>
      )}
      {/* {reportOpen && triage?.status === "succeeded" && (
        <TriageReport
          data={triage.result}
          sprint={data?.sprint ?? ""}
          costUsd={triage.costUsd}
          onClose={() => setReportOpen(false)}
        />
      )} */}
    </div>
  );
}
