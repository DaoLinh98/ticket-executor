import type { CSSProperties, MouseEvent } from "react";
import type { ProviderId } from "@/lib/providers";

// The Settings modal's form state (mirrors the persisted Setting row).
export type SettingsView = {
  provider: ProviderId;
  org: string;
  pat: string;
  hasPat: boolean;
  animatedBackground: boolean;
  /** Fire the lightning-bolt effect on clicks and from every mounted spinner. */
  clickEffects: boolean;
  /** Sweep the energy ring around every ringBorder() edge. Off = flat borders. */
  ringAnimation: boolean;
  scope: "team" | "personal";
  personalAccount: string;
  concurrentRuns: number;
  /** Let the app generate the provider's MCP config for each run (see lib/mcp.ts). */
  manageMcp: boolean;
  hoursPerStoryPoint: number;
  /** The git author every run commits as. Needed because the app executes
   *  inside a container, which has no developer `~/.gitconfig` to inherit —
   *  without one `git commit` fails at the first implementing node. Empty
   *  leaves whatever git identity the machine already has untouched. */
  gitUserName: string;
  gitUserEmail: string;
};

// The detail-pane tabs.
export type TabId = "overview" | "resolve-review" | "commits" | "ask";

// Per-ticket Overview overrides.
export type OverrideField = "area" | "rootRepo" | "model" | "effort";

// The primary CTA, resolved from the ticket's status.
export type Action = {
  label: string;
  spinner: boolean;
  playIcon: boolean;
  onClick: (e?: MouseEvent) => void;
  style: CSSProperties;
  title?: string;
};

// One pre-styled terminal line for the Ask tab.
export type LogLineView = { text: string; num: number; style: CSSProperties };

export type ConnTest = { status: "idle" | "testing" | "ok" | "fail"; message: string };
