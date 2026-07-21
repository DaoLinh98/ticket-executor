import type { CSSProperties, MouseEvent } from "react";
import type { ExecStatus, FileChange, LogLine } from "@/lib/types";
import type { ProviderId } from "@/lib/providers";

// What the UI knows about the run currently attached to a ticket.
export type ExecView = {
  executionId?: string;
  status: ExecStatus;
  skillName?: string;
  logLines: LogLine[];
  resultText: string;
  error: string;
  prUrl?: string;
  branch?: string;
  duration?: string;
  currentStep?: number;
};

// One row of a ticket's run history (from the DB).
export type RunSummary = {
  id: string;
  status: ExecStatus;
  skillName: string;
  prUrl: string;
  branch: string;
  startedAt: string;
  duration?: string;
  resultText?: string;
  filesChanged?: FileChange[];
};

// The Settings modal's form state (mirrors the persisted Setting row).
export type SettingsView = {
  provider: ProviderId;
  org: string;
  pat: string;
  hasPat: boolean;
  animatedBackground: boolean;
  scope: "team" | "personal";
  personalAccount: string;
  concurrentRuns: number;
};

// The four detail-pane tabs.
export type TabId = "overview" | "execution" | "resolve-review" | "result";

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
