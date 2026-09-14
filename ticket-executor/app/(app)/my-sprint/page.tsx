"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import LoadingRing from "../../ticket-executor/LoadingRing";
import SelectMenu from "../../SelectMenu";
import { useBoltsContext } from "../../BoltsContext";
import {
  COLORS,
  FONT,
  card,
  ctaButtonStyle,
  fieldInput,
  fieldLabel,
  pill,
  sectionCaption,
  statusPill,
  tintedCard,
} from "@/lib/ui";
import ProviderBadge from "../ProviderBadge";
import TriageReport from "./TriageReport";
import PageHeading from "../PageHeading";
import NotificationCenter from "../NotificationCenter";
import PageToolbar from "../PageToolbar";
import { CONNECTION_CHANGED_EVENT } from "../../connectionEvents";
import { usePagePrefs } from "../../pagePrefs";
import type { Claim } from "@/lib/sprintClaim";
import type { Lane, PlanConfig, SprintPlanResult } from "@/lib/sprintPlan";
import type { Ticket } from "@/lib/types";
import type { TriagedTicket } from "@/lib/execution/triage";

// The developer's own view of one iteration: what they are carrying, whether it
// fits, what an agent thinks of it, and which day each finished ticket is handed
// to a reviewer.
//
// Every number here is computed server-side (`lib/sprintPlan.ts`) and every
// action calls the same code the scheduler does. This page never decides
// anything on its own — that is what keeps the plan on the screen and the plan
// the machine acts on the same plan.

type MySprint = {
  configured: boolean;
  notice?: string;
  error?: string;
  identity?: { email: string; name: string };
  sprint?: string;
  window?: { startDate: string; finishDate: string };
  today?: string;
  teamTicketCount?: number;
  includeWider?: boolean;
  /** Whether the search past the iteration actually ran — it is skipped for a
   *  provider with no iterations and for a connection with no identity. */
  widened?: boolean;
  /** How many of the developer's tickets came from outside the iteration. */
  outsideCount?: number;
  truncated?: boolean;
  tickets?: Ticket[];
  claimed?: { ticket: Ticket; claim: Claim; assigneeNow: string; fromPlan: boolean }[];
  plan: SprintPlanResult | null;
  config: PlanConfig;
};

type TriageRow = {
  id: string;
  status: "running" | "succeeded" | "failed";
  result: { summary?: string; finalNotes?: string[]; tickets?: TriagedTicket[] };
  errorMessage: string;
  costUsd: number;
};

type PlannedRow = {
  id: string;
  ticketId: string;
  title: string;
  implementOrder: number;
  points: number;
  estimateHours: number;
  releaseDay: string;
  blocked: boolean;
  unblockedByUser: boolean;
  implementState: string;
  runId: string;
  prUrl: string;
  prPublished: boolean;
  reviewersSet: boolean;
  statusMoved: boolean;
  releasedAt: string | null;
  releaseError: string;
  reviewState: string;
  reviewRunId: string;
  openComments: number;
  threadsReplied: number;
  threadsResolved: number;
  reviewRounds: number;
  reviewError: string;
  claim: Claim;
  assigneeNow: string;
};

type StoredPlan = {
  id: string;
  status: "draft" | "active" | "archived";
  autoImplement: boolean;
  autoRelease: boolean;
  autoResolveReview: boolean;
  includeWider: boolean;
  reviewers: string[];
  pointsPerDay: number;
  items: PlannedRow[];
};

type AutomationRow = {
  id: string;
  ticketId: string;
  action: string;
  outcome: string;
  reason: string;
  detail: string;
  createdAt: string;
};

const LANE_LABEL: Record<Lane, string> = {
  todo: "To do",
  doing: "In progress",
  review: "In review",
  done: "Done",
};

const LANE_COLOR: Record<Lane, string> = {
  todo: COLORS.textDim,
  doing: COLORS.accent,
  review: COLORS.indigo,
  done: COLORS.success,
};

const VERDICT: Record<string, { color: string; label: string }> = {
  "on-track": { color: COLORS.success, label: "On track" },
  tight: { color: COLORS.warning, label: "Tight" },
  "over-committed": { color: COLORS.danger, label: "Over-committed" },
  "no-calendar": { color: COLORS.accent, label: "No sprint dates" },
};

// `means` is the answer to "what does this ticket still need?", which the label
// alone never gives — "Ready · notes" in particular reads like a half-verdict
// until you know it is startable today. It is the pill's tooltip here and a
// legend in the full report.
const READINESS: Record<string, { color: string; label: string; means: string }> = {
  ready: { color: COLORS.success, label: "Ready", means: "Nothing is missing — start it as it stands." },
  "ready-with-notes": {
    color: COLORS.info,
    label: "Ready · notes",
    means: "Startable today, nobody has to answer anything. The notes are context to carry into the work — open the full report.",
  },
  "needs-clarification": {
    color: COLORS.warning,
    label: "Needs clarification",
    means: "A person has to answer something first. The scheduler will not run it until it is cleared.",
  },
  blocked: {
    color: COLORS.danger,
    label: "Blocked",
    means: "Work cannot start at all — a missing dependency, or a contradiction only the client can resolve.",
  },
};

