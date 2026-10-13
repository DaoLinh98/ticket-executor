"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CSSProperties, MouseEvent } from "react";
import { motion } from "motion/react";
import { useBoltsContext } from "./BoltsContext";
import { type IterationOption } from "./SprintPicker";
import AppHeader from "./ticket-executor/AppHeader";
import CommitFilesModal from "./ticket-executor/CommitFilesModal";
import DiffModal from "./ticket-executor/DiffModal";
import LoadingRing from "./ticket-executor/LoadingRing";
import TicketDetailHeader from "./ticket-executor/TicketDetailHeader";
import TicketSidebar from "./ticket-executor/TicketSidebar";
import { useToast } from "./(app)/ToastProvider";
import { htmlToPlainText } from "@/lib/richText";
import AskTab from "./ticket-executor/tabs/AskTab";
import CommitsTab from "./ticket-executor/tabs/CommitsTab";
import ExecutionTab from "./ticket-executor/tabs/ExecutionTab";
import OverviewTab from "./ticket-executor/tabs/OverviewTab";
import PlanTab from "./ticket-executor/tabs/PlanTab";
import ResolveReviewTab from "./ticket-executor/tabs/ResolveReviewTab";
import ResultTab from "./ticket-executor/tabs/ResultTab";
import {
  ACCENT, DEFAULT_SKILL, FIX_REVIEW_SKILL, RESULT_SKILL_ORDER, RESULT_SKILL_TITLE, SKILL_OPTIONS,
} from "./ticket-executor/constants";
import type { AskView } from "@/lib/ask";
import type { RunEventSource } from "@/lib/notifications";
import { useNotifications } from "./(app)/NotificationsProvider";
import { CONNECTION_CHANGED_EVENT } from "./connectionEvents";
import { usePagePrefs } from "./pagePrefs";
import type {
  Action, ExecView, NodeView, OverrideField, ResultSection, RunSummary, SettingsView, StepView, TabId,
} from "./ticket-executor/types";
import type { CommitFile, CommitSummary, FileChange, KnowledgeChange, LogLine, MentionCandidate, ReactionKind, RunState, Ticket, TicketComment, ReviewData, ReviewSummaryEntry, UiRunState } from "@/lib/types";
import { providerMeta, type ProviderId } from "@/lib/providers";
import { useQueryClient } from "@tanstack/react-query";
import { useLive } from "./useLive";
import { SETTINGS_KEY, fetchSettings } from "./queries";
import { SCOPE_LABEL, TICKET_SCOPES, type TicketScope } from "@/lib/ticketScope";
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL, DEFAULT_CLAUDE_EFFORT, resolveModelId, type ClaudeModel } from "@/lib/claudeOptions";
import { FONT, MOTION, RUN_COLOR, actionInfoFor, branchOf, ctaButtonStyle, isFixReviewSkill, isReviewable, pill, tabStyle as uiTabStyle } from "@/lib/ui";

const LIST_REVALIDATE_MS = 60_000;

// Container for the whole app: owns all state (tickets, executions, settings,
// reviews) and the polling/SSE plumbing, and composes the presentational pieces
// in ./ticket-executor/*.

// How often the board-scoped review poll re-asks. Minutes rather than seconds:
// it costs one provider round-trip per candidate ticket, and a reviewer's
// comment is not a real-time event. The moments the answer genuinely changes —
// a run publishing a PR, a fix-review run finishing — call
// refreshNotifications() directly instead of waiting for the tick.
const NOTIFY_POLL_MS = 120_000;

// A hard floor between two polls, whatever asked for them. The interval above is
// the schedule; this is the guard, because an interval owned by an effect is
// only as stable as that effect's dependencies — and the cost of getting those
// wrong is paid at the provider, one round-trip per ticket.
const NOTIFY_MIN_GAP_MS = 20_000;

// The tabs a notification is allowed to land on — the same set
// `NotificationTab` names, validated here because it arrives as a URL string.
const ROUTE_TABS: TabId[] = ["overview", "plan", "execution", "result", "resolve-review"];

// Observed run outcomes are session state with nothing to expire them, and a tab
// left open for a day of batch runs would accumulate every one. The oldest are
// also the least worth showing.
const RUN_EVENT_CAP = 50;

// The two answers the plan filter offers. Full sentences rather than "Planned" /
// "Unplanned" because the filter row shows the chosen value on its own, and
// "Unplanned" alone reads as a property of the ticket rather than of this
// sprint's plan.
const PLANNED_YES = "In the sprint plan";
const PLANNED_NO = "Not in the plan";
const PLANNED_OPTIONS = [PLANNED_YES, PLANNED_NO];

// One place that turns the API's RunView into the UI's ExecView. This used to be
// written out three times (open a past run / stream update / rehydrate), which is
// how the three drifted apart.
function toExecView(run: Record<string, unknown>, prev?: ExecView, skillHint?: string): ExecView {
  return {
    runId: run.id as string,
    state: run.state as RunState,
    skill: (run.skill as string) || prev?.skill || skillHint,
    graphId: run.graphId as string | undefined,
    currentNodeId: run.currentNodeId as string | undefined,
    nodes: (run.nodes as ExecView["nodes"]) ?? [],
    endReason: run.endReason as string | undefined,
    logLines: (run.logLines as LogLine[]) ?? [],
    resultText: (run.resultText as string) ?? "",
    error: (run.errorMessage as string) ?? "",
    prUrl: (run.prUrl as string) ?? "",
    branch: (run.branch as string) ?? "",
    duration: run.duration as string | undefined,
    costUsd: run.costUsd as number | undefined,
    inputTokens: run.inputTokens as number | undefined,
    outputTokens: run.outputTokens as number | undefined,
    planMarkdown: (run.planMarkdown as string) || prev?.planMarkdown,
    filesChanged: (run.filesChanged as FileChange[]) ?? [],
    knowledgeChange: (run.knowledgeChange as KnowledgeChange | null) ?? null,
    channels: (run.channels as ExecView["channels"]) ?? {},
  };
}

// `waiting` is two different situations, and only one of them is asking the
// developer for anything. A run held after the server restarted mid-publish
// wants a person to check whether the push landed; a run parked on the Claude
// account's usage limit wants nothing at all and continues by itself. Told apart
// by `endReason`, which the harness already owns.
const isRateLimited = (e?: ExecView) => e?.state === "waiting" && e.endReason === "rate-limited";
const isAwaitingReview = (e?: ExecView) => e?.state === "waiting" && e.endReason !== "rate-limited";

/**
 * A picked sprint *name* as the value a ticket load should actually send.
 *
 * The picker shows names, but Azure DevOps' `System.IterationPath` is a rooted
 * path (`RIS\Sprint 61`), and a query built from the bare name is not a query
 * that matches nothing — ADO rejects it outright with a 400. Use the path when
 * a provider hands one out alongside the name.
 *
 * Falls back to the name, which is correct for the direct Azure DevOps client:
 * it has no paths and resolves the override by name against the team's
 * iterations before ever building a query.
 */
function iterationPathFor(options: IterationOption[], name: string): string {
  return options.find((o) => o.name === name)?.path || name;
}

