import type { CSSProperties, MouseEvent } from "react";
import type { FileChange, LogLine, RunState } from "@/lib/types";
import type { ProviderId } from "@/lib/providers";

/** One node of the run's graph as the API reports it. The progress list comes
 *  from the graph the run is walking, so the UI no longer owns a step array. */
export type NodeView = {
  id: string;
  label: string;
  /** "agent" | "gate" | "check" — what the node *is*. The UI asks this instead
   *  of recognising a node by its id. */
  kind: string;
  effects: string;
  state: "pending" | "running" | "done" | "failed";
  attempts: number;
};

// What the UI knows about the run currently attached to a ticket. Mirrors
// `RunView` in lib/execution/queries.ts — the API's shape, not a second model.
export type ExecView = {
  runId?: string;
  state: RunState;
  skill?: string;
  graphId?: string;
  currentNodeId?: string;
  nodes: NodeView[];
  endReason?: string;
  logLines: LogLine[];
  resultText: string;
  error: string;
  prUrl?: string;
  branch?: string;
  duration?: string;
  // Token & cost usage summed from the run's Step rows.
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Which Claude account the run spent: `own` | `shared` (EmeHub), or `""` for
   *  this machine's own login. Rendered beside the cost, because the cost is the
   *  question it answers — whose quota that figure came out of. */
  claudeSource?: string;
  /** Latest plan artifact — drives the Plan tab when the graph has a gate. */
  planMarkdown?: string;
  filesChanged?: FileChange[];
  /** nodeId → that node's validated structured output. The Result tab renders
   *  verification / deviations / assumptions straight out of this. */
  channels?: Record<string, Record<string, unknown>>;
};

// One row of a ticket's run history (from the DB).
export type RunSummary = {
  id: string;
  state: RunState;
  skill: string;
  prUrl: string;
  branch: string;
  startedAt: string;
  duration?: string;
  resultText?: string;
  endReason?: string;
  filesChanged?: FileChange[];
  filesTouched?: number;
  linesAdded?: number;
  linesDeleted?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
};

// The Settings modal's form state (mirrors the persisted Setting row).
export type SettingsView = {
  provider: ProviderId;
  org: string;
  pat: string;
  hasPat: boolean;
  animatedBackground: boolean;
  /** Repaint the whole UI in the EmeHub design language. Presentational only. */
  emehubTheme: boolean;
  /** Fire the lightning-bolt effect on clicks and from every mounted spinner. */
  clickEffects: boolean;
  autoImplement: boolean;
  autoResolveCodeReview: boolean;
  scope: "team" | "personal";
  personalAccount: string;
  concurrentRuns: number;
  multiTicketMode: boolean;
  /** Let the app generate the provider's MCP config for each run (see lib/mcp.ts). */
  manageMcp: boolean;
  /** Dashboard ROI inputs. 0 hides the ROI tile rather than showing a made-up number. */
  hourlyRateUsd: number;
  hoursPerStoryPoint: number;
  /** Insert the independent review node (+ its bounded fix loop) between
   *  implement and publish, in the two-phase flow only. */
  evaluateBeforePublish: boolean;
  /** Run as part of the EmeHub suite: **every** provider call goes through the
   *  hub, and this app holds no provider credential of its own. Off = this app
   *  as it has always been, talking to the provider directly. */
  hubEnabled: boolean;
  /** Which of the hub's connections every provider call routes through — the
   *  hub's own connection id, as a string. Empty means none picked, which is
   *  "not configured", never a fallback to the local credential. */
  hubConnectionId: string;
};

/** One of the hub's provider connections, as `GET /api/hub` returns it — read
 *  live from `GET {hub}/connections`, not from a local mirror. Carries `hasPat`
 *  rather than the credential, the same shape and for the same reason as the
 *  hub's own response. */
export type HubConnectionView = {
  hubId: number;
  provider: ProviderId;
  label: string;
  orgUrl: string;
  project: string;
  capabilities: string[];
  hasPat: boolean;
};

/** What the Settings page knows about the hub integration.
 *
 *  `error`/`fix`/`reason` are present only when the connection list could not be
 *  read. They are three separate fields rather than one string because the four
 *  reasons need four different actions from the user — INTEGRATION.md §5. */
export type HubStatus = {
  enabled: boolean;
  /** Empty when `DAGENT_HUB_URL` is unset — the deployment is not pointed at a
   *  hub, which the UI must say rather than failing obscurely on every call. */
  hubUrl: string;
  selectedId: string;
  /** Whether this app currently holds a live hub access token. */
  signedIn: boolean;
  /** When that token stops being accepted. Null when there is none. */
  expiresAt: string | null;
  connections: HubConnectionView[];
  error?: string;
  fix?: string;
  reason?: "not-configured" | "unreachable" | "signed-out" | "rejected";
};

// The detail-pane tabs.
export type TabId = "overview" | "execution" | "plan" | "resolve-review" | "commits" | "result";

// Per-ticket Overview overrides.
export type OverrideField = "area" | "skill" | "rootRepo" | "model" | "effort";

// The primary CTA, resolved from the current execution status.
export type Action = {
  label: string;
  spinner: boolean;
  playIcon: boolean;
  onClick: (e?: MouseEvent) => void;
  style: CSSProperties;
  title?: string;
};

// One pre-styled workflow step for the Execution tab's timeline.
export type StepView = {
  label: string;
  num: number;
  dotStyle: CSSProperties;
  connectorStyle: CSSProperties;
  labelStyle: CSSProperties;
  showCheck: boolean;
  showSpinner: boolean;
  showX: boolean;
  showNum: boolean;
};

// One pre-styled terminal line for the Execution tab.
export type LogLineView = { text: string; num: number; style: CSSProperties };

// One completed run rendered as its own block on the Result tab.
export type ResultSection = {
  key: string;
  skill: string;
  title: string;
  markdown: string;
  filesChanged: FileChange[];
};

export type ConnTest = { status: "idle" | "testing" | "ok" | "fail"; message: string };