// Where the developer's claim on a ticket stands. `mine` has no pill: the row's
// own status and state columns say everything, and a badge on every ordinary
// ticket would only make the two exceptions harder to spot.
const CLAIM: Record<Claim, { color: string; label: string }> = {
  mine: { color: COLORS.textDim, label: "Mine" },
  "handed-off": { color: COLORS.info, label: "Handed off" },
  dropped: { color: COLORS.textDim, label: "Left sprint" },
};

const IMPLEMENT_STATE: Record<string, { color: string; label: string }> = {
  pending: { color: COLORS.textDim, label: "Queued" },
  running: { color: COLORS.accent, label: "Running" },
  implemented: { color: COLORS.indigo, label: "Draft PR" },
  failed: { color: COLORS.danger, label: "Failed" },
  skipped: { color: COLORS.faint, label: "Skipped" },
};

/**
 * What the State column says about one row.
 *
 * Release is not a value of `implementState` — the engine stops at
 * "implemented" and `releasePlannedTicket()` records what it did in its own
 * three columns — so reading `implementState` alone leaves a released ticket
 * labelled "Draft PR" forever, next to a pull request that is no longer a draft.
 *
 * The release columns therefore come first, and the partial case gets its own
 * label rather than being rounded to one of the two ends: a pull request that
 * was published but whose work item never moved is a real state somebody has to
 * finish by hand, and calling it either "Draft PR" or "Released" hides that.
 */
function stateOf(t: PlannedRow): { color: string; label: string } {
  if (t.releasedAt) return { color: COLORS.success, label: "Released" };
  if (t.prPublished) return { color: COLORS.warning, label: "In review" };
  return IMPLEMENT_STATE[t.implementState] ?? IMPLEMENT_STATE.pending;
}

/**
 * What the Review column says about one row.
 *
 * A column of its own rather than another branch inside `stateOf()`. The two
 * answer questions about different moments and both stay true at once: a
 * released ticket whose review is being resolved is still released, and folding
 * the second fact into the first is exactly the mistake that left a released
 * ticket reading "Draft PR" until State was split from the release columns.
 *
 * `spin` is the live half. A pill alone cannot say whether "Fixing" is this
 * second or a stale row, which is the same reason the State column carries one.
 */
function reviewOf(t: PlannedRow): { color: string; label: string; spin: boolean } | null {
  // Nothing is under review until a reviewer has been told there is something to
  // review. Before release the pull request is a draft nobody has been sent.
  if (!t.prPublished) return null;
  switch (t.reviewState) {
    case "running":
      return { color: COLORS.accent, label: "Fixing", spin: true };
    case "failed":
      return { color: COLORS.danger, label: "Fix failed", spin: false };
    case "needs-human":
      return { color: COLORS.warning, label: "Needs you", spin: false };
    case "resolved":
      return {
        color: t.openComments > 0 ? COLORS.warning : COLORS.success,
        // Replied and resolved are different numbers on purpose: the skill
        // deliberately answers threads it will not act on, and a row claiming to
        // have resolved everything would hide the ones left for a person.
        label: `Fixed ${t.threadsResolved}/${t.threadsReplied}`,
        spin: false,
      };
    default:
      return t.openComments > 0
        ? { color: COLORS.warning, label: `${t.openComments} open`, spin: false }
        : { color: COLORS.textDim, label: "Clean", spin: false };
  }
}

const hours = (h: number) => (Math.round(h * 10) / 10).toString() + "h";

