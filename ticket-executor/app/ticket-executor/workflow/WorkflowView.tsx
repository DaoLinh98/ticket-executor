"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { COLORS, FONT, card, chipShape, ctaButtonStyle, tintedCard } from "@/lib/ui";
import { layoutRun } from "@/lib/workflow/layout";
import { STAGES, STATUS } from "@/lib/workflow/meta";
import {
  FRESH_START,
  bannerOf,
  compareRuns,
  edgeViews,
  hudOf,
  inspectNode,
  laneViews,
  logLinesOf,
  nodeView,
  oneLine,
  retryAdviceOf,
  runSections,
  timelineOf,
  type BannerAction,
} from "@/lib/workflow/present";
import type { FlowNodeDef, GateResult, LifecycleStage } from "@/lib/workflow/types";
import type { RunListItem, RunView } from "@/lib/dagent/view";
import PageHeading from "../../(app)/PageHeading";
import NotificationCenter from "../../(app)/NotificationCenter";
import ProviderBadge from "../../(app)/ProviderBadge";
import PageToolbar from "../../(app)/PageToolbar";
import { useResolvedIsMobile } from "../../(app)/MobileNav";
import { useToast } from "../../(app)/ToastProvider";
import { copyText } from "../../(app)/report/copyText";
import { useLiveInvalidate } from "../../useLive";
import { planRowKey, usePlanRow } from "../../queries";
import LoadingRing from "../LoadingRing";
import { useNow } from "../execution/useNow";
import { RefusalCard, StateBanner, WorkflowHud, type WorkflowMode } from "./Chrome";
import NodeInspector, { type InspectorTab, type LogFilter, type SheetState } from "./NodeInspector";
import { MONO } from "./parts";
import PlanRowCard, { PlanRowChip } from "./PlanRowCard";
import PreviousRun from "./PreviousRun";
import TicketLifecycle from "./TicketLifecycle";
import { RawLog, TimelineView } from "./Views";
import RunPicker from "./RunPicker";
import WorkflowCanvas from "./WorkflowCanvas";

type Ui = {
  sel: string | null;
  follow: boolean;
  mode: WorkflowMode;
  tab: InspectorTab | null;
  attempt: number | null;
  sheet: SheetState;
  json: boolean;
  logFilter: LogFilter;
  query: string;
  edgePop: string | null;
  retryFrom: string | null;
  copied: boolean;
  fixOpen: boolean;
  lcOpen: boolean;
  hudOpen: boolean;
  mLcOpen: boolean;
  allPaths: boolean;
};

const INITIAL: Ui = {
  sel: null,
  follow: true,
  mode: "flow",
  tab: null,
  attempt: null,
  sheet: "peek",
  json: false,
  logFilter: "all",
  query: "",
  edgePop: null,
  retryFrom: null,
  copied: false,
  fixOpen: false,
  lcOpen: true,
  hudOpen: false,
  mLcOpen: false,
  allPaths: false,
};

type RunsPayload = { runs: RunListItem[] };

const RUNS_KEY = ["dagent", "runs"] as const;
const runKeyOf = (id: string | null) => ["dagent", "run", id] as const;

const ACTIVE = ["running", "waiting"];

// The canvas shape while no run is loaded, so every derived view always has a node to select.
const IDLE_DEFS: FlowNodeDef[] = [
  { id: "preflight", label: "Preflight", phase: "pre-run", kind: "gate", effects: "pure", context: "", next: ["admission"] },
  { id: "admission", label: "Admission", phase: "pre-run", kind: "gate", effects: "pure", context: "", next: [] },
];

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d?.error || d?.outcome?.error || `${url} failed (${r.status})`), { body: d });
  return d as T;
}

const post = <T,>(url: string, body: unknown = {}) =>
  readJson<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const EMPTY_LIFECYCLE: LifecycleStage[] = STAGES.map(([id, label]) => ({ id, label, status: "todo", at: "", detail: "", runs: [] }));

