"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { COLORS, FONT, chipShape, ctaButtonStyle, tintedCard } from "@/lib/ui";
import { layoutRun } from "@/lib/workflow/layout";
import { STAGES, STATUS } from "@/lib/workflow/meta";
import { DEFAULT_DEFS, SCENARIO_KEYS, buildScenarios } from "@/lib/workflow/mock";
import {
  bannerOf,
  edgeViews,
  hudOf,
  inspectNode,
  laneViews,
  logLinesOf,
  nodeView,
  oneLine,
  runSections,
  timelineOf,
  type BannerAction,
} from "@/lib/workflow/present";
import type { GateResult, LifecycleStage } from "@/lib/workflow/types";
import type { RunListItem, RunView } from "@/lib/dagent/view";
import PageHeading from "../../(app)/PageHeading";
import NotificationCenter from "../../(app)/NotificationCenter";
import ProviderBadge from "../../(app)/ProviderBadge";
import PageToolbar from "../../(app)/PageToolbar";
import { useResolvedIsMobile } from "../../(app)/MobileNav";
import { useToast } from "../../(app)/ToastProvider";
import { copyText } from "../../(app)/report/copyText";
import SelectMenu from "../../SelectMenu";
import { useLiveInvalidate } from "../../useLive";
import LoadingRing from "../LoadingRing";
import { useNow } from "../execution/useNow";
import { RefusalCard, StateBanner, WorkflowHud, type WorkflowMode } from "./Chrome";
import NodeInspector, { type InspectorTab, type LogFilter, type SheetState } from "./NodeInspector";
import { MONO } from "./parts";
import StartRunPanel, { type StartForm } from "./StartRunPanel";
import TicketLifecycle from "./TicketLifecycle";
import { RawLog, TimelineView } from "./Views";
import WorkflowCanvas from "./WorkflowCanvas";

type Ui = {
  scenario: string;
  runKey: string | null;
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
  cancelled: boolean;
  retryFrom: string | null;
  retried: string | null;
  copied: boolean;
  fixOpen: boolean;
  lcOpen: boolean;
  hudOpen: boolean;
  mLcOpen: boolean;
};

const INITIAL: Ui = {
  scenario: "C",
  runKey: null,
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
  cancelled: false,
  retryFrom: null,
  retried: null,
  copied: false,
  fixOpen: false,
  lcOpen: true,
  hudOpen: false,
  mLcOpen: false,
};

type RunsPayload = { runs: RunListItem[]; defaults: { rootRepo: string; project: string; provider: string } };

const RUNS_KEY = ["dagent", "runs"] as const;
const runKeyOf = (id: string | null) => ["dagent", "run", id] as const;

const DEMO = "Demo scenarios";

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d?.error || `${url} failed (${r.status})`), { body: d });
  return d as T;
}

const post = <T,>(url: string, body: unknown = {}) =>
  readJson<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const EMPTY_LIFECYCLE: LifecycleStage[] = STAGES.map(([id, label]) => ({ id, label, status: "todo", at: "", detail: "", runs: [] }));

const EMPTY_FORM: StartForm = { ticketId: "", ticketUrl: "", project: "", rootRepo: "", provider: "" };