/** "Mon 07 Sep" — the weekday is the part a release calendar is read for. */
function dayLabel(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00.000Z");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}

// The triage column carries the override control next to its verdict, so it is
// the one that has to fit two things rather than one.
const GRID = "44px 1fr 60px 68px 132px 106px 104px 104px 176px";

/**
 * Where a ticket actually lives, when that is not the iteration on screen.
 *
 * Read off the provider's iteration path rather than off which query returned
 * the row: the path is what the developer sees in the tracker, and it is the
 * only thing that separates "not scheduled at all" (the path is still the
 * project root) from "parked in another sprint".
 *
 * Empty for a ticket that is in this iteration — the common case earns no badge.
 */
function originLabel(iterationPath: string | undefined, sprint: string): string {
  const segments = (iterationPath ?? "").split("\\").filter(Boolean);
  if (segments.length === 0) return "";
  if (segments.length === 1) return "Backlog";
  const leaf = segments[segments.length - 1];
  return leaf === sprint ? "" : leaf;
}

export default function MySprintPage() {
  const router = useRouter();
  const { fireBoltFromEvent } = useBoltsContext();
  // On by default: an assigned ticket the iteration does not contain is the
  // normal case, so the narrow view is the one worth opting into.
  const { prefs, ready: prefsReady, save: savePrefs } = usePagePrefs<{
    project: string;
    sprint: string;
    includeWider: boolean;
  }>("my-sprint", { project: "", sprint: "", includeWider: true });
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState("");
  const [sprints, setSprints] = useState<string[]>([]);
  const [sprint, setSprint] = useState("");
  const [includeWider, setIncludeWider] = useState(true);
  const [data, setData] = useState<MySprint | null>(null);
  const [triage, setTriage] = useState<TriageRow | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [stored, setStored] = useState<StoredPlan | null>(null);
  const [events, setEvents] = useState<AutomationRow[]>([]);
  const [reviewers, setReviewers] = useState("");
  // The checkout this project is triaged against. Editable here because the
  // mapping was otherwise only ever learned by running a ticket by hand, which
  // left every project the developer has not run yet with no way to be
  // scheduled at all and a weaker triage than it could have had.
  const [rootRepo, setRootRepo] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const triagePoll = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const r = await fetch("/api/projects");
      const d = await r.json();
      const names: string[] = Array.isArray(d.projects) ? d.projects.map((p: { name: string }) => p.name) : [];
      setProjects(names);
      // A remembered project only survives if this organization still has it.
      setProject((cur) => (cur && names.includes(cur) ? cur : names[0] || ""));
    } catch {
      setProjects([]);
    }
  }, []);

  const loadSprints = useCallback(async (proj: string) => {
    if (!proj) { setSprints([]); return; }
    try {
      const r = await fetch("/api/sprints?project=" + encodeURIComponent(proj));
      const d = await r.json();
      const names: string[] = Array.isArray(d.sprints) ? d.sprints.map((s: { name: string }) => s.name) : [];
      setSprints(names);
      setSprint((cur) => (cur && names.includes(cur) ? cur : d.current || ""));
    } catch {
      setSprints([]);
    }
  }, []);

  const load = useCallback(async (proj: string, spr: string, wider: boolean) => {
    if (!proj) { setLoading(false); return; }
    setLoading(true);
    setError("");
    const qs = new URLSearchParams({ project: proj, wider: wider ? "1" : "0" });
    if (spr) qs.set("sprint", spr);
    try {
      // Three independent reads: the computed preview, whatever plan is stored,
      // and the newest triage. Parallel because none of them needs the others.
      const [sprintRes, planRes, triageRes] = await Promise.all([
        fetch("/api/my-sprint?" + qs.toString()).then((r) => r.json()),
        fetch("/api/my-sprint/plan?" + qs.toString()).then((r) => r.json()),
        fetch("/api/my-sprint/triage?" + qs.toString()).then((r) => r.json()),
      ]);
      if (sprintRes.error) setError(sprintRes.error);
      setData(sprintRes);
      setStored(planRes.plan ?? null);
      setEvents(Array.isArray(planRes.events) ? planRes.events : []);
      setTriage(triageRes.triage ?? null);
      setReviewers((planRes.plan?.reviewers ?? []).join(", "));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!project) { setRootRepo(""); return; }
    let live = true;
    fetch("/api/options/mapping?project=" + encodeURIComponent(project))
      .then((r) => r.json())
      .then((d) => { if (live) setRootRepo(d.rootRepo ?? ""); })
      .catch(() => { if (live) setRootRepo(""); });
    return () => { live = false; };
  }, [project]);

  // Nothing loads until the remembered controls are in hand: starting on the
  // first project and switching to the remembered one a moment later is two
  // round-trips for one answer, and it is the flicker this page had.
  useEffect(() => {
    if (!prefsReady) return;
    setProject(prefs.project);
    setSprint(prefs.sprint);
    setIncludeWider(prefs.includeWider);
  }, [prefsReady, prefs]);

  useEffect(() => { if (prefsReady) loadProjects(); }, [prefsReady, loadProjects]);
  useEffect(() => { if (prefsReady) loadSprints(project); }, [prefsReady, project, loadSprints]);
  useEffect(() => { if (prefsReady) load(project, sprint, includeWider); }, [prefsReady, project, sprint, includeWider, load]);

  // Remember what is on screen, but never a value the page has not resolved yet
  // — writing the empty project of a still-loading page would erase the choice.
  useEffect(() => {
    if (!prefsReady || !project) return;
    savePrefs({ project, sprint, includeWider });
  }, [prefsReady, project, sprint, includeWider, savePrefs]);

  // A different organization: `usePagePrefs` re-hydrates to that organization's
  // remembered project, and the seeding effect above applies it.
  useEffect(() => {
    const onChanged = () => { loadProjects(); };
    window.addEventListener(CONNECTION_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONNECTION_CHANGED_EVENT, onChanged);
  }, [loadProjects]);

  // A triage turn outlives the request that started it, so the row is polled
  // rather than awaited.
  useEffect(() => {
    if (triage?.status !== "running") {
      if (triagePoll.current) { clearInterval(triagePoll.current); triagePoll.current = null; }
      return;
    }
    triagePoll.current = setInterval(async () => {
      try {
        const r = await fetch("/api/my-sprint/triage?id=" + encodeURIComponent(triage.id));
        const d = await r.json();
        if (d.triage) setTriage(d.triage);
      } catch { /* the next tick tries again */ }
    }, 5000);
    return () => { if (triagePoll.current) clearInterval(triagePoll.current); };
  }, [triage?.status, triage?.id]);

  // A run outlives the request that started it exactly the way triage does, so
  // a plan holding a running ticket is re-read until it stops — that is what
  // keeps the "implementing now" label and the State column live.
  const anyRunning = (stored?.items ?? []).some((t) => t.implementState === "running");
  useEffect(() => {
    if (!anyRunning || !project) return;
    const qs = new URLSearchParams({ project, wider: includeWider ? "1" : "0" });
    if (sprint) qs.set("sprint", sprint);
    const id = setInterval(async () => {
      try {
        const d = await fetch("/api/my-sprint/plan?" + qs.toString()).then((r) => r.json());
        if (d.plan) setStored(d.plan);
        if (Array.isArray(d.events)) setEvents(d.events);
      } catch { /* the next tick tries again */ }
    }, 5000);
    return () => clearInterval(id);
  }, [anyRunning, project, sprint, includeWider]);

  const post = async (url: string, body: unknown, method = "POST") => {
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "The request failed.");
    return d;
  };

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  // Only a non-empty path is written: there is no unmap, and an emptied box must
  // not be mistaken for "this project has no repo" by the scheduler.
  const saveRootRepo = () => {
    const value = rootRepo.trim();
    if (!project || !value) return;
    post("/api/options/mapping", { project, rootRepo: value }).catch(() => { /* the next blur retries */ });
  };

  const runTriage = () =>
    act("triage", async () => {
      const d = await post("/api/my-sprint/triage", { project, sprint, includeWider });
      setTriage({ id: d.id, status: "running", result: {}, errorMessage: "", costUsd: 0 });
    });

  const buildPlan = () =>
    act("plan", async () => {
      const d = await post("/api/my-sprint/plan", {
        project,
        sprint,
        includeWider,
        pointsPerDay: data?.config.pointsPerDay,
        hoursPerDay: data?.config.hoursPerDay,
        reviewers: reviewers.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setStored(d.plan);
      setMessage(d.usedTriage ? "Plan rebuilt from the latest triage." : "Plan rebuilt. Run triage to order it by readiness.");
    });

  const patchPlan = (body: Record<string, unknown>, label: string) =>
    act(label, async () => {
      const d = await post("/api/my-sprint/plan", { id: stored?.id, ...body }, "PATCH");
      setStored(d.plan);
    });

  // Override triage on one ticket. Addressed by planned-ticket id, so it does
  // not go through `patchPlan` — that one always sends the plan id.
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

  const releaseNow = (plannedId: string) =>
    act("release-" + plannedId, async () => {
      const d = await post("/api/my-sprint/plan", { release: plannedId }, "PUT");
      if (d.plan) setStored(d.plan);
      setMessage(d.outcome?.detail || "");
      if (d.outcome && !d.outcome.ok) setError(d.outcome.error || "The release did not complete.");
    });

  const retryNow = (plannedId: string) =>
    act("retry-" + plannedId, async () => {
      const d = await post("/api/my-sprint/plan", { retry: plannedId }, "PUT");
      if (d.plan) setStored(d.plan);
      if (d.outcome && !d.outcome.ok) setError(d.outcome.error || "This ticket could not be requeued.");
      else setMessage("Back in the queue — the scheduler starts it on its next pass.");
    });

  const resolveReviewNow = (plannedId: string) =>
    act("fixreview-" + plannedId, async () => {
      const d = await post("/api/my-sprint/plan", { resolveReview: plannedId }, "PUT");
      if (d.plan) setStored(d.plan);
      if (d.outcome && !d.outcome.ok) setError(d.outcome.error || "The review fix did not start.");
      else setMessage("Resolving the review comments on this pull request.");
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
      await load(project, sprint, includeWider);
    });

  // The one destination for "what is this ticket doing?" — the same screen and
  // the same two parameters the bell pushes, so a row and a notification land
  // in the same place.
  const openExecution = (ticketId: string, tab: "execution" | "result") =>
    router.push(
      `/ticket-execution?ticket=${encodeURIComponent(ticketId)}&tab=${tab}` +
        (project ? `&project=${encodeURIComponent(project)}` : "") +
        `&at=${Date.now()}`
    );

  const summary = data?.plan?.summary ?? null;
  const verdict = summary ? VERDICT[summary.verdict] : null;
  const triaged = new Map<string, TriagedTicket>(
    (triage?.result?.tickets ?? []).map((t) => [String(t.id), t])
  );
  // The stored plan wins once it exists: it is what the scheduler acts on. The
  // computed preview only fills the gap before a plan has ever been built.
  const rows: PlannedRow[] =
    stored?.items?.length
      ? stored.items
      : (data?.plan?.tickets ?? []).map((t) => ({
          id: "", ticketId: t.ticketId, title: t.title, implementOrder: t.implementOrder,
          points: t.points, estimateHours: t.estimateHours, releaseDay: t.releaseDay,
          blocked: t.blocked, unblockedByUser: false, implementState: "pending", runId: "", prUrl: "",
          prPublished: false, reviewersSet: false, statusMoved: false, releasedAt: null, releaseError: "",
          reviewState: "idle", reviewRunId: "", openComments: 0, threadsReplied: 0, threadsResolved: 0,
          reviewRounds: 0, reviewError: "",
          claim: t.claim, assigneeNow: t.assigneeNow,
        }));

  const runningRows = rows.filter((t) => t.implementState === "running");
  // The second lane. Kept apart from `runningRows` because the two are different
  // work on different tickets and the banner has to name which is which.
  const reviewingRows = rows.filter((t) => t.reviewState === "running");

  const tile = (label: string, value: string, sub?: string) => (
    <div style={{ ...card({ padding: "14px 16px" }), display: "flex", flexDirection: "column", gap: "6px" }}>
      <span style={sectionCaption()}>{label}</span>
      <span style={{ fontSize: FONT.xl, fontWeight: 800, color: COLORS.text, lineHeight: 1 }}>{value}</span>
      {sub && <span style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>{sub}</span>}
    </div>
  );

  const button = (
    label: string,
    variant: "primary" | "outline" | "ghost" | "warning" | "success",
    onClick: () => void,
    key: string,
    disabled = false
  ) => (
    <button
      onClick={(e) => { fireBoltFromEvent(e); onClick(); }}
      disabled={disabled || busy === key}
      style={{
        ...ctaButtonStyle(variant, { height: "30px", cornerPx: 7 }),
        flex: "0 0 auto",
        whiteSpace: "nowrap",
        padding: "0 11px",
        cursor: disabled || busy === key ? "default" : "pointer",
      }}
    >
      {busy === key && <LoadingRing size={13} />}
      {label}
    </button>
  );

  return (
    <div style={{ position: "relative", height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column", color: COLORS.text, ["--accent" as string]: COLORS.accent }}>
      <header style={{ position: "relative", zIndex: 30, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "14px", padding: "0 28px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "rgba(14,17,23,.72)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <PageHeading title="My Sprint" kicker="D-AGENT · SPRINT PLAN" icon={<><path d="M8 2v4M16 2v4M3 10h18" /><path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>} />
        <div style={{ flex: 1 }} />
        <NotificationCenter />
        <ProviderBadge />
      </header>

      {/* Which sprint this page is about, and how wide it looks for the work. */}
      <PageToolbar>
        <div style={{ minWidth: "180px" }}>
          <SelectMenu value={project} onChange={(v) => { setProject(v); setSprint(""); }} options={projects} ariaLabel="Project" />
        </div>
        <div style={{ minWidth: "180px" }}>
          <SelectMenu value={sprint} onChange={setSprint} options={sprints} ariaLabel="Sprint" />
        </div>
        <button
          onClick={(e) => { fireBoltFromEvent(e); setIncludeWider((v) => !v); }}
          aria-pressed={includeWider}
          title="Also find tickets assigned to you that sit on the board or in the backlog instead of this iteration."
          style={{ ...ctaButtonStyle(includeWider ? "success" : "ghost", { height: "30px", cornerPx: 7 }), cursor: "pointer" }}
        >
          Board &amp; backlog {includeWider ? "ON" : "OFF"}
        </button>
      </PageToolbar>

      <main className="te-scroll" style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", padding: "28px", background: "linear-gradient(110deg,rgba(6,7,10,.5) 0%,rgba(6,7,10,.22) 52%,rgba(6,7,10,0) 100%)" }}>
        <div style={{ maxWidth: "1160px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>
          {loading ? (
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
                {error || "Pick a project to see your sprint."}
              </span>
            </div>
          ) : (
            <>
              {error && (
                <div style={tintedCard("danger")}>
                  <span style={{ fontSize: FONT.base, color: COLORS.danger, fontWeight: 600 }}>{error}</span>
                </div>
              )}
              {message && (
                <div style={tintedCard("accent")}>
                  <span style={{ fontSize: FONT.base, color: COLORS.text, fontWeight: 600 }}>{message}</span>
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ fontSize: FONT.lg, fontWeight: 700, color: COLORS.text }}>{data?.sprint || "Current sprint"}</span>
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
                  {summary.ticketCount} of {data?.teamTicketCount ?? 0} sprint tickets are yours
                  {(data?.outsideCount ?? 0) > 0 ? ` · ${data?.outsideCount} from the board or backlog` : ""}
                  {summary.handedOff.tickets > 0 ? ` · ${summary.handedOff.tickets} handed off` : ""}
                  {data?.identity?.name ? " · " + data.identity.name : ""}
                </span>
              </div>

              {/* Which ticket the agent has its hands on right now. The State
                  column says it per row, but the row is one of many and the
                  answer to "what is running?" should not have to be scanned
                  for. */}
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
                      {/* Named only when both lanes are live: with one lane the
                          heading above already says which, and repeating it per
                          row is noise. */}
                      {runningRows.length > 0 && reviewingRows.length > 0 && (
                        <span style={pill({ color: COLORS.textDim, size: "xs", weight: 700 })}>{lane}</span>
                      )}
                      {button("Watch run", "outline", () => openExecution(t.ticketId, "execution"), "watch-" + lane + t.ticketId)}
                    </span>
                  ))}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "14px" }}>
                {/* Scope first, and it is the sprint's headline for a reason: it is
                    the one number that must not fall when the developer succeeds.
                    "Still mine" is the number that shrinks, and it is supposed to. */}
                {tile(
                  "SPRINT SCOPE",
                  summary.ticketCount + " · " + summary.totalPoints + "pt",
                  summary.droppedCount > 0
                    ? summary.droppedCount + " left my plate"
                    : summary.unsizedCount > 0
                      ? summary.unsizedCount + " unsized"
                      : "all sized"
                )}
                {tile(
                  "STILL MINE",
                  summary.mine.tickets + " · " + summary.mine.points + "pt",
                  summary.remainingPoints + "pt left to deliver"
                )}
                {tile(
                  "HANDED OFF",
                  summary.handedOff.tickets + " · " + summary.handedOff.points + "pt",
                  summary.handedOff.tickets > 0 ? "delivered, with someone else" : "nothing yet"
                )}
                {tile("WORK LEFT", hours(summary.requiredHours), summary.workingDaysLeft + " working days")}
                {tile("CAPACITY", hours(summary.capacityHours), (data?.config.hoursPerDay ?? 8) + "h/day")}
                {tile(
                  summary.slackHours < 0 ? "SHORT BY" : "SLACK",
                  hours(Math.abs(summary.slackHours)),
                  summary.slackHours < 0 ? "does not fit the sprint" : "spare capacity"
                )}
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
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

              {/* ---- triage ---- */}
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

              {/* ---- automation ---- */}
              <div style={{ ...card({ padding: "16px" }), display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <span style={sectionCaption()}>PLAN &amp; AUTOMATION</span>
                  <div style={{ flex: 1 }} />
                  {button(stored ? "Rebuild plan" : "Build plan", "primary", buildPlan, "plan")}
                  {stored && stored.status !== "active"
                    ? button("Activate", "success", () => patchPlan({ status: "active" }, "activate"), "activate")
                    : stored
                      ? button("Pause", "warning", () => patchPlan({ status: "draft" }, "activate"), "activate")
                      : null}
                  {stored?.status === "active" && button("Run now", "outline", tickNow, "tick")}
                </div>

                <label style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "520px" }}>
                  <span style={fieldLabel()}>REVIEWERS (COMMA SEPARATED EMAILS)</span>
                  <input
                    value={reviewers}
                    onChange={(e) => setReviewers(e.target.value)}
                    onBlur={() => stored && patchPlan({ reviewers: reviewers.split(",").map((s) => s.trim()).filter(Boolean) }, "reviewers")}
                    placeholder="reviewer@company.com, lead@company.com"
                    autoComplete="off"
                    style={fieldInput()}
                  />
                </label>

                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {([
                    ["autoImplement", "Auto-implement", "Work down the queue without waiting to be asked."],
                    ["autoRelease", "Auto-release", "Hand finished work over on its release day."],
                    ["autoResolveReview", "Auto-resolve review", "Answer new review comments on released work without waiting to be asked."],
                  ] as const).map(([field, label, hint]) => {
                    const on = !!stored?.[field];
                    return (
                      <button
                        key={field}
                        onClick={(e) => { fireBoltFromEvent(e); if (stored) patchPlan({ [field]: !on }, field); }}
                        disabled={!stored}
                        title={hint}
                        style={{
                          ...ctaButtonStyle(on ? "success" : "ghost", { height: "30px", cornerPx: 7 }),
                          cursor: stored ? "pointer" : "default",
                        }}
                      >
                        {label} {on ? "ON" : "OFF"}
                      </button>
                    );
                  })}
                </div>

                <span style={{ fontSize: FONT.sm, color: COLORS.textDim, lineHeight: 1.6 }}>
                  The three are separate on purpose: working ahead is private and cheap to undo, releasing notifies a
                  reviewer and moves the work item, and resolving a review writes replies under your name on a pull
                  request somebody is already reading. Nothing is scheduled from a draft plan.
                </span>
              </div>

              {(data?.plan?.overflowPoints ?? 0) > 0 && (
                <div style={tintedCard("danger")}>
                  <span style={{ fontSize: FONT.base, color: COLORS.danger, fontWeight: 600 }}>
                    {data?.plan?.overflowPoints} points have no release day left in this sprint at{" "}
                    {stored?.pointsPerDay ?? data?.config.pointsPerDay} points/day. Re-order, re-estimate, or move work out.
                  </span>
                </div>
              )}

              {/* ---- the plan ---- */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={sectionCaption()}>
                  RELEASE PLAN · {stored?.pointsPerDay ?? data?.config.pointsPerDay} POINTS PER WORKING DAY
                </span>
                <div style={{ ...card({ padding: "0" }), overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: GRID, gap: "10px", padding: "10px 14px", borderBottom: "1px solid " + COLORS.borderSubtle }}>
                    {["#", "TICKET", "PTS", "EST.", "TRIAGE", "RELEASE", "STATE", "REVIEW", "ACTIONS"].map((h) => (
                      <span key={h} style={{ ...sectionCaption(), ...(h === "ACTIONS" ? { textAlign: "right" as const } : null) }}>{h}</span>
                    ))}
                  </div>
                  {rows.length === 0 ? (
                    <div style={{ padding: "18px 14px", fontSize: FONT.base, color: COLORS.textMuted }}>
                      {includeWider
                        ? "Nothing is assigned to you in this sprint, on the board, or in the backlog."
                        : "No tickets in this sprint are assigned to you — switch Board & backlog on to look wider."}
                    </div>
                  ) : (
                    rows.map((t, i) => {
                      // Looked up in `claimed`, not in `tickets`: `tickets` is
                      // only what is still the developer's, and a handed-off row
                      // would lose its link and its status.
                      const claimed = data?.claimed?.find((c) => c.ticket.id === t.ticketId);
                      const ticket = claimed?.ticket;
                      const claim = t.claim ?? claimed?.claim ?? "mine";
                      const assigneeNow = t.assigneeNow || claimed?.assigneeNow || "";
                      const tri = triaged.get(t.ticketId);
                      const origin = originLabel(ticket?.iterationPath, data?.sprint ?? "");
                      const state = stateOf(t);
                      const review = reviewOf(t);
                      const due = !!t.prUrl && t.implementState === "implemented" && !t.releasedAt;
                      // Only a ticket triage stopped, still the developer's, and
                      // still waiting to start, has an override worth offering.
                      const canOverride = t.blocked && claim === "mine" && t.implementState === "pending";
                      return (
                        <div
                          key={t.ticketId}
                          style={{
                            display: "grid", gridTemplateColumns: GRID, gap: "10px",
                            padding: "11px 14px", alignItems: "center",
                            borderTop: i === 0 ? "none" : "1px solid " + COLORS.borderSubtle,
                            // A dropped ticket is kept so the change is visible,
                            // not so it competes for attention.
                            opacity: claim === "dropped" ? 0.55 : 1,
                            animation: "fadeUp .4s both", animationDelay: i * 30 + "ms",
                          }}
                        >
                          <span style={{ fontSize: FONT.sm, fontWeight: 700, color: t.implementOrder ? COLORS.accent : COLORS.faint }}>
                            {t.implementOrder || "—"}
                          </span>
                          <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                            <a
                              href={t.prUrl || ticket?.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{ fontSize: FONT.base, color: COLORS.text, fontWeight: 600, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            >
                              #{t.ticketId} · {t.title}
                            </a>
                            {origin && (
                              // Named rather than flagged: "Backlog" and "Sprint
                              // 66" are different problems, and a developer
                              // deciding what to work on needs to know which.
                              <span style={pill({ color: COLORS.indigo, size: "xs", weight: 700 })}>{origin}</span>
                            )}
                            {tri?.reason && (
                              <span style={{ fontSize: FONT.sm, color: COLORS.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {tri.reason}
                              </span>
                            )}
                            {claim !== "mine" && (
                              <span style={{ fontSize: FONT.sm, color: COLORS.textDim }}>
                                {claim === "handed-off"
                                  ? assigneeNow
                                    ? "handed off — now with " + assigneeNow
                                    : "handed off — no longer in your sprint"
                                  : assigneeNow
                                    ? "reassigned to " + assigneeNow + " before you started it"
                                    : "left your sprint before you started it"}
                              </span>
                            )}
                            {t.releaseError && (
                              <span style={{ fontSize: FONT.sm, color: COLORS.danger }}>{t.releaseError}</span>
                            )}
                            {t.reviewError && (
                              <span style={{ fontSize: FONT.sm, color: COLORS.danger }}>Review fix: {t.reviewError}</span>
                            )}
                            {t.reviewState === "needs-human" && (
                              <span style={{ fontSize: FONT.sm, color: COLORS.warning }}>
                                {t.reviewRounds} rounds of automatic fixes did not close this review — the rest needs a decision.
                              </span>
                            )}
                          </span>
                          <span style={{ fontSize: FONT.base, fontWeight: 700, color: t.points ? COLORS.text : COLORS.faint }}>
                            {t.points || "—"}
                            {tri && tri.suggestedPoints > tri.currentPoints && (
                              <span style={{ fontSize: FONT.sm, color: COLORS.warning }}> ↑</span>
                            )}
                          </span>
                          <span style={{ fontSize: FONT.base, color: COLORS.textMuted }}>{t.estimateHours ? hours(t.estimateHours) : "—"}</span>
                          <span style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                            {claim !== "mine" ? (
                              // The live status belongs to whoever holds the
                              // ticket now, and a row rebuilt from the plan has
                              // no status at all — so neither is shown as if it
                              // were the developer's own progress.
                              <span style={pill({ color: CLAIM[claim].color, size: "xs", weight: 700 })}>
                                {CLAIM[claim].label}
                              </span>
                            ) : tri ? (
                              <span
                                title={READINESS[tri.readiness]?.means ?? ""}
                                style={pill({ color: READINESS[tri.readiness]?.color ?? COLORS.textDim, size: "xs", weight: 700 })}
                              >
                                {READINESS[tri.readiness]?.label ?? tri.readiness}
                              </span>
                            ) : (
                              <span style={statusPill(ticket?.status ?? "")}>{ticket?.status ?? "—"}</span>
                            )}
                          </span>
                          <span style={{ fontSize: FONT.base, fontWeight: 600, color: t.releasedAt ? COLORS.success : t.releaseDay === data?.today ? COLORS.accent : COLORS.textMuted }}>
                            {t.releasedAt ? "released" : dayLabel(t.releaseDay)}
                          </span>
                          <span style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
                            {/* The spinner is the State column's live half: a
                                pill alone cannot say whether "Running" is this
                                second's truth or a stale row. */}
                            {t.implementState === "running" && <LoadingRing size={13} />}
                            <span style={pill({ color: state.color, size: "xs", weight: 700 })}>{state.label}</span>
                          </span>
                          <span style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
                            {review ? (
                              <>
                                {review.spin && <LoadingRing size={13} />}
                                <span style={pill({ color: review.color, size: "xs", weight: 700 })}>{review.label}</span>
                              </>
                            ) : (
                              <span style={{ fontSize: FONT.base, color: COLORS.faint }}>—</span>
                            )}
                          </span>
                          {/* Every action a row offers, in one column at the end
                              of it. Kept out of the pill columns because a
                              button beside a verdict reads as part of it, and
                              because a wrapping button pushes the row it is in
                              out of line with every other row. */}
                          <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "7px", flexWrap: "nowrap" }}>
                            {canOverride &&
                              (t.unblockedByUser
                                ? button("Overridden", "success", () => setUnblocked(t.id, false), "unblock-" + t.id)
                                : button("Force ready", "outline", () => setUnblocked(t.id, true), "unblock-" + t.id))}
                            {t.implementState === "running" || t.reviewState === "running"
                              ? button("Watch", "outline", () => openExecution(t.ticketId, "execution"), "watch-row-" + t.ticketId)
                              : t.runId || t.reviewRunId
                                ? button("Result", "ghost", () => openExecution(t.ticketId, "result"), "result-" + t.ticketId)
                                : null}
                            {/* The manual half of the same machinery, and the only
                                way back for a row the scheduler has stopped asking
                                about: a failed fix, or one that hit the round
                                ceiling. Offered whenever there is something open to
                                answer, so the automation being off is not the same
                                as the work being unreachable. */}
                            {t.id && t.prPublished && t.openComments > 0 && t.reviewState !== "running" && claim === "mine" &&
                              button("Fix review", "outline", () => resolveReviewNow(t.id), "fixreview-" + t.id)}
                            {/* The only way back for a ticket the queue has
                                stopped asking about. A rebuild will not do it:
                                `savePlan()` treats any row that is not `pending`
                                as settled and refuses to re-date it, which is
                                right for finished work and wrong for stopped
                                work — so without this a single failed run took a
                                ticket out of the sprint permanently. Not offered
                                where there is a pull request already: that row
                                belongs to the review lane, and a second run on it
                                would open a second PR. */}
                            {t.id && claim === "mine" && !t.prUrl &&
                              (t.implementState === "failed" || t.implementState === "skipped") &&
                              button("Retry", "warning", () => retryNow(t.id), "retry-" + t.id)}
                            {due && t.id && button("Release", "primary", () => releaseNow(t.id), "release-" + t.id)}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* ---- what the scheduler did ---- */}
              {events.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={sectionCaption()}>SCHEDULER LOG</span>
                  <div style={{ ...card({ padding: "12px 14px" }), display: "flex", flexDirection: "column", gap: "7px" }}>
                    {events.slice(0, 12).map((e) => (
                      <span key={e.id} style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.5 }}>
                        <span style={{ color: COLORS.textDim }}>{new Date(e.createdAt).toLocaleString()}</span>
                        {" · "}
                        <span style={{ color: e.outcome === "failed" ? COLORS.danger : e.outcome === "skipped" ? COLORS.warning : COLORS.success, fontWeight: 700 }}>
                          {e.action} {e.outcome}
                        </span>
                        {e.ticketId ? ` · #${e.ticketId}` : ""}
                        {e.reason ? ` · ${e.reason}` : ""}
                        {e.detail ? ` — ${e.detail}` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <span style={{ fontSize: FONT.sm, color: COLORS.textDim, lineHeight: 1.6 }}>
                The queue order is what the agent works through, back to back. The release day is when the finished
                pull request is taken out of draft, assigned to your reviewers and moved to Code Review — spread at a
                steady pace so the sprint lands evenly instead of arriving all at once on the last Friday.
                {" "}Tickets you finished stay listed as handed off once QA takes them over, so the sprint scope keeps
                the whole fortnight in view instead of shrinking every time you succeed.
              </span>
            </>
          )}
        </div>
      </main>
      {reportOpen && triage?.status === "succeeded" && (
        <TriageReport
          data={triage.result}
          sprint={data?.sprint ?? sprint}
          costUsd={triage.costUsd}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  );
}