export default function TicketExecutor() {
  const queryClient = useQueryClient();
  const readJson = useCallback(
    (key: readonly unknown[], url: string, staleTime = 0) =>
      queryClient.fetchQuery({ queryKey: key, queryFn: () => fetch(url).then((r) => r.json()), staleTime }),
    [queryClient]
  );
  // Which project, sprint and view this organization was last looking at.
  // Restored before the first provider call so the screen opens on the work in
  // progress instead of the first project's current iteration.
  const { prefs, ready: prefsReady, save: savePrefs } = usePagePrefs<{
    project: string;
    sprint: string;
    scope: string;
    ticket: string;
  }>("ticket-execution", { project: "", sprint: "", scope: "sprint", ticket: "" });
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [orgEpoch, setOrgEpoch] = useState(0);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  // Tickets the bell sent the developer to that this board does not contain —
  // released work, or a ticket in another project. Held here as well as in
  // `tickets` so a board reload keeps showing the ticket being looked at
  // instead of dropping it back to the first row of the list.
  const offBoardRef = useRef<Map<string, Ticket>>(new Map());
  const [loadError, setLoadError] = useState<string>("");
  const [ticketsNotice, setTicketsNotice] = useState<string>("");
  const [sprintLabel, setSprintLabel] = useState<string>("");
  const [sprintOptions, setSprintOptions] = useState<IterationOption[]>([]);
  const [selectedSprint, setSelectedSprint] = useState<string>("");
  // The one iteration the provider says the team is actually on — the same
  // answer WIQL's `@currentIteration` gives. Tracked separately from each
  // option's `timeFrame`, which is date-derived and says "current" for every
  // sprint spanning today: a project with per-team iteration sub-trees has
  // several, and badging them all claims the app is on sprints it is not.
  const [currentSprint, setCurrentSprint] = useState<string>("");
  // Which view of the project's work the screen is on: the sprint, the
  // unscheduled backlog, or the board. Not a filter over one list — each is a
  // different query at the provider (lib/ticketScope.ts), so switching it
  // reloads rather than re-filtering.
  const [scope, setScope] = useState<TicketScope>("sprint");
  // Mirror of `scope` for the stable (empty-dep) `reloadTickets` callback, same
  // reason as `selectedIdRef` below.
  const scopeRef = useRef<TicketScope>(scope);
  scopeRef.current = scope;
  // Same, for turning a picked sprint *name* into the provider's rooted
  // iteration path before a ticket load sends it — see `iterationPathFor`.
  const sprintOptionsRef = useRef<IterationOption[]>(sprintOptions);
  sprintOptionsRef.current = sprintOptions;
  // Connection-level project selector (org-scoped). Distinct from the per-ticket
  // "area" override on the Overview tab (getArea/onProjectChange) — this drives
  // which project's tickets + sprints the whole screen loads.
  const [projectList, setProjectList] = useState<{ id: string; name: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");
  // Which of the two panes the phone is showing. Below the breakpoint the rail
  // and the detail cannot both be on screen (globals.css hides one on this
  // attribute), so picking a ticket has to also mean "go to it", and the
  // detail header grows a Back control. Above the breakpoint nothing reads it —
  // the state is kept rather than gated on a media query so the desktop render
  // is unchanged and there is no hydration-time viewport guess.
  const [mobilePane, setMobilePane] = useState<"list" | "detail">("list");
  const [tab, setTab] = useState<TabId>("overview");
  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fType, setFType] = useState("");
  const [fAssignee, setFAssignee] = useState("");
  const [fPlanned, setFPlanned] = useState("");
  // Queue position per ticket id, for the tickets this sprint's plan carries.
  // Read-only here — Flow Runner owns the plan; this screen only needs to answer
  // "is this one already scheduled, and where in the order", so a ticket is not
  // picked up by hand while the scheduler is holding a slot for it.
  const [plannedOrder, setPlannedOrder] = useState<Record<string, number>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [statusMenuOptions, setStatusMenuOptions] = useState<string[]>([]);
  const [statusMenuLoading, setStatusMenuLoading] = useState(false);
  // The ad-hoc Claude session of whichever ticket is selected, plus its unsent
  // draft per ticket so switching tickets does not eat what was being typed.
  // Lives on the server (lib/ask.ts) — this is a view of it, not a copy.
  const [ask, setAsk] = useState<AskView | null>(null);
  const [askPrompts, setAskPrompts] = useState<Record<string, string>>({});
  const [execs, setExecs] = useState<Record<string, ExecView>>({});
  const [history, setHistory] = useState<Record<string, RunSummary[]>>({});
  const [diffFile, setDiffFile] = useState<FileChange | null>(null);
  const [comments, setComments] = useState<Record<string, TicketComment[]>>({});
  // In-flight discussion writes, so a button cannot be double-fired. Reactions
  // are keyed `<commentId>:<kind>`; posting is one composer at a time.
  const [reacting, setReacting] = useState<Record<string, boolean>>({});
  const [postingComment, setPostingComment] = useState(false);
  // The composer's text, per ticket. It lives here rather than in the tab so
  // switching tickets and coming back does not silently discard what was typed.
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentMentions, setCommentMentions] = useState<Record<string, MentionCandidate[]>>({});
  // Vietnamese translations of individual comments, keyed `<ticketId>:<index>`.
  // Held here rather than in OverviewTab because the container owns fetching,
  // and kept in memory rather than persisted: the source lives in the provider
  // and one Haiku turn is cheap to ask for again.
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translating, setTranslating] = useState<Record<string, boolean>>({});
  const [skillOptions, setSkillOptions] = useState<string[]>(SKILL_OPTIONS);
  const [modelOptions, setModelOptions] = useState<readonly ClaudeModel[]>(CLAUDE_MODELS);
  const [overrides, setOverrides] = useState<Record<string, Partial<Record<OverrideField, string>>>>({});
  const [savedOptions, setSavedOptions] = useState<Record<"rootRepo" | "project" | "skill", string[]>>({ rootRepo: [], project: [], skill: [] });
  const [settings, setSettings] = useState<SettingsView>({
    provider: "azure-devops",
    clickEffects: true,
    ringAnimation: true,
    org: "",
    pat: "",
    hasPat: false,
    animatedBackground: true,
    scope: "team",
    personalAccount: "",
    concurrentRuns: 2,
    multiTicketMode: true,
    manageMcp: true,
    hourlyRateUsd: 0,
    hoursPerStoryPoint: 6,
    gitUserName: "",
    gitUserEmail: "",
  });
  const [reviews, setReviews] = useState<Record<string, ReviewData>>({});
  // True while a ticket's Resolve Review data is being (re)fetched — lets the
  // tab distinguish "still loading" from "genuinely no PR yet".
  const [reviewsLoading, setReviewsLoading] = useState<Record<string, boolean>>({});
  const [commits, setCommits] = useState<Record<string, CommitSummary[]>>({});
  const [openCommit, setOpenCommit] = useState<CommitSummary | null>(null);
  const [commitFiles, setCommitFiles] = useState<CommitFile[] | null>(null);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummaryEntry[]>([]);
  // The last poll could not reach the provider. The bell keeps showing what it
  // last knew and says so, rather than rendering an outage as "all clear".
  const [reviewDegraded, setReviewDegraded] = useState(false);
  // Terminal run outcomes this session actually watched happen. Kept as observed
  // events rather than derived from `execs`, because a run that succeeded last
  // week is not news — see `fromRunEvents`.
  const [runEvents, setRunEvents] = useState<RunEventSource[]>([]);
  // skill → the node list its graph walks, so the progress timeline can be drawn
  // before a run exists. Fetched once; the graphs are static code on the server.
  const [graphOutlines, setGraphOutlines] = useState<Record<string, { id: string; label: string; effects: string }[]>>({});
  // Mirror of selectedId for use inside stable callbacks (SSE handlers) without
  // re-memoizing them on every selection change.
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const { fireBoltFromEvent } = useBoltsContext();
  // The bell itself lives in the shared shell. This screen is only the source
  // of the parts no other page can answer for: the board-scoped review poll,
  // the runs this session is watching, and the ticket titles it has loaded.
  const { setLocalSources, refresh: refreshShared } = useNotifications();
  const logRef = useRef<HTMLDivElement>(null);
  const askLogRef = useRef<HTMLDivElement>(null);
  const askSse = useRef<EventSource | null>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const sseConnections = useRef<Record<string, EventSource>>({});
  // Batch "Run selected" scheduler: tickets waiting for a free slot, and
  // tickets currently occupying one — capped by settings.concurrentRuns.
  const batchQueueRef = useRef<string[]>([]);
  const batchRunningRef = useRef<Set<string>>(new Set());
  const tryStartNextQueuedRef = useRef<() => void>(() => { });
  // Tickets whose description/criteria have already been asked for, so a failed
  // fetch is not retried on every reselect. Cleared whenever the list reloads —
  // those are new ticket objects, with the fields unloaded again.
  const detailFetchedRef = useRef<Set<string>>(new Set());

  const searchParams = useSearchParams();
  const ticketsRef = useRef(tickets);
  ticketsRef.current = tickets;
  // The query params, read through refs: the bell pushes `?ticket=&tab=` onto
  // this same route, and a workspace loader that depended on `searchParams`
  // would reload the whole screen — projects, sprints, tickets — every time a
  // notification was clicked.
  const urlProjectRef = useRef("");
  urlProjectRef.current = searchParams.get("project") ?? "";
  // The ticket the bell sent us to, while it is still being fetched. A board
  // load landing in that window must not reset the selection to its first row.
  const routeTicketRef = useRef("");
  const ticketLoadSeqRef = useRef(0);

  // ---- data load ----
  // Fetch the ticket list for a given provider/project (and optional sprint override) and refresh the header sprint.
  const reloadTickets = useCallback(async (provider: ProviderId, project?: string, sprint?: string, opts?: { notify?: boolean; scope?: TicketScope; preferTicket?: string; background?: boolean }): Promise<void> => {
    // The caller's scope wins over the ref: a switch calls this in the same tick
    // it sets the new scope, and reading state here would load the old view.
    // Everything else — mount, a project switch — means "the view I am on".
    const viewScope = opts?.scope ?? scopeRef.current;
    const seq = ++ticketLoadSeqRef.current;
    const isLatest = () => seq === ticketLoadSeqRef.current;
    let refreshStale = false;
    if (!opts?.background) {
      setLoading(true);
      setLoadError("");
      setTicketsNotice("");
    }
    try {
      const qs = new URLSearchParams({ provider, scope: viewScope });
      if (project) qs.set("project", project);
      // A sprint only bounds the sprint view; sending it with a backlog or a
      // board would be asking for two different lists at once. Sent as the
      // provider's iteration *path*, never the displayed name.
      if (sprint && viewScope === "sprint") qs.set("sprint", iterationPathFor(sprintOptionsRef.current, sprint));
      const r = await fetch(`/api/tickets?${qs.toString()}`);
      const data = await r.json();
      if (!isLatest()) return;
      if (opts?.background && data.error) return;
      if (data.error) setLoadError(data.error);
      if (data.notice) setTicketsNotice(data.notice);
      else if (data.truncated) setTicketsNotice(`Showing the first ${(data.tickets ?? []).length} work items — this ${SCOPE_LABEL[viewScope].toLowerCase()} has more.`);
      setSprintLabel(typeof data.sprint === "string" ? data.sprint : "");
      const list: Ticket[] = data.tickets ?? [];
      const merged = [...list, ...[...offBoardRef.current.values()].filter((x) => !list.some((t) => t.id === x.id))];
      detailFetchedRef.current.clear();
      setTickets(merged);
      // The ticket the screen was last on, when this board still has it. Only
      // the initial load passes one: switching project, sprint or view is a
      // request for a different list, and landing on a row from the previous
      // one would be answering a question that was not asked.
      const preferred = opts?.preferTicket && list.some((t) => t.id === opts.preferTicket) ? opts.preferTicket : "";
      // `prev` is empty on the first load, and so is the route ref — comparing
      // them without that guard held the selection at nothing instead of
      // falling through to the first row.
      setSelectedId((prev) =>
        merged.some((t) => t.id === prev) || (prev !== "" && prev === routeTicketRef.current)
          ? prev
          : preferred || list[0]?.id || ""
      );
      if (opts?.notify) {
        if (data.error) showToast(data.error, 8000, "error");
        else if (data.notice) showToast(data.notice, 8000, "error");
        else showToast(`Loaded ${list.length} ticket${list.length === 1 ? "" : "s"}`, 2600);
      }
      refreshStale = Boolean(data.stale) && !opts?.background;
    } catch (e) {
      if (!isLatest() || opts?.background) return;
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      setTickets([]);
      if (opts?.notify) showToast(msg, 8000, "error");
    } finally {
      if (isLatest() && !opts?.background) setLoading(false);
      if (refreshStale) void reloadTickets(provider, project, sprint, { scope: viewScope, background: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showToast is declared later but stable (empty-dep useCallback)
  }, []);

  // Populate the project picker (Azure DevOps only). Returns the list so callers
  // can resolve the initial/default project synchronously.
  const loadProjectOptions = useCallback(async (provider: ProviderId): Promise<{ id: string; name: string }[]> => {
    if (provider !== "azure-devops") {
      setProjectList([]);
      return [];
    }
    try {
      const r = await fetch(`/api/projects?provider=${provider}`);
      const data = await r.json();
      const list = Array.isArray(data.projects) ? data.projects : [];
      setProjectList(list);
      return list;
    } catch {
      setProjectList([]);
      return [];
    }
  }, []);

  // Populate the sprint picker for a project (Azure DevOps only) and default-select
  // ADO's current iteration. Returns the resolved current-sprint name.
  const loadSprintOptions = useCallback(async (provider: ProviderId, project: string, preferred?: string): Promise<string> => {
    if (provider !== "azure-devops" || !project) {
      setSprintOptions([]);
      sprintOptionsRef.current = [];
      setSelectedSprint("");
      setCurrentSprint("");
      return "";
    }
    try {
      const r = await fetch(`/api/sprints?provider=${provider}&project=${encodeURIComponent(project)}`);
      const data = await r.json();
      const list: IterationOption[] = Array.isArray(data.sprints) ? data.sprints : [];
      setSprintOptions(list);
      // The ref is written here as well as on render: every caller loads the
      // tickets in the very next statement, before React has re-rendered, and a
      // ref still holding the previous project's iterations would fail to find
      // the new sprint's path and send its name — the shape the provider 400s.
      sprintOptionsRef.current = list;
      // An empty picker renders as a plain label with no chevron, which is
      // indistinguishable from a project that has one iteration. When the read
      // actually failed, say so — this is the exact failure that read as "the
      // dropdown stopped working" rather than "the call was refused".
      const why = data.error || data.notice;
      if (why && scopeRef.current === "sprint") showToast(`Sprints could not be loaded — ${why}`, 9000, "error");
      const current = typeof data.current === "string" ? data.current : "";
      setCurrentSprint(current);
      // A remembered sprint only survives if this project still has it — a
      // sprint name from another project would send the provider a path it
      // cannot resolve.
      const chosen = preferred && list.some((i) => i.name === preferred) ? preferred : current;
      setSelectedSprint(chosen);
      return chosen;
    } catch (e) {
      setSprintOptions([]);
      sprintOptionsRef.current = [];
      if (scopeRef.current === "sprint") showToast(`Sprints could not be loaded — ${e instanceof Error ? e.message : String(e)}`, 9000, "error");
      return "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showToast is declared later but stable (empty-dep useCallback)
  }, []);

  // User switched view (Sprint / Backlog / Board). A different query at the
  // provider, so it reloads rather than re-filtering what is already on screen.
  const onScopeChange = (next: TicketScope, e: MouseEvent) => {
    fireBoltFromEvent(e);
    if (next === scope) return;
    setScope(next);
    reloadTickets(settings.provider, selectedProject, next === "sprint" ? selectedSprint : undefined, { scope: next });
  };

  // User picked a specific sprint from the dropdown — reload tickets for it.
  const onSprintChange = (value: string, e: { clientX: number; clientY: number }) => {
    fireBoltFromEvent(e);
    setSelectedSprint(value);
    reloadTickets(settings.provider, selectedProject, value);
  };

  // User picked a project — reset its sprints to the current one, then reload tickets.
  const onSelectProject = async (value: string, e: { clientX: number; clientY: number }) => {
    fireBoltFromEvent(e);
    setSelectedProject(value);
    await Promise.all([
      loadSprintOptions(settings.provider, value),
      reloadTickets(settings.provider, value, undefined, { notify: true }),
    ]);
  };

  // Settings → projects → sprints + tickets. Sprints and tickets run together:
  // the server resolves the current sprint itself. Run on mount and again whenever the header switches
  // organization: every one of these calls is answered by the provider as the
  // active connection, so the whole screen is that organization's.
  const loadWorkspace = useCallback(async () => {
    let provider: ProviderId = "azure-devops";
    try {
      const data = await queryClient.fetchQuery({ queryKey: SETTINGS_KEY, queryFn: fetchSettings, staleTime: 0 });
      if (data.settings) {
        setSettings(data.settings as unknown as SettingsView);
        provider = (data.settings.provider as ProviderId | undefined) ?? provider;
      }
    } catch {
      /* ignore — fall back to default provider */
    }
    const list = await loadProjectOptions(provider);
    const urlProject = urlProjectRef.current;
    const remembered = prefsRef.current;
    // An explicit `?project=` beats what the screen was last on; a remembered
    // project only counts while this organization still has it.
    const project = urlProject && list.some((p) => p.name === urlProject)
      ? urlProject
      : remembered.project && list.some((p) => p.name === remembered.project)
        ? remembered.project
        : list[0]?.name ?? "";
    setSelectedProject(project);
    const viewScope = (TICKET_SCOPES as readonly string[]).includes(remembered.scope)
      ? (remembered.scope as TicketScope)
      : "sprint";
    setScope(viewScope);
    scopeRef.current = viewScope;
    const wanted = viewScope === "sprint" ? remembered.sprint || undefined : undefined;
    sprintOptionsRef.current = [];
    const [sprint] = await Promise.all([
      loadSprintOptions(provider, project, remembered.sprint),
      reloadTickets(provider, project, wanted, { scope: viewScope, preferTicket: remembered.ticket }),
    ]);
    if (wanted && sprint !== wanted) {
      await reloadTickets(provider, project, sprint || undefined, { scope: viewScope, preferTicket: remembered.ticket });
    }
  }, [loadProjectOptions, loadSprintOptions, reloadTickets]);

  // The sprint's plan, for the "Planned" filter and the queue badge.
  //
  // Only in the sprint view: a plan is keyed by an iteration, so a backlog or a
  // board has no plan to be in and badging those rows would claim otherwise.
  // A plan that does not exist yet is an empty map, not an error — most projects
  // never have one, and this screen works exactly as it did before without it.
  useEffect(() => {
    const sprint = selectedSprint || sprintLabel;
    if (scope !== "sprint" || !selectedProject || !sprint) {
      setPlannedOrder({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ provider: settings.provider, project: selectedProject, sprint });
        const r = await fetch(`/api/my-sprint/plan?${qs.toString()}`);
        const d = await r.json();
        if (cancelled) return;
        const items: { ticketId: string; implementOrder: number }[] = d?.plan?.items ?? [];
        setPlannedOrder(Object.fromEntries(items.map((i) => [String(i.ticketId), i.implementOrder])));
      } catch {
        if (!cancelled) setPlannedOrder({});
      }
    })();
    return () => { cancelled = true; };
  }, [scope, selectedProject, selectedSprint, sprintLabel, settings.provider]);

  // Put a ticket the current board does not contain on screen. The bell's
  // destination is a ticket id, and the board it lands on is bounded by an
  // iteration, a backlog or an open-state board — released work is in none of
  // them, which is why clicking such a notification used to select an id the
  // detail pane could not resolve and appear to do nothing.
  const ensureTicket = useCallback(async (id: string) => {
    if (!id) return;
    if (ticketsRef.current.some((t) => t.id === id)) return;
    if (offBoardRef.current.has(id)) return;
    try {
      const r = await fetch(`/api/tickets/${encodeURIComponent(id)}`);
      const data = await r.json();
      const ticket: Ticket | null = data.ticket ?? null;
      if (!ticket) {
        routeTicketRef.current = "";
        showToast(`#${id} could not be loaded from the provider`, 8000, "error");
        return;
      }
      offBoardRef.current.set(ticket.id, ticket);
      setTickets((list) => (list.some((t) => t.id === ticket.id) ? list : [...list, ticket]));
    } catch {
      routeTicketRef.current = "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showToast is declared later but stable (empty-dep useCallback)
  }, []);

  // `?ticket=&tab=` is how every page's bell reaches this screen, including
  // from this screen itself. `at` is a nonce the bell adds so clicking the same
  // notification twice re-lands on its tab rather than being a no-op URL.
  const routeTicket = searchParams.get("ticket") ?? "";
  const routeTab = searchParams.get("tab") ?? "";
  const routeAt = searchParams.get("at") ?? "";
  useEffect(() => {
    if (!routeTicket) return;
    routeTicketRef.current = routeTicket;
    setSelectedId(routeTicket);
    // A notification names one ticket, so the phone goes to it. Landing on the
    // list with the row merely selected behind it is the same as not having
    // followed the notification at all.
    setMobilePane("detail");
    if (ROUTE_TABS.includes(routeTab as TabId)) setTab(routeTab as TabId);
    void ensureTicket(routeTicket);
  }, [routeTicket, routeTab, routeAt, ensureTicket]);

  // Bumped rather than reloading here directly: `usePagePrefs` re-hydrates to
  // the new organization's remembered controls on the same event, and the
  // workspace load has to read those, not the outgoing organization's.
  useEffect(() => {
    const onConnectionChanged = () => { setOrgEpoch((n) => n + 1); };
    window.addEventListener(CONNECTION_CHANGED_EVENT, onConnectionChanged);
    return () => window.removeEventListener(CONNECTION_CHANGED_EVENT, onConnectionChanged);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    void loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- orgEpoch is the trigger, not an input
  }, [prefsReady, orgEpoch, loadWorkspace]);

  // Remember what the screen is on. Gated on a resolved project so the empty
  // state of a still-loading screen never overwrites the stored choice.
  useEffect(() => {
    if (!prefsReady || !selectedProject) return;
    // An empty selection is a board still loading, not a deselection — writing
    // it would forget the ticket a moment before the reload re-picks it.
    savePrefs({
      project: selectedProject, sprint: selectedSprint, scope,
      ...(selectedId ? { ticket: selectedId } : {}),
    });
  }, [prefsReady, selectedProject, selectedSprint, scope, selectedId, savePrefs]);

  useEffect(() => {
    (async () => {
      try {
        const data = await readJson(["skills"], "/api/skills", 30_000);
        if (Array.isArray(data.skills) && data.skills.length) setSkillOptions(data.skills);
      } catch {
        /* keep default SKILL_OPTIONS */
      }
    })();
    (async () => {
      try {
        const data = await readJson(["claude-models"], "/api/claude-models", 600_000);
        if (Array.isArray(data.models) && data.models.length) setModelOptions(data.models);
      } catch {
        /* keep the family aliases, which the CLI resolves to the latest model */
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
    };
  }, []);

  // ---- execution history ----
  const loadHistory = useCallback(async (ticketId: string) => {
    if (!ticketId) return;
    try {
      const r = await fetch(`/api/tickets/${ticketId}/executions`);
      const data = await r.json();
      setHistory((h) => ({ ...h, [ticketId]: data.runs ?? [] }));
    } catch {
      /* ignore */
    }
  }, []);

  // Lazily load a ticket's discussion comments when it becomes selected.
  const loadComments = useCallback(async (ticketId: string, provider: ProviderId) => {
    if (!ticketId || comments[ticketId]) return;
    try {
      const qs = new URLSearchParams({ provider });
      const r = await fetch(`/api/tickets/${ticketId}/comments?${qs.toString()}`);
      const data = await r.json();
      setComments((c) => ({ ...c, [ticketId]: data.comments ?? [] }));
    } catch {
      /* ignore — section stays hidden */
    }
  }, [comments]);

  useEffect(() => {
    if (selectedId) loadHistory(selectedId);
  }, [selectedId, loadHistory]);

  // The graphs are static server-side code, so one fetch at mount is enough.
  useEffect(() => {
    fetch("/api/graphs")
      .then((r) => r.json())
      .then((d) => setGraphOutlines(d.outlines ?? {}))
      .catch(() => {
        /* the timeline just stays empty until a run reports its own nodes */
      });
  }, []);

  useEffect(() => {
    if (selectedId) loadComments(selectedId, settings.provider);
  }, [selectedId, settings.provider, loadComments]);

  // Lazily load a ticket's description and acceptance criteria when it becomes
  // selected. They are not in the list payload — see TICKET_FIELDS in
  // lib/ado.ts — so `description === undefined` means "not fetched yet" and is
  // the whole trigger. A provider that already sent them (GitHub) therefore
  // never gets here, and a ticket genuinely without a description is fetched
  // once and then reads as "" rather than being asked for again.
  useEffect(() => {
    if (!selectedId) return;
    const t = tickets.find((x) => x.id === selectedId);
    if (!t || t.description !== undefined) return;
    if (detailFetchedRef.current.has(selectedId)) return;
    detailFetchedRef.current.add(selectedId);
    let cancelled = false;
    (async () => {
      try {
        const data = await readJson(["ticket-detail", settings.provider, selectedId], `/api/tickets/${selectedId}/detail?provider=${settings.provider}`, 60_000);
        if (cancelled || data.error) return;
        setTickets((list) =>
          list.map((x) =>
            x.id === selectedId
              ? { ...x, description: data.description ?? "", criteria: data.criteria ?? "" }
              : x
          )
        );
      } catch {
        /* the panel keeps its empty state; reselecting retries after a reload */
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, tickets, settings.provider]);

  // Fetch (or refetch) the Resolve Review data for one ticket — the linked PR
  // overview plus its open/resolved review-comment threads.
  const loadReview = useCallback(async (ticketId: string, provider: ProviderId) => {
    if (!ticketId) return;
    setReviewsLoading((s) => ({ ...s, [ticketId]: true }));
    try {
      const r = await fetch(`/api/tickets/${ticketId}/review?provider=${provider}`);
      const data = await r.json();
      setReviews((s) => ({ ...s, [ticketId]: data.review ?? { pr: null, comments: [], unresolvedCount: 0 } }));
    } catch {
      /* ignore — Resolve Review tab shows the empty state */
    } finally {
      setReviewsLoading((s) => ({ ...s, [ticketId]: false }));
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

  // Poll the board-scoped review source.
  //
  // The review half is what costs money, because it costs the provider one
  // round-trip *per ticket asked about*. Three things bound it:
  //  - only tickets in the review lane are offered as candidates (the server
  //    adds back any ticket this app opened a PR for, whatever its state);
  //  - a hidden tab polls not at all, and refreshes the moment it comes back;
  //  - the interval is minutes, not seconds — a review comment is not a
  //    real-time event, and `refreshNotifications` is called directly at the
  //    moments the answer actually changes (a run publishing, a fix landing).
  const reviewPollIds = useMemo(() => {
    const ids = tickets.map((tk) => tk.id);
    // The same "effective status" getStatus() computes — spelled out because
    // that helper is declared further down the component and this runs during
    // render. A locally-applied status change re-narrows the candidate set
    // without waiting for the next ticket reload.
    const reviewable = tickets
      .filter((tk) => isReviewable(statusOverrides[tk.id] || tk.status))
      .map((tk) => tk.id);
    // Joined into strings, not returned as an array or an object. These become
    // effect dependencies below, and React compares dependencies by identity: a
    // fresh array with identical contents — which every ticket reload produces —
    // would restart the poll and fire a request, which is how a two-minute
    // interval quietly became a thirty-second one.
    return { ids: ids.join(","), reviewable: reviewable.join(",") };
  }, [tickets, statusOverrides]);

  // The current parameters, reachable from a callback that must never be
  // re-created: a fetch function that changes identity restarts the interval
  // that owns it.
  const reviewPollRef = useRef({ ids: "", reviewable: "", provider: settings.provider });
  reviewPollRef.current = { ...reviewPollIds, provider: settings.provider };
  const reviewFetchedAt = useRef(0);

  const refreshNotifications = useCallback(async (opts?: { force?: boolean; shared?: boolean }) => {
    const { ids, reviewable, provider } = reviewPollRef.current;
    // A floor on the rate, independent of whatever caused the call. The interval
    // is the schedule; this is what stops a re-render storm, a remount or a
    // burst of run updates from turning into a burst of provider reads.
    if (!opts?.force && Date.now() - reviewFetchedAt.current < NOTIFY_MIN_GAP_MS) return;
    reviewFetchedAt.current = Date.now();

    const reviews = async () => {
      // No board on screen is no review question to ask — and an empty answer
      // here is a real one, unlike a degraded read.
      if (!ids) {
        setReviewSummary([]);
        setReviewDegraded(false);
        return;
      }
      try {
        const qs = new URLSearchParams({ provider, ids, reviewable });
        const r = await fetch(`/api/reviews/summary?${qs}`);
        const data = await r.json();
        // A degraded answer is not an answer. Keeping the last known list is the
        // difference between "the provider refused" and "you have nothing to review".
        if (data.degraded) {
          setReviewDegraded(true);
          return;
        }
        setReviewDegraded(false);
        setReviewSummary(Array.isArray(data.reviews) ? data.reviews : []);
      } catch {
        setReviewDegraded(true);
      }
    };

    // The identity-scoped half (automation, pull requests, comments, plan
    // reviews) belongs to the shared bell and runs on its own timer wherever it
    // is rendered. It is nudged from here only at the moments this screen knows
    // its answer just changed — a run publishing a pull request — and never on
    // this timer, which would poll it a second time from one page.
    await Promise.all([reviews(), ...(opts?.shared ? [refreshShared({ force: true })] : [])]);
    // Deliberately only the provider's stable refresh in the dependencies: every
    // other parameter is read from a ref above, so this function's identity
    // never changes and the interval below is never torn down by a re-render.
  }, [refreshShared]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void refreshNotifications();
      timer = setInterval(() => void refreshNotifications({ force: true }), NOTIFY_POLL_MS);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // `reviewPollIds.ids` is a string, so this restarts only when the board
    // genuinely changes — a reload that returns the same tickets does not.
  }, [reviewPollIds.ids, refreshNotifications]);

  // Open a past run (from DB) in the viewer.
  const openRun = useCallback(async (ticketId: string, execId: string, e?: MouseEvent) => {
    fireBoltFromEvent(e);
    try {
      const r = await fetch(`/api/executions/${execId}`);
      const data = await r.json();
      const run = data.run;
      if (!run) return;
      setExecs((s) => ({ ...s, [ticketId]: toExecView(run, s[ticketId]) }));
      setTab(
        run.state === "succeeded" ? "result" : "execution"
      );
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

  const pushToast = useToast();
  const showToast = useCallback((msg: string, ms = 7000, kind: "success" | "error" = "success") => {
    pushToast(msg, kind, ms);
  }, [pushToast]);

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
      const r = await fetch(`/api/tickets/${ticket.id}/status?provider=${settings.provider}&type=${encodeURIComponent(ticket.type)}${selectedProject ? `&project=${encodeURIComponent(selectedProject)}` : ""}`);
      const data = await r.json();
      const options = Array.isArray(data.options) ? data.options : [];
      setStatusMenuOptions(options);
      // The same request reports where the ticket actually is. Opening the menu is
      // the natural moment to reconcile: if anything (a rejected write, an edit made
      // in the tracker itself) moved it, the pill corrects itself instead of showing
      // a status the provider never had.
      if (typeof data.current === "string" && data.current && data.current !== ticket.status) {
        setStatusOverrides((s) => ({ ...s, [ticket.id]: data.current }));
      } else if (typeof data.current === "string" && data.current === ticket.status) {
        setStatusOverrides((s) => {
          const next = { ...s };
          delete next[ticket.id];
          return next;
        });
      }
      try {
        localStorage.setItem(cacheKey, JSON.stringify(options));
      } catch { }
    } catch {
      if (!hadCache) setStatusMenuOptions([]);
    } finally {
      setStatusMenuLoading(false);
    }
  };

  // Roll the local status back to whatever the provider reports. `current` is what
  // the status API hands back on a rejected write; with no value (a provider that
  // can't be read) the override is dropped so the fetched ticket status shows again.
  // Either way the app stops displaying a status the provider never accepted.
  const resyncStatus = useCallback((ticketId: string, current: unknown) => {
    setStatusOverrides((s) => {
      const next = { ...s };
      if (typeof current === "string" && current) next[ticketId] = current;
      else delete next[ticketId];
      return next;
    });
  }, []);

  const selectStatus = async (ticketId: string, status: string, e?: MouseEvent) => {
    fireBoltFromEvent(e);
    setStatusMenuOpen(false);
    setStatusOverrides((s) => ({ ...s, [ticketId]: status })); // optimistic
    try {
      const r = await fetch(`/api/tickets/${ticketId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: settings.provider, status }),
      });
      const data = await r.json();
      if (!r.ok) {
        resyncStatus(ticketId, data.current);
        throw new Error(data.error || "Failed to update status");
      }
      // The provider maps the requested label onto one of its own workflow states,
      // so show what it recorded rather than what was asked for.
      const applied = (data.status as string) || status;
      setStatusOverrides((s) => ({ ...s, [ticketId]: applied }));
      showToast(`Status set to "${applied}" — synced to ${providerMeta(settings.provider).name}`, 4000);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to sync status to the provider", 9000, "error");
    }
  };
  // Note: use `??` (not `||`) against the override so that clearing a field to ""
  // stays empty instead of instantly snapping back to the fallback default.
  const getArea = (t: Ticket) => overrides[t.id]?.area ?? t.project;
  // The Implement action's skill, unless the ticket carries a hand-picked one on
  // its Overview tab.
  const getSkill = (t: Ticket) => overrides[t.id]?.skill || actionInfoFor(getStatus(t))?.skill || DEFAULT_SKILL;
  const getReviewSkill = () => FIX_REVIEW_SKILL;
  // The repo a run executes in. Chosen per ticket: one provider connection spans
  // many projects, so there is nothing app-wide to fall back to.
  const getRootRepo = (t: Ticket) => overrides[t.id]?.rootRepo ?? "";
  // The default is the `opus` family alias; once the installed CLI's catalog
  // has loaded it names the concrete model that alias resolves to, so the
  // dropdown and the command preview show the version that will actually run.
  const getModel = (t: Ticket) => resolveModelId(overrides[t.id]?.model ?? DEFAULT_CLAUDE_MODEL, modelOptions);
  const getEffort = (t: Ticket) => overrides[t.id]?.effort ?? DEFAULT_CLAUDE_EFFORT;
  const setOverrideValue = (ticketId: string, field: OverrideField, value: string) =>
    setOverrides((s) => ({ ...s, [ticketId]: { ...(s[ticketId] || {}), [field]: value } }));

  const saveRootRepo = async (t: Ticket) => {
    const project = getArea(t);
    const rootRepo = getRootRepo(t).trim();
    if (!project || !rootRepo) return;
    setSavingRootRepo(true);
    try {
      const r = await fetch("/api/options/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, rootRepo }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        showToast(data.error || "The root repo could not be saved.", 8000, "error");
        return;
      }
      setSavedMapping((m) => ({ ...m, [project]: rootRepo }));
      rememberOption("rootRepo", rootRepo);
      showToast(`Root repo saved for ${project}.`, 3000);
    } catch {
      showToast("The root repo could not be saved.", 8000, "error");
    } finally {
      setSavingRootRepo(false);
    }
  };

  // ---- Open Terminal, and the ad-hoc "Ask Claude" session ----
  // Both run the CLI on the machine hosting this app, in the ticket's Root repo,
  // with none of the execution engine involved: no Run row, no worktree, no
  // branch, no pull request, no admission check. Open Terminal is for sitting at
  // that machine; Ask is the same thing driven from a phone.
  const openTerminal = useCallback(async (ticketId: string, rootRepo: string) => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/terminal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootRepo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) showToast(data.error || "Could not open a terminal", 9000, "error");
      else showToast("Terminal opened on this app's machine", 3000);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not open a terminal", 9000, "error");
    }
  }, [showToast]);

  const closeAskStream = useCallback(() => {
    askSse.current?.close();
    askSse.current = null;
  }, []);

  const openAskStream = useCallback((ticketId: string) => {
    closeAskStream();
    if (typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/tickets/${ticketId}/ask/stream`);
    askSse.current = es;
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.ask) setAsk(data.ask as AskView);
      } catch {
        /* ignore malformed frame */
      }
    };
    // The route closes the stream once the turn ends, which arrives here as an
    // error. The frame before it already carried the finished state, so there is
    // nothing to reconnect to and nothing to refetch.
    es.onerror = () => closeAskStream();
  }, [closeAskStream]);

  const loadAsk = useCallback(async (ticketId: string) => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/ask`, { cache: "no-store" });
      const data = (await res.json()) as AskView;
      setAsk(data);
      // A turn started from another device is still running here: pick it up.
      if (data.state === "running") openAskStream(ticketId);
    } catch {
      /* leave the panel on whatever it last showed */
    }
  }, [openAskStream]);

  const sendAsk = useCallback(async (ticketId: string, rootRepo: string, model: string, effort: string) => {
    const prompt = (askPrompts[ticketId] ?? "").trim();
    if (!prompt) return;
    try {
      const res = await fetch(`/api/tickets/${ticketId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootRepo, prompt, model, effort }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Claude could not be started", 9000, "error");
        return;
      }
      setAskPrompts((s) => ({ ...s, [ticketId]: "" }));
      openAskStream(ticketId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Claude could not be started", 9000, "error");
    }
  }, [askPrompts, openAskStream, showToast]);

  const [addingToPlan, setAddingToPlan] = useState(false);
  const addToReleasePlan = async (t: Ticket) => {
    setAddingToPlan(true);
    try {
      const res = await fetch("/api/my-sprint/plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addToRelease: { ticketId: t.id, title: t.title, project: getArea(t), points: t.storyPoints, estimateHours: t.estimateHours },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) showToast(data.outcome?.error || data.error || "Could not add the ticket to the release plan", 9000, "error");
      else showToast(`#${t.id} added to the release plan`, 4000);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not add the ticket to the release plan", 9000, "error");
    } finally {
      setAddingToPlan(false);
    }
  };

  const stopAsk = useCallback(async (ticketId: string) => {
    try {
      await fetch(`/api/tickets/${ticketId}/ask/cancel`, { method: "POST" });
    } catch {
      /* the stream reports the real outcome either way */
    }
  }, []);

  const clearAsk = useCallback(async (ticketId: string) => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/ask`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "Could not reset the session", 7000, "error");
        return;
      }
      closeAskStream();
      setAsk(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not reset the session", 7000, "error");
    }
  }, [closeAskStream, showToast]);

  // Read the session when the tab is opened (or the selection changes under it),
  // and drop the stream on the way out — a closed panel has nothing to render.
  useEffect(() => {
    if (tab !== "ask" || !selectedId) {
      closeAskStream();
      return;
    }
    setAsk(null);
    void loadAsk(selectedId);
    return () => closeAskStream();
  }, [tab, selectedId, loadAsk, closeAskStream]);

  useEffect(() => {
    if (tab === "ask" && askLogRef.current) askLogRef.current.scrollTop = askLogRef.current.scrollHeight;
  });

  // Remember a Root Repo / Project / Skill value in the DB so it shows up as a
  // saved option next time (any ticket, any session) instead of only being a
  // per-session suggestion.
  const savedOptionKeys = useRef<Set<string>>(new Set());
  const [savedMapping, setSavedMapping] = useState<Record<string, string>>({});
  const [savingRootRepo, setSavingRootRepo] = useState(false);
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
          if (data.rootRepo) {
            setOverrideValue(ticketId, "rootRepo", data.rootRepo);
            setSavedMapping((m) => ({ ...m, [value]: data.rootRepo }));
          }
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
        if (data.rootRepo) {
          setOverrideValue(selectedId, "rootRepo", data.rootRepo);
          setSavedMapping((m) => ({ ...m, [project]: data.rootRepo }));
        }
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
      ...overrideVals.map((o) => o?.rootRepo),
      ...savedOptions.rootRepo,
    ].filter(Boolean) as string[])
  );
  const mergedSkillOptions = Array.from(new Set([...skillOptions, ...savedOptions.skill]));

  // ---- live execution updates: SSE (falls back to 1.2s polling) ----
  const stopTracking = useCallback((runId: string) => {
    if (pollTimers.current[runId]) {
      clearInterval(pollTimers.current[runId]);
      delete pollTimers.current[runId];
    }
    if (sseConnections.current[runId]) {
      sseConnections.current[runId].close();
      delete sseConnections.current[runId];
    }
  }, []);

  // Applies one execution snapshot (from either the SSE stream or a polled
  // fetch) to state, and — on first reaching a terminal status — runs the
  // completion side effects (toast/notify, provider status sync, history
  // reload, batch-queue slot release). Returns true once terminal.
  const applyExecutionUpdate = useCallback(
    async (ticketId: string, runId: string, run: Record<string, unknown> | undefined) => {
      if (!run) return false;
      const state = run.state as RunState;
      setExecs((s) => ({ ...s, [ticketId]: toExecView(run, s[ticketId]) }));

      // Parked: no live process either way, so the stream stops and the batch
      // slot is freed — but *why* it parked decides what the developer is told.
      // None of the completion side effects run (status sync, PR toast, history
      // reload): the run is not over.
      if (state === "waiting") {
        stopTracking(runId);
        try { window.__reactor?.setMode("idle"); } catch { }
        const limited = run.endReason === "rate-limited";
        if (limited) {
          // Nothing is asked of anybody here, so the plan tab is not opened and
          // no desktop notification is raised: the scheduler continues this run
          // in the session it was cut off in when the quota resets.
          showToast(`#${ticketId} — usage limit reached; the run continues when it resets`);
        } else {
          if (ticketId === selectedIdRef.current) setTab("execution");
          showToast(`#${ticketId} — needs you: check whether the push landed`, 9000, "error");
          notify("Ticket Executor", `#${ticketId} needs you — the server restarted while it was publishing`);
        }
        if (batchRunningRef.current.delete(ticketId)) tryStartNextQueuedRef.current();
        return true;
      }

      if (state === "running") return false;

      stopTracking(runId);
      try {
        window.__reactor?.setMode(state === "succeeded" ? "completed" : "idle");
      } catch { }
      // Recorded here rather than derived from `execs`, because this is the one
      // place the transition is actually observed. `cancelled` is a human
      // decision and gets no notification — the person who pressed it knows.
      if (state === "succeeded" || state === "failed") {
        setRunEvents((prev) =>
          [
            ...prev.filter((r) => r.runId !== runId),
            { ticketId, runId, state, at: new Date().toISOString() },
          ].slice(-RUN_EVENT_CAP)
        );
      }
      if (state === "succeeded") {
        // The status advance used to happen right here, in the browser. It has
        // moved to `lib/execution/release.ts`, which runs server-side on the
        // sprint plan's release day — because a finished run is not the same
        // event as handing the work to a reviewer, and because a closed tab used
        // to leave the work item in "In Progress" with a finished pull request
        // attached to it. The pull request this run opened is a draft until then.
        showToast(`#${ticketId} completed — pull request opened as a draft`);
        notify("Ticket Executor", `#${ticketId} completed — draft PR ready to release`);
      } else {
        showToast(`#${ticketId} failed`, 9000, "error");
        notify("Ticket Executor", `#${ticketId} failed`);
      }
      // A fix-code-review run (v2 or v3) resolves PR threads itself — refetch
      // the Resolve Review data so the tab reflects the new state.
      if (isFixReviewSkill(run.skill as string)) {
        setReviews((s) => {
          const { [ticketId]: _drop, ...rest } = s;
          return rest;
        });
      }
      loadHistory(ticketId);
      // The bell's answer just changed for this ticket — a publish added a PR to
      // poll, a fix-review run resolved threads. Ask now rather than leaving the
      // notification up to two minutes stale; `force` because this is a known
      // change, not a re-render that merely might be one.
      void refreshNotifications({ force: true, shared: true });
      // Free this ticket's batch-queue slot (no-op if it wasn't batch-started)
      // and let the next queued ticket, if any, take its place.
      if (batchRunningRef.current.delete(ticketId)) tryStartNextQueuedRef.current();
      return true;
    },
    [showToast, loadHistory, notify, settings.provider, stopTracking, resyncStatus, refreshNotifications]
  );

  const startPollingFallback = useCallback(
    (ticketId: string, runId: string) => {
      if (pollTimers.current[runId]) return;
      const poll = async () => {
        try {
          const r = await fetch(`/api/executions/${runId}`);
          const data = await r.json();
          await applyExecutionUpdate(ticketId, runId, data.run);
        } catch {
          /* keep polling */
        }
      };
      pollTimers.current[runId] = setInterval(poll, 1200);
      poll();
    },
    [applyExecutionUpdate]
  );

  const startPolling = useCallback(
    (ticketId: string, runId: string) => {
      if (pollTimers.current[runId] || sseConnections.current[runId]) return;
      if (typeof EventSource === "undefined") {
        startPollingFallback(ticketId, runId);
        return;
      }
      const es = new EventSource(`/api/executions/${runId}/stream`);
      sseConnections.current[runId] = es;
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          void applyExecutionUpdate(ticketId, runId, data.run);
        } catch {
          /* ignore malformed frame */
        }
      };
      es.onerror = () => {
        // The stream endpoint closes the connection normally once the run
        // reaches a terminal status — only fall back to polling if we're
        // still tracking this execution (i.e. it errored before finishing).
        if (!sseConnections.current[runId]) return;
        es.close();
        delete sseConnections.current[runId];
        startPollingFallback(ticketId, runId);
      };
    },
    [startPollingFallback]
  );

  // Rehydrate a ticket's exec state from its most recent execution row —
  // covers the case where the page reloaded (or the ticket is reselected)
  // after a run finished, so the CTA/result tab don't forget it happened.
  const hydrateExecution = useCallback(
    async (ticketId: string, runId: string, skillHint?: string) => {
      try {
        const r = await fetch(`/api/executions/${runId}`);
        const data = await r.json();
        const run = data.run;
        if (!run) return;
        setExecs((s) => ({ ...s, [ticketId]: toExecView(run, s[ticketId], skillHint) }));
        if (run.state === "running") {
          startPolling(ticketId, runId);
        }
        // A finished run no longer implies a status: the work item moves when the
        // plan releases it, so the provider's own value is the only truth here.
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
    const active = list.find((r) => r.state === "running" || r.state === "waiting");
    const shippedWithPr = list.find((r) => r.state === "succeeded" && r.prUrl);
    const target = active ?? shippedWithPr ?? list[0];
    if (target) hydrateExecution(selectedId, target.id, target.skill);
  }, [selectedId, history, execs, hydrateExecution]);

  // A run this screen did not start — the scheduler's, or another tab's — has
  // no stream here until something looks. The live signal re-reads the history,
  // and a running run the screen is not already tracking is hydrated through the
  // same path a reload uses.
  useLive("/api/live/runs", () => {
    if (selectedId) void loadHistory(selectedId);
  });

  useEffect(() => {
    if (!selectedId) return;
    const active = history[selectedId]?.find((r) => r.state === "running" || r.state === "waiting");
    if (!active || execs[selectedId]?.runId === active.id) return;
    hydrateExecution(selectedId, active.id, active.skill);
  }, [selectedId, history, execs, hydrateExecution]);

  // The board is the provider's, so nothing can push a change in it. Coming back
  // to the tab is the moment the developer looks, so the list is re-read then —
  // in the background, so the rows on screen stay put while it lands.
  const listArgsRef = useRef({ provider: settings.provider, project: selectedProject, sprint: selectedSprint, scope, loading });
  listArgsRef.current = { provider: settings.provider, project: selectedProject, sprint: selectedSprint, scope, loading };
  const listRevalidatedAt = useRef(Date.now());
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden || Date.now() - listRevalidatedAt.current < LIST_REVALIDATE_MS) return;
      const a = listArgsRef.current;
      if (a.loading) return;
      listRevalidatedAt.current = Date.now();
      void reloadTickets(a.provider, a.project, a.scope === "sprint" ? a.sprint : undefined, { scope: a.scope, background: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [reloadTickets]);

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
      if (cur && (cur.state === "running" || cur.state === "waiting")) return false;
      // Single-ticket mode: refuse to start a second run while another ticket
      // occupies the one slot (mirrors the CTA's disabled state; guards the
      // batch-run path too, which bypasses that button).
      if (!settings.multiTicketMode) {
        const busyId = Object.entries(execs).find(
          ([id, e]) => id !== t.id && (e.state === "running" || e.state === "waiting")
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
      // Root repo is per-ticket with no default — nudge the dev to fill it in
      // rather than starting a run the server would reject anyway.
      if (!getRootRepo(t).trim()) {
        if (isActive) {
          setTab("overview");
          showToast("Set ROOT REPO on the Overview tab first — the git clone this ticket runs in.", 9000, "error");
        } else {
          showToast(`#${t.id} skipped — no Root repo set.`, 9000, "error");
        }
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
      // Remember these values as saved options so the next ticket opened with the
      // same project defaults sensibly. The project→rootRepo mapping is written
      // by startRun() instead, so a run started outside this screen records it too.
      rememberOption("rootRepo", rootRepo);
      rememberOption("project", projectName);
      rememberOption("skill", skillName);
      if (isActive) setTab("execution");
      setExecs((s) => ({
        ...s,
        [t.id]: { state: "running", skill: skillName, nodes: [], logLines: [], resultText: "", error: "" },
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
            // The skill addresses the ticket by its provider URL, not the bare id.
            ticketUrl: t.url,
            provider: settings.provider,
            // Snapshot the team's own sizing alongside the run, for the dashboard's
            // estimate-vs-actual comparison. Absent on unsized tickets.
            estimateHours: t.estimateHours,
            storyPoints: t.storyPoints,
            ...(prUrl ? { prUrl } : {}),
          }),
        });
        const data = await r.json();
        if (!r.ok || !data.runId) {
          // A 400 means the run was rejected before the CLI was spawned (bad Root
          // repo, missing project) — nothing ran, so don't leave a failed run row
          // behind; just surface why and drop back to the previous state.
          if (r.status === 400) {
            setExecs((s) => {
              const next = { ...s };
              delete next[t.id];
              return next;
            });
            if (isActive) {
              setTab("overview");
              window.__reactor?.setMode("idle");
            }
            showToast(data.error || "Run rejected before starting.", 12000, "error");
            return false;
          }
          setExecs((s) => ({
            ...s,
            [t.id]: {
              state: "failed",
              skill: skillName,
              nodes: [],
              logLines: [],
              resultText: "",
              error: data.error || "Failed to start the run",
            },
          }));
          if (isActive) window.__reactor?.setMode("idle");
          return false;
        }
        setExecs((s) => ({ ...s, [t.id]: { ...s[t.id], runId: data.runId } }));
        // The run started, but the server couldn't verify something worth knowing
        // up front (e.g. MCP connectivity was never deep-checked).
        if (Array.isArray(data.warnings) && data.warnings.length && isActive) {
          showToast(String(data.warnings[0]), 12000, "error");
        }
        startPolling(t.id, data.runId);
        return true;
      } catch (err) {
        setExecs((s) => ({
          ...s,
          [t.id]: {
            state: "failed",
            skill: skillName,
            nodes: [],
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
      const execId = t ? execs[t.id]?.runId : undefined;
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

  // Translate one comment. A second press hides the block again rather than
  // spending another turn — the translation is already in hand.
  const translateComment = useCallback(async (key: string, html: string) => {
    if (translating[key]) return;
    if (translations[key] !== undefined) {
      setTranslations((t) => {
        const next = { ...t };
        delete next[key];
        return next;
      });
      return;
    }
    setTranslating((t) => ({ ...t, [key]: true }));
    try {
      const r = await fetch("/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: htmlToPlainText(html) }),
      });
      const data = await r.json();
      if (typeof data?.vietnamese === "string") {
        setTranslations((t) => ({ ...t, [key]: data.vietnamese }));
      } else {
        showToast(data?.error || "Translation failed.", 7000, "error");
      }
    } catch {
      showToast("Translation failed.", 7000, "error");
    } finally {
      setTranslating((t) => {
        const next = { ...t };
        delete next[key];
        return next;
      });
    }
  }, [translating, translations, showToast]);

  // ---- discussion writes (both go straight to the provider) ----
  // The provider owns the count, so a reaction re-renders from what the write
  // answered rather than from an optimistic guess — two people reacting at once
  // would otherwise leave this page showing a number nobody else sees.
  const toggleReaction = useCallback(async (ticketId: string, commentId: string, kind: ReactionKind, on: boolean) => {
    const key = `${commentId}:${kind}`;
    setReacting((r) => ({ ...r, [key]: true }));
    try {
      const r = await fetch(`/api/tickets/${ticketId}/comments/${commentId}/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: settings.provider, kind, on }),
      });
      const data = await r.json();
      if (!r.ok || !data?.reaction) {
        showToast(data?.error || "The reaction could not be saved.", 7000, "error");
        return;
      }
      const reaction = data.reaction as TicketComment["reactions"][number];
      setComments((c) => ({
        ...c,
        [ticketId]: (c[ticketId] ?? []).map((cm) =>
          cm.id !== commentId
            ? cm
            : {
                ...cm,
                reactions: [...cm.reactions.filter((x) => x.kind !== kind), reaction].filter((x) => x.count > 0),
              }
        ),
      }));
    } catch {
      showToast("The reaction could not be saved.", 7000, "error");
    } finally {
      setReacting((r) => {
        const next = { ...r };
        delete next[key];
        return next;
      });
    }
  }, [settings.provider, showToast]);

  const postComment = useCallback(async (ticketId: string): Promise<void> => {
    const body = (commentDrafts[ticketId] ?? "").trim();
    if (!body) return;
    setPostingComment(true);
    try {
      const r = await fetch(`/api/tickets/${ticketId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: settings.provider, text: body, mentions: commentMentions[ticketId] ?? [] }),
      });
      const data = await r.json();
      if (!r.ok || !data?.comment) {
        showToast(data?.error || "The comment could not be posted.", 8000, "error");
        return;
      }
      setCommentDrafts((d) => ({ ...d, [ticketId]: "" }));
      setCommentMentions((m) => ({ ...m, [ticketId]: [] }));
      showToast("Comment posted to the ticket.");
      let fresh: TicketComment[] | null = null;
      try {
        const qs = new URLSearchParams({ provider: settings.provider });
        const lr = await fetch(`/api/tickets/${ticketId}/comments?${qs.toString()}`);
        const ld = await lr.json();
        if (lr.ok && Array.isArray(ld?.comments) && ld.comments.length) fresh = ld.comments;
      } catch {}
      setComments((c) => ({ ...c, [ticketId]: fresh ?? [data.comment as TicketComment, ...(c[ticketId] ?? [])] }));
    } catch {
      showToast("The comment could not be posted.", 8000, "error");
    } finally {
      setPostingComment(false);
    }
  }, [commentDrafts, commentMentions, settings.provider, showToast]);

  const searchMentions = useCallback(async (q: string): Promise<MentionCandidate[]> => {
    try {
      const qs = new URLSearchParams({ provider: settings.provider, q });
      const r = await fetch(`/api/mentions?${qs.toString()}`);
      const data = await r.json();
      return Array.isArray(data?.people) ? data.people : [];
    } catch {
      return [];
    }
  }, [settings.provider]);

  const selectTicket = (id: string, e?: MouseEvent) => {
    fireBoltFromEvent(e);
    const ex = execs[id];
    setSelectedId(id);
    setMobilePane("detail");
    setTab(ex && ex.state === "running" ? "execution" : "overview");
  };

  // ---- derived ----
  const execStatusOf = (id: string): UiRunState => execs[id]?.state ?? "none";
  const activeCount = Object.values(execs).filter((e) => e.state === "running" || e.state === "waiting").length;
  // Waiting runs are read off current state because a held run is a standing
  // condition; the rest are events.
  const waitingRuns = useMemo(
    () =>
      Object.entries(execs)
        .filter(([, ex]) => isAwaitingReview(ex) && ex.runId)
        .map(([ticketId, ex]) => ({ ticketId, runId: ex.runId as string })),
    [execs]
  );
  const ticketTitles = useMemo(() => {
    const out: Record<string, string> = {};
    for (const t of tickets) out[t.id] = t.title;
    return out;
  }, [tickets]);
  useEffect(() => {
    setLocalSources({ reviews: reviewSummary, waitingRuns, runEvents, degraded: reviewDegraded, titles: ticketTitles });
  }, [setLocalSources, reviewSummary, waitingRuns, runEvents, reviewDegraded, ticketTitles]);
  const q = search.trim().toLowerCase();
  const statusOptions = Array.from(new Set(tickets.map((x) => getStatus(x)).filter(Boolean)));
  const typeOptions = Array.from(new Set(tickets.map((x) => x.type).filter(Boolean)));
  const assigneeOptions = Array.from(new Set(tickets.map((x) => x.assignee).filter(Boolean)));
  const filtered = tickets.filter((t) => {
    // The row the detail pane is showing always stays in the list. A ticket
    // reached from a notification is usually off the board the filters were
    // written for, and hiding it left the rail describing one ticket while the
    // panel next to it described another.
    if (t.id === selectedId) return true;
    if (q && !(t.id + " " + t.title + " " + t.assignee + " " + t.project).toLowerCase().includes(q)) return false;
    if (fStatus && getStatus(t) !== fStatus) return false;
    if (fType && t.type !== fType) return false;
    if (fAssignee && t.assignee !== fAssignee) return false;
    if (fPlanned === PLANNED_YES && !(t.id in plannedOrder)) return false;
    if (fPlanned === PLANNED_NO && t.id in plannedOrder) return false;
    return true;
  });
  const activeFilters = (fStatus ? 1 : 0) + (fType ? 1 : 0) + (fAssignee ? 1 : 0) + (fPlanned ? 1 : 0);
  const clearFilters = () => { setFStatus(""); setFType(""); setFAssignee(""); setFPlanned(""); };

  const t = tickets.find((x) => x.id === selectedId);
  const effStatus = t ? getStatus(t) : "";
  const actionInfo = t ? actionInfoFor(effStatus) : null;
  const ex = t ? execs[t.id] : undefined;
  const st: UiRunState = ex ? ex.state : "none";
  const execEnabled = st !== "none";
  const resultEnabled = st === "succeeded";
  const planEnabled = !!ex?.planMarkdown || st === "running";

  // Single-ticket mode: only one run at a time. Find any other ticket currently
  // occupying the one slot, so this ticket's CTA can be blocked while it does.
  const busyOtherTicketId = !settings.multiTicketMode
    ? Object.entries(execs).find(
        ([id, e]) => id !== selectedId && (e.state === "running" || e.state === "waiting")
      )?.[0]
    : undefined;

  const tabStyle = (name: string, enabled: boolean): CSSProperties =>
    uiTabStyle({ active: tab === name, enabled });

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
  else if (isRateLimited(ex))
    // Deliberately not a retry button. The run is holding a session and a
    // worktree it is going to continue in; starting a second one would abandon
    // both and duplicate the work — and the admission rule would refuse it
    // anyway until the quota is back.
    action = {
      label: "Waiting for usage limit", spinner: true, playIcon: false,
      onClick: (e) => { fireBoltFromEvent(e); setTab("execution"); },
      style: ctaButtonStyle("ghost"),
    };
  else if (st === "waiting")
    action = {
      label: "Needs you", spinner: false, playIcon: false,
      onClick: (e) => { fireBoltFromEvent(e); setTab("execution"); },
      style: ctaButtonStyle("ghost"),
    };
  else if (st === "succeeded")
    action = {
      label: "Show Result", spinner: false, playIcon: false,
      onClick: (e) => { fireBoltFromEvent(e); setTab("result"); },
      style: ctaButtonStyle("success"),
    };
  else if (st === "failed" && isFixReviewSkill(ex?.skill))
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
  if (st === "none" || st === "failed" || st === "cancelled")
    action.style.animation = "spinAngle 3s linear infinite, breathe 2.8s ease-in-out infinite";

  // Gate: a run can only start when the effective status maps to an action.
  // Exception: retrying a failed fix-code-review run (v2 or v3) is always valid —
  // it isn't driven by ticket status, so it must bypass the status-based gate.
  const isFixReviewRetry = st === "failed" && isFixReviewSkill(ex?.skill);
  const startsNewRun = st === "none" || st === "failed" || st === "cancelled";
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
  const showSecondaryAction = st === "succeeded" && !!actionInfo;
  const secondaryAction = showSecondaryAction
    ? { label: actionInfo!.label, onClick: (e?: MouseEvent) => startImplement(e), style: ctaButtonStyle("ghost") }
    : null;
  const secondaryCtaButtonStyle: CSSProperties = { ...ctaButtonStyle("ghost", { height: "38px" }), padding: "0 20px", fontSize: FONT.base, flex: "0 0 auto" };

  const bannerCtaStyle: CSSProperties = { ...action.style, height: "38px", padding: "0 20px", fontSize: FONT.base, flex: "0 0 auto" };
  const ctaTitle = blockedBySingleMode ? "Another ticket is running" : gated ? "No action for this status" : st === "succeeded" ? "Implementation complete" : st === "failed" ? "Last run failed" : st === "running" ? "Claude Code is working…" : actionInfo?.label === "Review Code" ? "Ready for review" : "Ready to implement";
  const ctaSub = t
    ? blockedBySingleMode ? `Ticket #${busyOtherTicketId} is currently running. Multi-ticket mode is off — finish or cancel it first.`
      : gated ? `This ticket is "${effStatus}". Move it to "Ready for Dev", "In Progress", or "Code Review" to enable a run.`
      : st === "succeeded" ? "Open the Result tab to review what Claude changed."
        : st === "failed" ? "Fix the blocker below, then retry the run."
          : st === "running" ? "Watch the execution stream on the Execution tab."
            : `Claude Code will cd into the repo and run ${getSkill(t)} for ${getArea(t)}.`
    : "";

  // Steps come from the graph the run is walking. Before a run exists we draw
  // the outline of the graph the chosen skill *would* walk, fetched once from
  // /api/graphs — either way the step list has exactly one source of truth.
  const skillForSteps = ex?.skill ?? (t ? getSkill(t) : undefined);
  const outline = skillForSteps ? graphOutlines[skillForSteps] ?? [] : [];
  const runNodes = ex?.nodes?.length ? ex.nodes : undefined;
  const stepSource: { id: string; label: string; state: NodeView["state"] }[] = runNodes
    ? runNodes.map((n) => ({ id: n.id, label: n.label, state: n.state }))
    : outline.map((n) => ({ id: n.id, label: n.label, state: "pending" as const }));

  const steps: StepView[] = stepSource.map((n, i) => {
    // A finished run marks every node it actually walked as done; nodes it never
    // reached stay pending rather than pretending to have succeeded.
    const sst: "pending" | "active" | "done" | "failed" =
      n.state === "done" ? "done" : n.state === "failed" ? "failed" : n.state === "running" ? "active" : "pending";
    const last = i === stepSource.length - 1;
    const db: CSSProperties = {
      position: "relative", width: "24px", height: "24px", borderRadius: "50%",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-mono), monospace", fontSize: FONT.xs, fontWeight: 600, flex: "0 0 auto",
      transition: "background .3s, border-color .3s, color .3s",
    };
    let dotStyle: CSSProperties;
    if (sst === "done") dotStyle = { ...db, background: "rgba(53,214,164,.14)", border: "1px solid var(--te-success)", color: "var(--te-success)" };
    else if (sst === "active") dotStyle = { ...db, background: "rgba(245,179,65,.12)", border: "1px solid var(--te-warning)", color: "var(--te-warning)" };
    else if (sst === "failed") dotStyle = { ...db, background: "rgba(255,107,107,.14)", border: "1px solid var(--te-danger)", color: "var(--te-danger)" };
    else dotStyle = { ...db, background: "transparent", border: "1px solid var(--te-btn-outline-border)", color: "var(--te-faint)" };
    const connectorStyle: CSSProperties =
      sst === "done"
        ? { width: "2px", height: last ? "0px" : "20px", margin: "3px 0", borderRadius: "2px", background: "linear-gradient(var(--te-success), rgba(53,214,164,.12))", backgroundSize: "100% 200%", animation: "flow 1.3s linear infinite" }
        : { width: "2px", height: last ? "0px" : "20px", margin: "3px 0", background: "var(--te-border)" };
    const labelStyle: CSSProperties = {
      fontSize: FONT.base, paddingBottom: last ? "0" : "20px", lineHeight: "1.3", paddingTop: "3px",
      color: sst === "done" ? "var(--te-text-soft)" : sst === "active" ? "var(--te-text)" : sst === "failed" ? "#FF8F8F" : "var(--te-faint)",
      fontWeight: sst === "active" ? 600 : 500,
    };
    return { label: n.label, num: i + 1, dotStyle, connectorStyle, labelStyle, showCheck: sst === "done", showSpinner: sst === "active", showX: sst === "failed", showNum: sst === "pending" };
  });

  const kindColor: Record<string, string> = {
    cmd: ACCENT, step: "var(--te-text)", ok: "var(--te-success)", muted: "var(--te-text-muted)", file: "var(--te-indigo)",
    diff: "var(--te-text-dim)", err: "var(--te-danger)", fail: "var(--te-danger)", done: "var(--te-success)",
  };
  const logLines = (ex ? ex.logLines : []).map((l, i) => ({
    text: l.text, num: i + 1,
    style: {
      color: kindColor[l.kind] || "var(--te-text-soft)",
      fontWeight: (l.kind === "cmd" || l.kind === "done" || l.kind === "fail" ? 600 : 400) as number,
      whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const, flex: 1, animation: "lineIn .3s ease-out both",
    } as CSSProperties,
  }));
  // Same palette, same shape — the Ask panel is a terminal too, and a second
  // mapping would be a second place for a log line to look different.
  const askLogLines = (ask?.logLines ?? []).map((l, i) => ({
    text: l.text, num: i + 1,
    style: {
      color: kindColor[l.kind] || "var(--te-text-soft)",
      fontWeight: (l.kind === "cmd" ? 600 : 400) as number,
      whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const, flex: 1, animation: "lineIn .3s ease-out both",
    } as CSSProperties,
  }));
  const logStatusMap: Record<UiRunState, [string, string]> = {
    running: ["running", "var(--te-warning)"], waiting: ["your review", "var(--te-indigo)"], succeeded: ["done", "var(--te-success)"],
    failed: ["failed", "var(--te-danger)"], cancelled: ["cancelled", "var(--te-faint)"], none: ["idle", "var(--te-faint)"],
  };
  const [lsl, lsc] = logStatusMap[st];
  const logStatusStyle: CSSProperties = {
    letterSpacing: ".1em", textTransform: "uppercase",
    ...pill({ color: lsc, background: "rgba(255,255,255,.04)", border: lsc + "55", size: "xs", weight: 700 }),
    padding: "2px 9px",
  };

  const selProject = t ? getArea(t) : "";
  const selBranch = t ? branchOf(t.id, t.title) : "";
  const selCommand = t ? `/${getSkill(t)} Ticket: ${t.url || t.id} - Project name: ${getArea(t)}` : "";
  const selCdCommand = t ? `cd ${getRootRepo(t) || "<set ROOT REPO>"} && claude --model ${getModel(t)} --effort ${getEffort(t)}` : "";
  const selExecPillStyle: CSSProperties = pill({ color: RUN_COLOR[st], background: "rgba(255,255,255,.03)", border: RUN_COLOR[st] + "44", size: "md", weight: 600 });

  // Split the result into per-skill sections (Implementation / Code Review),
  // one section per completed run this ticket has been through (not just the
  // latest of each skill) — sourced from history so it survives page reloads.
  const completedRuns = (t ? history[t.id] : undefined)?.filter((r) => r.state === "succeeded" && r.resultText) ?? [];
  const runsPerSkill = completedRuns.reduce<Record<string, number>>((acc, r) => {
    acc[r.skill] = (acc[r.skill] ?? 0) + 1;
    return acc;
  }, {});
  const resultSections: ResultSection[] = completedRuns
    .map((r) => ({
      key: r.id,
      skill: r.skill,
      title: runsPerSkill[r.skill] > 1
        ? `${RESULT_SKILL_TITLE[r.skill] || r.skill} — ${new Date(r.startedAt).toLocaleString()}`
        : RESULT_SKILL_TITLE[r.skill] || r.skill,
      markdown: r.resultText!,
      filesChanged: r.filesChanged ?? [],
    }))
    .sort((a, b) => RESULT_SKILL_ORDER.indexOf(a.skill) - RESULT_SKILL_ORDER.indexOf(b.skill));

  const EMPTY_REVIEW: ReviewData = { pr: null, comments: [], unresolvedCount: 0 };
  const ticketReview: ReviewData = t ? reviews[t.id] ?? EMPTY_REVIEW : EMPTY_REVIEW;
  const fixReviewRunning = (st === "running" || st === "waiting") && isFixReviewSkill(ex?.skill);
  const fixReviewDisabled = ticketReview.unresolvedCount === 0 || (st === "running" && !fixReviewRunning);
  const showResultSectionHeader = resultSections.length > 1;
  const showResult = tab === "result" && resultSections.length > 0;

  // active provider metadata drives Settings field labels + placeholders
  const pm = providerMeta(settings.provider);

  return (
    <div
      style={{
        position: "relative", height: "var(--te-app-h)", width: "100%", display: "flex", flexDirection: "column",
        background: "transparent", color: "var(--te-text)", fontFamily: "var(--te-font-ui)",
        overflow: "hidden", ["--accent" as string]: ACCENT,
      }}
    >
      <AppHeader
        pm={pm}
        scope={scope}
        onScopeChange={onScopeChange}
        // The picked sprint's *name* wins over whatever the ticket load echoed
        // back: the chip is a name, and the value sent to load those tickets is
        // a rooted iteration path. Falls back to the echo only when nothing is
        // picked — which is the case the echo exists for.
        sprintLabel={selectedSprint || sprintLabel}
        sprintOptions={sprintOptions}
        selectedSprint={selectedSprint}
        currentSprint={currentSprint}
        onSprintChange={onSprintChange}
        projectOptions={projectList}
        selectedProject={selectedProject}
        onSelectProject={onSelectProject}
        activeCount={activeCount}
      />

      <div className="te-split" data-pane={mobilePane} style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", minHeight: 0 }}>
        <TicketSidebar
          tickets={tickets}
          filtered={filtered}
          scope={scope}
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
          fPlanned={fPlanned}
          setFPlanned={setFPlanned}
          statusOptions={statusOptions}
          typeOptions={typeOptions}
          assigneeOptions={assigneeOptions}
          plannedOptions={PLANNED_OPTIONS}
          plannedOrder={plannedOrder}
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
        <main className="te-pane-detail" style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: "var(--te-page-veil)" }}>
          {!t ? (
            <div style={{ margin: "auto" }}>{loading ? <LoadingRing size={140} /> : <span style={{ color: "var(--te-faint)", fontSize: FONT.md }}></span>}</div>
          ) : (
            <>
              <TicketDetailHeader
                ticket={t}
                effStatus={effStatus}
                projectName={selProject}
                state={st}
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
                onBack={() => setMobilePane("list")}
                tab={tab}
                setTab={setTab}
                tabStyle={tabStyle}
                execEnabled={execEnabled}
                planEnabled={planEnabled}
                resultEnabled={resultEnabled}
                unresolvedCount={ticketReview.unresolvedCount}
                action={action}
                gated={gated}
                secondaryAction={secondaryAction}
              />

              <div className="te-scroll te-scroll--smooth te-main" style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", minHeight: 0, padding: "24px 28px 44px" }}>
                <motion.div
                  key={`${t.id}:${tab}`}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ease: MOTION.easeExpo, duration: MOTION.nav }}
                >
                {tab === "overview" && (
                  <OverviewTab
                    ticket={t}
                    comments={comments[t.id] ?? []}
                    translations={translations}
                    translating={translating}
                    onTranslateComment={translateComment}
                    reacting={reacting}
                    posting={postingComment}
                    onToggleReaction={(commentId, kind, on) => toggleReaction(t.id, commentId, kind, on)}
                    draft={commentDrafts[t.id] ?? ""}
                    onDraftChange={(v) => setCommentDrafts((d) => ({ ...d, [t.id]: v }))}
                    onPostComment={() => postComment(t.id)}
                    onSearchMentions={searchMentions}
                    onAddMention={(m) => setCommentMentions((all) => {
                      const list = all[t.id] ?? [];
                      return list.some((x) => x.id === m.id) ? all : { ...all, [t.id]: [...list, m] };
                    })}
                    history={history[t.id] ?? []}
                    onOpenRun={openRun}
                    rootRepo={getRootRepo(t)}
                    rootRepoSaved={!!getRootRepo(t).trim() && savedMapping[getArea(t)] === getRootRepo(t).trim()}
                    savingRootRepo={savingRootRepo}
                    onSaveRootRepo={() => saveRootRepo(t)}
                    project={getArea(t)}
                    skill={getSkill(t)}
                    model={getModel(t)}
                    modelOptions={modelOptions}
                    effort={getEffort(t)}
                    setOverrideValue={setOverrideValue}
                    onProjectChange={onProjectChange}
                    rootRepoOptions={rootRepoOptions}
                    projectOptions={projectOptions}
                    skillOptions={mergedSkillOptions}
                    branch={selBranch}
                    cdCommand={selCdCommand}
                    command={selCommand}
                    onOpenTerminal={() => openTerminal(t.id, getRootRepo(t))}
                    ctaTitle={ctaTitle}
                    ctaSub={ctaSub}
                    action={action}
                    gated={gated}
                    bannerCtaStyle={bannerCtaStyle}
                    secondaryAction={secondaryAction}
                    addingToPlan={addingToPlan}
                    onAddToReleasePlan={() => addToReleasePlan(t)}
                    secondaryCtaButtonStyle={secondaryCtaButtonStyle}
                  />
                )}

                {tab === "execution" && (
                  <ExecutionTab
                    steps={steps}
                    logLines={logLines}
                    logRef={logRef}
                    projectName={selProject}
                    state={st}
                    statusLabel={lsl}
                    logStatusStyle={logStatusStyle}
                    error={ex?.error}
                    knowledge={ex?.knowledgeChange}
                  />
                )}

                {tab === "plan" && ex && (
                  <PlanTab plan={ex.planMarkdown ?? ""} />
                )}

                {tab === "resolve-review" && (
                  <ResolveReviewTab
                    review={ticketReview}
                    loading={!!(t && reviewsLoading[t.id]) && !reviews[t.id]}
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

                {tab === "ask" && (
                  <AskTab
                    rootRepo={getRootRepo(t)}
                    logLines={askLogLines}
                    state={ask?.state ?? "idle"}
                    resuming={!!ask?.resuming}
                    error={ask?.error ?? ""}
                    prompt={askPrompts[t.id] ?? ""}
                    skillOptions={mergedSkillOptions}
                    onPromptChange={(v) => setAskPrompts((s) => ({ ...s, [t.id]: v }))}
                    model={getModel(t)}
                    modelOptions={modelOptions}
                    effort={getEffort(t)}
                    onModelChange={(v) => setOverrideValue(t.id, "model", v)}
                    onEffortChange={(v) => setOverrideValue(t.id, "effort", v)}
                    onSend={() => sendAsk(t.id, getRootRepo(t), getModel(t), getEffort(t))}
                    onCancel={() => stopAsk(t.id)}
                    onReset={() => clearAsk(t.id)}
                    logRef={askLogRef}
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
                </motion.div>
              </div>
            </>
          )}
        </main>
      </div>

      {diffFile && <DiffModal file={diffFile} onClose={() => setDiffFile(null)} />}

      {openCommit && (
        <CommitFilesModal
          commit={openCommit}
          files={commitFiles}
          onClose={() => { setOpenCommit(null); setCommitFiles(null); }}
        />
      )}
    </div>
  );
}