export default function WorkflowView() {
  const mobile = useResolvedIsMobile();
  const showToast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const runId = params.get("run");
  const [scenarios] = useState(() => buildScenarios(Date.now()));
  const [ui, setUi] = useState<Ui>(INITIAL);
  const [startOpen, setStartOpen] = useState(false);
  const [form, setForm] = useState<StartForm | null>(null);
  const [refusedGates, setRefusedGates] = useState<GateResult[] | null>(null);
  const now = useNow(true);

  const patch = useCallback((p: Partial<Ui>) => setUi((u) => ({ ...u, ...p })), []);
  const reset = useCallback((p?: Partial<Ui>) => setUi((u) => ({ ...INITIAL, lcOpen: u.lcOpen, ...p })), []);

  const runsQ = useQuery({ queryKey: RUNS_KEY, queryFn: () => readJson<RunsPayload>("/api/dagent/runs"), staleTime: 0 });
  useLiveInvalidate("/api/dagent/runs/stream", RUNS_KEY);
  const viewQ = useQuery({ queryKey: runKeyOf(runId), queryFn: () => readJson<RunView>(`/api/dagent/runs/${runId}`), enabled: !!runId, staleTime: 0 });
  useLiveInvalidate(runId ? `/api/dagent/runs/${runId}/stream` : null, runKeyOf(runId));

  const real = runId ? (viewQ.data ?? null) : null;
  const demo = !runId && !refusedGates;
  const sc = scenarios[ui.scenario];
  const runKey = ui.runKey ?? sc.runKey;
  const baseRun = useMemo(() => {
    if (demo) return runKey && sc.runs[runKey] ? sc.runs[runKey]() : null;
    return real?.run ?? null;
  }, [demo, sc, runKey, real]);
  const run = useMemo(() => (demo && baseRun && ui.cancelled ? { ...baseRun, state: "cancelled" as const, waitReason: undefined } : baseRun), [demo, baseRun, ui.cancelled]);
  const gates = demo ? sc.gates : (refusedGates ?? real?.gates ?? []);
  const lifecycle = demo ? sc.lifecycle : (real?.lifecycle ?? EMPTY_LIFECYCLE);
  const vertical = mobile === true;

  const layout = useMemo(
    () => layoutRun(baseRun?.defs ?? DEFAULT_DEFS, vertical ? "TB" : "LR", baseRun ? baseRun.transitions.map((t): [string, string] => [t.fromNode, t.toNode]) : []),
    [baseRun, vertical],
  );

  const live = !!run && (run.state === "running" || run.state === "preparing");
  const liveish = live || run?.state === "waiting";
  const curId = run?.currentNodeId ?? "admission";
  const selected = layout.nodes.find((n) => n.id === (ui.sel ?? curId)) ?? layout.nodes.find((n) => n.id === curId) ?? layout.nodes[0];
  const tab: InspectorTab = ui.tab ?? (run && (run.state === "failed" || run.state === "succeeded") && !ui.sel ? "run" : "node");

  const nodeViews = useMemo(() => layout.nodes.map((n) => nodeView(run, gates, n, now)), [run, gates, layout, now]);
  const edges = useMemo(() => edgeViews(run, layout), [run, layout]);
  const lanes = useMemo(() => laneViews(run, gates, layout, now), [run, gates, layout, now]);
  const hud = useMemo(() => hudOf(run, now), [run, now]);
  const banner = useMemo(() => bannerOf(run, now, ui.retried), [run, now, ui.retried]);
  const timeline = useMemo(() => timelineOf(run, now), [run, now]);
  const allLogs = useMemo(() => logLinesOf(run, now, gates), [run, now, gates]);
  const inspector = useMemo(() => inspectNode(run, gates, selected, ui.attempt, now), [run, gates, selected, ui.attempt, now]);
  const runSecs = useMemo(() => runSections(run, gates, now), [run, gates, now]);

  const q = ui.query.toLowerCase();
  const attemptNo = inspector.attempts[inspector.attemptIndex]?.n;
  const nodeLogs = allLogs.filter((l) => l.node === selected.id && (attemptNo === undefined || l.attempt === attemptNo) && (ui.logFilter === "all" || l.lvl === ui.logFilter) && (!q || l.text.toLowerCase().includes(q)));

  const steps = run
    ? run.steps.map((s, i) => `${i + 1}. ${run.defs.find((d) => d.id === s.nodeId)?.label ?? s.nodeId} attempt ${s.attempt}: ${STATUS[s.status].text}${s.output ? `, ${oneLine(s.output)}` : ""}`)
    : [`No run yet. Admission refused: ${gates.find((g) => g.status === "refused")?.reason ?? ""}`];

  const pick = useCallback((id: string) => setUi((u) => ({ ...u, sel: id, follow: false, attempt: null, tab: "node", edgePop: null, sheet: u.sheet === "closed" ? "peek" : u.sheet })), []);
  const onFollow = useCallback((on: boolean) => setUi((u) => (u.follow === on ? u : { ...u, follow: on, sel: on ? null : u.sel })), []);
  const onPill = useCallback((key: string) => setUi((u) => ({ ...u, edgePop: u.edgePop === key ? null : key })), []);

  const openRun = useCallback(
    (id: string | null) => {
      setRefusedGates(null);
      reset();
      router.replace(id ? `/workflow?run=${id}` : "/workflow");
    },
    [reset, router],
  );

  const refreshRun = () => {
    qc.invalidateQueries({ queryKey: runKeyOf(runId), exact: true });
    qc.invalidateQueries({ queryKey: RUNS_KEY, exact: true });
  };

  const startM = useMutation({
    mutationFn: (body: Record<string, string>) => post<{ runId: string }>("/api/dagent/runs", body),
    onSuccess: (d) => {
      setStartOpen(false);
      qc.invalidateQueries({ queryKey: RUNS_KEY, exact: true });
      openRun(d.runId);
    },
    onError: (e: Error & { body?: { gates?: GateResult[] } }) => {
      if (e.body?.gates?.length) {
        reset();
        setRefusedGates(e.body.gates);
        router.replace("/workflow");
      }
      showToast(e.message, "error");
    },
  });

  const actM = useMutation({
    mutationFn: ({ url, body }: { url: string; body?: unknown }) => post<unknown>(url, body),
    onSuccess: refreshRun,
    onError: (e: Error) => showToast(e.message, "error"),
  });

  const formValue = form ?? { ...EMPTY_FORM, ...(runsQ.data?.defaults ?? {}) };
  const submitStart = () => startM.mutate({ ...formValue });

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

  const onRetry = (label: string) => {
    if (demo) {
      patch({ retried: label });
      showToast(`Retry queued from ${label}.`);
      return;
    }
    const from = ui.retryFrom ?? run?.failure?.retryableFrom[0];
    if (!real || !from) return;
    startM.mutate({ ticketId: real.ticket.id, ticketUrl: real.ticket.url, project: real.ticket.project, rootRepo: real.ticket.rootRepo, provider: real.ticket.provider, retryOf: real.run.id, from });
  };

  const onCancel = () => {
    if (demo) patch({ cancelled: true });
    else if (runId) actM.mutate({ url: `/api/dagent/runs/${runId}/cancel` });
  };

  const refused = gates.find((g) => g.status === "refused");
  const scenarioOptions = SCENARIO_KEYS.map((k) => `${k} · ${scenarios[k].label}`);
  const runs = runsQ.data?.runs ?? [];
  const runLabel = (r: RunListItem) => `${r.ticketId}${r.title ? ` · ${r.title}` : ""} · ${r.state}`;
  const sourceOptions = [DEMO, ...runs.map(runLabel)];
  const current = runs.find((r) => r.id === runId);
  const sourceValue = current ? runLabel(current) : runId ? `Run ${runId.slice(0, 8)}` : DEMO;
  const ticket = demo
    ? { id: "AB#4182", title: "Export invoices as CSV with ledger filters", meta: "Azure DevOps · billing" }
    : { id: real?.ticket.id ?? (refusedGates ? formValue.ticketId : "…"), title: real?.ticket.title || (refusedGates ? "Refused before a run existed" : "Loading run…"), meta: real ? `${real.ticket.provider} · ${real.ticket.project}` : "" };
  const waiting = !demo && run?.state === "waiting" ? run.waitReason : undefined;

  return (
    <div style={{ position: "relative", height: "var(--te-app-h)", overflow: "hidden", display: "flex", flexDirection: "column", color: COLORS.text, ["--accent" as string]: COLORS.accent }}>
      <header className="te-page-header" style={{ position: "relative", zIndex: 30, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "14px", padding: "0 28px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "var(--te-header-bg)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <PageHeading title="Workflow" kicker="D-AGENT · LIVE RUN" icon={<path d="M5 6a2 2 0 1 0 0 .01M19 6a2 2 0 1 0 0 .01M12 19a2 2 0 1 0 0 .01M7 6h10M6.5 7.5l4.5 10M17.5 7.5L13 17.5" />} />
        <div style={{ flex: 1 }} />
        <NotificationCenter />
        <ProviderBadge />
      </header>

      <PageToolbar>
        <span style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>Run</span>
        <SelectMenu
          variant="filter"
          alwaysGlow
          value={sourceValue}
          onChange={(v) => {
            if (!v || v === sourceValue) return;
            const idx = sourceOptions.indexOf(v);
            openRun(idx > 0 ? runs[idx - 1].id : null);
          }}
          options={sourceOptions}
          ariaLabel="Run"
        />
        {demo ? (
          <SelectMenu
            variant="filter"
            value={scenarioOptions[SCENARIO_KEYS.indexOf(ui.scenario as (typeof SCENARIO_KEYS)[number])]}
            onChange={(v) => v && reset({ scenario: v.slice(0, 1) })}
            options={scenarioOptions}
            ariaLabel="Demo scenario"
          />
        ) : null}
        {waiting === "needs-input" ? (
          <button type="button" className="te-action-btn" disabled={actM.isPending} onClick={() => actM.mutate({ url: `/api/dagent/runs/${runId}/resume`, body: { action: "recheck-readiness" } })} style={ctaButtonStyle("ghost")}>
            Re-check readiness
          </button>
        ) : null}
        {waiting === "needs-review" ? (
          <button type="button" className="te-action-btn" disabled={actM.isPending} onClick={() => actM.mutate({ url: `/api/dagent/runs/${runId}/resume`, body: { action: "accept" } })} style={ctaButtonStyle("ghost")}>
            Accept PRs
          </button>
        ) : null}
        <button type="button" className="te-action-btn" onClick={() => setStartOpen((o) => !o)} style={ctaButtonStyle(startOpen ? "outline" : "primary")}>
          New run
        </button>
      </PageToolbar>

      {startOpen ? <StartRunPanel form={formValue} busy={startM.isPending} onChange={(p) => setForm({ ...formValue, ...p })} onSubmit={submitStart} onClose={() => setStartOpen(false)} /> : null}

      {mobile === null || (runId && viewQ.isPending) ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LoadingRing size={28} />
        </div>
      ) : runId && viewQ.error ? (
        <div style={{ ...tintedCard("danger"), margin: 16, fontSize: FONT.base }}>{viewQ.error.message}</div>
      ) : (
        <div className="te-wf" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative", zIndex: 1, background: COLORS.panelBgDark }}>
          <div style={{ flex: "0 0 auto", height: 48, display: "flex", alignItems: "center", gap: 10, padding: "0 16px", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.panelBg }}>
            <span style={{ ...chipShape(6), flex: "0 0 auto", padding: "4px 7px", fontSize: FONT.xs, fontWeight: 500, fontFamily: MONO, background: "var(--te-indigo-soft)", color: COLORS.indigo }}>{ticket.id}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: FONT.base, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ticket.title}</span>
            <span className="te-mobile-hide" style={{ flex: "0 0 auto", fontSize: FONT.sm, color: COLORS.textMuted }}>{ticket.meta}</span>
          </div>

          <TicketLifecycle
            stages={lifecycle}
            runKey={demo ? runKey : "implement"}
            open={ui.lcOpen}
            onToggle={() => patch({ lcOpen: !ui.lcOpen })}
            mobileOpen={ui.mLcOpen}
            onMobileToggle={() => patch({ mLcOpen: !ui.mLcOpen })}
            onOpenRun={(key) => (demo ? reset({ scenario: ui.scenario, runKey: key }) : undefined)}
            onAction={onStageAction}
          />

          {refused ? (
            <RefusalCard
              gate={refused}
              open={ui.fixOpen}
              onToggle={() => patch({ fixOpen: !ui.fixOpen })}
              onRecheck={() => (demo ? showToast("Gates re-checked — admission still refuses.", "warning") : submitStart())}
            />
          ) : null}

          <WorkflowHud
            hud={hud}
            mode={ui.mode}
            onMode={(m) => patch({ mode: m })}
            canCancel={!!run && (live || run.state === "waiting")}
            canRetry={run?.state === "failed"}
            onCancel={onCancel}
            onRetry={() => patch({ tab: "run", sheet: "full", mode: "flow" })}
            mobileOpen={ui.hudOpen}
            onMobileToggle={() => patch({ hudOpen: !ui.hudOpen })}
          />

          {banner ? <StateBanner banner={banner} copied={ui.copied} onAction={onBanner} /> : null}

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
                    layoutKey={`${demo ? ui.scenario : runId}|${runKey}|${vertical}`}
                    edgePop={ui.edgePop}
                    steps={steps}
                    onPick={pick}
                    onFollow={onFollow}
                    onPill={onPill}
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
              onRetry={onRetry}
            />
          </div>
        </div>
      )}
    </div>
  );
}
