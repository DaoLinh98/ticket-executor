import type { CSSProperties, MouseEvent } from "react";
import type { FileChange, LogLine, RunState } from "@/lib/types";
import type { ProviderId } from "@/lib/providers";

/** One node of the run's graph as the API reports it. The progress list comes
 *  from the graph the run is walking, so the UI no longer owns a step array. */
export type NodeView = {
  id: string;
  label: string;
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