export default function WorkflowView() {
  const mobile = useResolvedIsMobile();
  const showToast = useToast();
  const params = useSearchParams();
  const qc = useQueryClient();
  const ticketParam = params.get("ticket");
  // A run linked directly (Run History) — shown as is, even when it is older than the run list holds.
  const runParam = params.get("run");
  const [ui, setUi] = useState<Ui>(INITIAL);
  const [refusedGates, setRefusedGates] = useState<GateResult[] | null>(null);
  // An older run the user chose to look at; null follows the ticket's live (else latest) run.
  const [pickedRun, setPickedRun] = useState<string | null>(null);
  // A ticket picked from the run dropdown overrides the one in the URL.
  const [pickedTicket, setPickedTicket] = useState<string | null>(null);
  const now = useNow(true);

  const patch = useCallback((p: Partial<Ui>) => setUi((u) => ({ ...u, ...p })), []);
  const reset = useCallback((p?: Partial<Ui>) => setUi((u) => ({ ...INITIAL, lcOpen: u.lcOpen, ...p })), []);

  const runsQ = useQuery({ queryKey: RUNS_KEY, queryFn: () => readJson<RunsPayload>("/api/dagent/runs"), staleTime: 0 });
  useLiveInvalidate("/api/dagent/runs/stream", RUNS_KEY);
  // The run on screen is derived, never stored: the ticket's run in flight (or its latest), so a run the
  // scheduler starts takes the screen over through the list stream alone.
  const runs = runsQ.data?.runs ?? [];
  const linked = pickedTicket === null ? runParam : null;
  const linkedView = useQuery({ queryKey: runKeyOf(linked), queryFn: () => readJson<RunView>(`/api/dagent/runs/${linked}`), enabled: !!linked, staleTime: 0 });
  const ticketKey = pickedTicket ?? ticketParam ?? (linked ? (linkedView.data?.ticket.id ?? null) : null);
  const pool = ticketKey ? runs.filter((r) => r.ticketId === ticketKey) : linked ? [] : runs;
  const runId = linked ?? pool.find((r) => r.id === pickedRun)?.id ?? (pool.find((r) => ACTIVE.includes(r.state)) ?? pool[0])?.id ?? null;
  const pickRun = (r: RunListItem, newest: boolean) => {
    setPickedTicket(r.ticketId);
    setPickedRun(newest ? null : r.id);
    reset();
  };
  const viewQ = useQuery({ queryKey: runKeyOf(runId), queryFn: () => readJson<RunView>(`/api/dagent/runs/${runId}`), enabled: !!runId, staleTime: 0 });
  useLiveInvalidate(runId ? `/api/dagent/runs/${runId}/stream` : null, runKeyOf(runId));

  const real = runId ? (viewQ.data ?? null) : null;
  const run = real?.run ?? null;

  // A retry is compared with the run it retried, read through the same run view.
  const prevId = real?.retryOf || null;
  const prevQ = useQuery({ queryKey: runKeyOf(prevId), queryFn: () => readJson<RunView>(`/api/dagent/runs/${prevId}`), enabled: !!prevId, staleTime: 0 });
  const diff = useMemo(() => (real && prevQ.data ? compareRuns(prevQ.data, real) : null), [real, prevQ.data]);

  // The ticket's Flow Runner row: moved by the run (state, PR) and by the plan (queue, release day), so both streams refresh it.
  const planTicket = real?.ticket.id ?? "";
  const planProvider = real?.ticket.provider ?? "";
  const planQ = usePlanRow(planTicket, planProvider);
  const planId = planQ.data?.planId || null;
  useLiveInvalidate(runId && planTicket ? `/api/dagent/runs/${runId}/stream` : null, planRowKey(planTicket, planProvider));
  useLiveInvalidate(planId ? `/api/my-sprint/plan/stream?plan=${planId}` : null, planRowKey(planTicket, planProvider));
  const gates = refusedGates ?? real?.gates ?? [];
  const lifecycle = real?.lifecycle ?? EMPTY_LIFECYCLE;
  const vertical = mobile === true;
  const layout = useMemo(
    () => layoutRun(run?.defs ?? IDLE_DEFS, vertical ? "TB" : "LR", run ? run.transitions.map((t): [string, string] => [t.fromNode, t.toNode]) : []),
    [run, vertical],
  );

  const live = !!run && (run.state === "running" || run.state === "preparing");
  const liveish = live || run?.state === "waiting";
  const curId = run?.currentNodeId ?? "admission";
  const selected = layout.nodes.find((n) => n.id === (ui.sel ?? curId)) ?? layout.nodes.find((n) => n.id === curId) ?? layout.nodes[0];
  const tab: InspectorTab = ui.tab ?? (run && (run.state === "failed" || run.state === "succeeded") && !ui.sel ? "run" : "node");

  const nodeViews = useMemo(() => layout.nodes.map((n) => nodeView(run, gates, n, now, layout, selected.id)), [run, gates, layout, now, selected.id]);
  const edges = useMemo(() => edgeViews(run, layout, selected.id, ui.allPaths), [run, layout, selected.id, ui.allPaths]);
  const lanes = useMemo(() => laneViews(run, gates, layout, now), [run, gates, layout, now]);
  const hud = useMemo(() => hudOf(run, now), [run, now]);
  const banner = useMemo(() => bannerOf(run, now, null), [run, now]);
  const timeline = useMemo(() => timelineOf(run, now), [run, now]);
  const allLogs = useMemo(() => logLinesOf(run, now, gates), [run, now, gates]);
  const inspector = useMemo(() => inspectNode(run, gates, selected, ui.attempt, now), [run, gates, selected, ui.attempt, now]);
  // Only the ticket's newest run may be retried or cancelled — acting from an older one would race the run that replaced it.
  // A run older than the list is newest only if the ticket has no listed run and the server says so.
  const latest = pool.length ? runId === pool[0].id : (real?.newest ?? !linked);
  const runSecs = useMemo(() => runSections(run, gates, now).filter((s) => latest || s.kind !== "retry"), [run, gates, now, latest]);
  const advice = useMemo(() => retryAdviceOf(run), [run]);

  const q = ui.query.toLowerCase();
  const attemptNo = inspector.attempts[inspector.attemptIndex]?.n;
  const nodeLogs = allLogs.filter((l) => l.node === selected.id && (attemptNo === undefined || l.attempt === attemptNo) && (ui.logFilter === "all" || l.lvl === ui.logFilter) && (!q || l.text.toLowerCase().includes(q)));

  const steps = run
    ? run.steps.map((s, i) => `${i + 1}. ${run.defs.find((d) => d.id === s.nodeId)?.label ?? s.nodeId} attempt ${s.attempt}: ${STATUS[s.status].text}${s.output ? `, ${oneLine(s.output)}` : ""}`)
    : [`No run yet. Admission refused: ${gates.find((g) => g.status === "refused")?.reason ?? ""}`];

  const pick = useCallback((id: string) => setUi((u) => ({ ...u, sel: id, follow: false, attempt: null, tab: "node", edgePop: null, sheet: u.sheet === "closed" ? "peek" : u.sheet })), []);
  const onFollow = useCallback((on: boolean) => setUi((u) => (u.follow === on ? u : { ...u, follow: on, sel: on ? null : u.sel })), []);
  const onPill = useCallback((key: string) => setUi((u) => ({ ...u, edgePop: u.edgePop === key ? null : key })), []);

  const refreshRun = () => {
    qc.invalidateQueries({ queryKey: runKeyOf(runId), exact: true });
    qc.invalidateQueries({ queryKey: RUNS_KEY, exact: true });
  };

  const startM = useMutation({
    mutationFn: (body: Record<string, string>) => post<{ runId: string }>("/api/dagent/runs", body),
    onSuccess: ({ runId: started }) => {
      setRefusedGates(null);
      reset();
      // Fetch the new run's view alongside the list, so the screen does not wait for the list before it can ask for the run.
      void qc.prefetchQuery({ queryKey: runKeyOf(started), queryFn: () => readJson<RunView>(`/api/dagent/runs/${started}`), staleTime: 0 });
      qc.invalidateQueries({ queryKey: RUNS_KEY, exact: true });
    },
    onError: (e: Error & { body?: { gates?: GateResult[] } }) => {
      if (e.body?.gates?.length) {
        reset();
        setRefusedGates(e.body.gates);
      }
      showToast(e.message, "error");
    },
  });

  // A fix-qa run has no node to restart from: retrying it analyses the ticket's QC follow-up case again.
  const qaRetryM = useMutation({
    mutationFn: (runId: string) => readJson<unknown>("/api/my-sprint/plan", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analyzeQaRun: runId }) }),
    onSuccess: () => {
      reset();
      qc.invalidateQueries({ queryKey: RUNS_KEY, exact: true });
    },
    onError: (e: Error) => showToast(e.message, "error"),
  });

  const actM = useMutation({
    mutationFn: ({ url, body }: { url: string; body?: unknown }) => post<unknown>(url, body),
    onSuccess: refreshRun,
    onError: (e: Error) => showToast(e.message, "error"),
  });

  const draftedQuestions = (): string[] => {
    for (const s of run?.steps ?? []) if (s.output?.node === "readiness" && s.output.questions.length) return s.output.questions;
    return [];
  };

  const copyQuestions = async (questions?: string[]) => {
    const list = questions ?? draftedQuestions();
    const ok = await copyText(list.map((x, i) => `${i + 1}. ${x}`).join("\n"));
    if (ok) {
      patch({ copied: true });
      showToast("Questions copied — paste them to the PO.");
    } else showToast("Could not reach the clipboard. Copy the questions by hand.", "warning");
  };

  const onBanner = (a: BannerAction) => {
    if (a.kind === "copy-questions") void copyQuestions();
    else if (a.kind === "open-node" && a.nodeId) {
      pick(a.nodeId);
      patch({ sheet: "full" });
    } else patch({ tab: "run", sheet: "full", mode: "flow" });
  };

  const onStageAction = (s: LifecycleStage) => {
    if (s.action === "Fix it") patch({ fixOpen: true });
    else if (s.action === "Copy questions") void copyQuestions();
    else if (s.action?.startsWith("Retry")) patch({ tab: "run", sheet: "full" });
    else patch({ tab: "node", sel: null });
  };

  const onRetry = () => {
    if (!latest) return;
    const from = ui.retryFrom ?? advice?.defaultId;
    if (!real) return;
    const start = { ticketId: real.ticket.id, ticketUrl: real.ticket.url, project: real.ticket.project, rootRepo: real.ticket.rootRepo, provider: real.ticket.provider };
    if (from === FRESH_START) {
      startM.mutate(start);
      return;
    }
    if (!from) {
      if (run?.flow === "fix-qa") qaRetryM.mutate(real.run.id);
      else showToast("This run cannot be retried from a step — start it again from its ticket.", "warning");
      return;
    }
    startM.mutate({ ...start, retryOf: real.run.id, from });
  };

  const onCancel = () => {
    if (runId) actM.mutate({ url: `/api/dagent/runs/${runId}/cancel` });
  };

  const refused = gates.find((g) => g.status === "refused");
  const ticket = {
    id: real?.ticket.id ?? ticketParam ?? "…",
    title: real?.ticket.title || runs.find((r) => r.ticketId === real?.ticket.id && r.title)?.title || (refusedGates ? "Refused before a run existed" : "Loading run…"),
    meta: real?.ticket.project ?? "",
    url: real?.ticket.url ?? "",
  };
  const waiting = run?.state === "waiting" ? run.waitReason : undefined;
  const empty = !runId;

  return (
    <div style={{ position: "relative", height: "var(--te-app-h)", overflow: "hidden", display: "flex", flexDirection: "column", color: COLORS.text, ["--accent" as string]: COLORS.accent }}>
      <header className="te-page-header" style={{ position: "relative", zIndex: 30, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "14px", padding: "0 28px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "var(--te-header-bg)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <PageHeading title="Workflow" kicker="D-AGENT · LIVE RUN" icon={<path d="M5 6a2 2 0 1 0 0 .01M19 6a2 2 0 1 0 0 .01M12 19a2 2 0 1 0 0 .01M7 6h10M6.5 7.5l4.5 10M17.5 7.5L13 17.5" />} />
        <div style={{ flex: 1 }} />
        <NotificationCenter />
        <ProviderBadge />
      </header>

      {waiting ? (
        <PageToolbar>
          {waiting === "needs-input" ? (
            <button type="button" className="te-action-btn" disabled={actM.isPending} onClick={() => actM.mutate({ url: `/api/dagent/runs/${runId}/resume`, body: { action: "recheck-readiness" } })} style={ctaButtonStyle("ghost")}>
              Re-check readiness
            </button>
          ) : null}
          {waiting === "needs-review" ? (
            <button type="button" className="te-action-btn" disabled={actM.isPending} onClick={() => actM.mutate({ url: `/api/dagent/runs/${runId}/resume`, body: { action: "accept" } })} style={ctaButtonStyle("ghost")}>
              {curId === "implement" ? "Accept — no change" : "Accept PRs"}
            </button>
          ) : null}
        </PageToolbar>
      ) : null}

      {mobile === null || runsQ.isPending || (runId && viewQ.isPending) ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LoadingRing size={120} />
        </div>
      ) : runsQ.error || (runId && viewQ.error) ? (
        <div style={{ ...tintedCard("danger"), margin: 16, fontSize: FONT.base }}>{(runsQ.error ?? viewQ.error)?.message}</div>
      ) : empty ? (
        <div style={{ ...card(), margin: 16, fontSize: FONT.base, color: COLORS.textMuted }}>
          {ticketParam ? `${ticketParam} has no D-Agent run yet.` : "No D-Agent run yet."} Switch Flow Runner to the D-Agent engine and its runs show up here live.
        </div>
      ) : (
        <div className="te-wf" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative", zIndex: 1, background: COLORS.panelBgDark }}>
          <div style={{ position: "relative", zIndex: 5, flex: "0 0 auto", height: 48, display: "flex", alignItems: "center", gap: 10, padding: "0 16px", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.panelBg }}>
            {ticket.url ? (
              <a href={ticket.url} target="_blank" rel="noreferrer" title="Open the ticket in the tracker" style={{ ...chipShape(6), flex: "0 0 auto", padding: "4px 7px", fontSize: FONT.xs, fontWeight: 500, fontFamily: MONO, background: "var(--te-indigo-soft)", color: COLORS.indigo, textDecoration: "none" }}>{ticket.id} ↗</a>
            ) : (
              <span style={{ ...chipShape(6), flex: "0 0 auto", padding: "4px 7px", fontSize: FONT.xs, fontWeight: 500, fontFamily: MONO, background: "var(--te-indigo-soft)", color: COLORS.indigo }}>{ticket.id}</span>
            )}
            <span style={{ flex: "0 1 auto", minWidth: 0, fontSize: FONT.lg, fontWeight: 700, color: COLORS.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ticket.title}</span>
            {ticket.meta ? <span className="te-mobile-hide" style={{ flex: "0 0 auto", fontSize: FONT.sm, fontWeight: 600, color: COLORS.textSoft, whiteSpace: "nowrap" }}>· {ticket.meta}</span> : null}
            {planQ.data ? <PlanRowChip plan={planQ.data} /> : null}
            <RunPicker runs={runs} currentId={runId} onPick={pickRun} />
          </div>

          <TicketLifecycle
            stages={lifecycle}
            runKey={runId}
            open={ui.lcOpen}
            onToggle={() => patch({ lcOpen: !ui.lcOpen })}
            mobileOpen={ui.mLcOpen}
            onMobileToggle={() => patch({ mLcOpen: !ui.mLcOpen })}
            onOpenRun={() => undefined}
            onAction={onStageAction}
          />

          {refused ? (
            <RefusalCard
              gate={refused}
              open={ui.fixOpen}
              onToggle={() => patch({ fixOpen: !ui.fixOpen })}
              onRecheck={onRetry}
            />
          ) : null}

          <WorkflowHud
            hud={hud}
            mode={ui.mode}
            onMode={(m) => patch({ mode: m })}
            canCancel={latest && !!run && (live || run.state === "waiting")}
            canRetry={latest && run?.state === "failed"}
            onCancel={onCancel}
            onRetry={onRetry}
            mobileOpen={ui.hudOpen}
            onMobileToggle={() => patch({ hudOpen: !ui.hudOpen })}
          />

          {banner ? <StateBanner banner={latest || banner.action?.kind !== "open-run" ? banner : { ...banner, action: undefined }} copied={ui.copied} onAction={onBanner} /> : null}

          <div className="te-wf-body" data-sheet={ui.sheet} style={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}>
            <div className="te-wf-canvas" style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden" }}>
              {ui.mode === "flow" ? (
                <div style={{ position: "absolute", inset: 0 }}>
                  <WorkflowCanvas
                    layout={layout}
                    nodeViews={nodeViews}
                    edgeViews={edges}
                    laneViews={lanes}
                    selectedId={selected.id}
                    focusId={curId}
                    follow={ui.follow}
                    vertical={vertical}
                    live={!!liveish}
                    layoutKey={`${runId}|${vertical}`}
                    edgePop={ui.edgePop}
                    allPaths={ui.allPaths}
                    steps={steps}
                    onPick={pick}
                    onFollow={onFollow}
                    onPill={onPill}
                    onAllPaths={() => setUi((u) => ({ ...u, allPaths: !u.allPaths }))}
                    onClosePop={() => patch({ edgePop: null })}
                  />
                </div>
              ) : null}
              {ui.mode === "timeline" ? <TimelineView timeline={timeline} selectedId={selected.id} onPick={(id) => setUi((u) => ({ ...u, sel: id, mode: "flow", follow: false, tab: "node" }))} /> : null}
              {ui.mode === "log" ? <RawLog lines={allLogs} live={live} withTime={!!run} /> : null}
            </div>

            <NodeInspector
              tab={tab}
              onTab={(t) => setUi((u) => ({ ...u, tab: t, sheet: u.sheet === "closed" ? "peek" : u.sheet }))}
              inspector={inspector}
              runSections={runSecs}
              runTop={
                <>
                  {planQ.data ? <PlanRowCard plan={planQ.data} /> : null}
                  {prevId && !prevQ.isError ? (
                    <PreviousRun
                      prevId={prevId}
                      diff={diff}
                      onOpen={() => {
                        setPickedTicket(null);
                        setPickedRun(null);
                        reset();
                      }}
                    />
                  ) : null}
                </>
              }
              sheet={ui.sheet}
              onToggleSheet={() => patch({ sheet: ui.sheet === "full" ? "peek" : "full" })}
              following={ui.follow && !!liveish}
              onAttempt={(i) => patch({ attempt: i })}
              json={ui.json}
              onJson={() => patch({ json: !ui.json })}
              logs={nodeLogs}
              logFilter={ui.logFilter}
              onLogFilter={(f) => patch({ logFilter: f })}
              query={ui.query}
              onQuery={(v) => patch({ query: v })}
              copied={ui.copied}
              onCopy={(qs) => void copyQuestions(qs)}
              retryFrom={ui.retryFrom}
              onRetryPick={(id) => patch({ retryFrom: id })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
