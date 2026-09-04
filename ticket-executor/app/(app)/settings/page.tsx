"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import SelectMenu from "../../SelectMenu";
import LoadingRing from "../../ticket-executor/LoadingRing";
import Toast, { type ToastMessage } from "../../ticket-executor/Toast";
import { SETTINGS_UPDATED_EVENT } from "../../settingsEvents";
import { PROVIDERS, providerMeta, DEFAULT_PROVIDER, type ProviderId } from "@/lib/providers";
import { COLORS, FONT, card, clipCorner, ctaButtonStyle, fieldInput, fieldLabel, pill, ringBorder, tabStyle, tintedCard } from "@/lib/ui";
import type { ConnTest, SettingsView } from "../../ticket-executor/types";
import { useBoltsContext } from "../../BoltsContext";
import ProviderBadge from "../ProviderBadge";
import PageHeading from "../PageHeading";

const DEFAULTS: SettingsView = {
  provider: "azure-devops", org: "", pat: "", hasPat: false,
  animatedBackground: true, clickEffects: true, autoImplement: true, autoResolveCodeReview: true,
  scope: "team", personalAccount: "", concurrentRuns: 2, multiTicketMode: true,
  manageMcp: true, hourlyRateUsd: 0, hoursPerStoryPoint: 6,
  evaluateBeforePublish: false,
  gitUserName: "", gitUserEmail: "",
};

// The page is four panes, not one scroll.
//
// It had grown to eleven independent settings in a single column — a connection,
// an integration, five behaviour switches, two pricing inputs and two cosmetic
// ones — so finding any of them meant scrolling past the other ten. They group
// cleanly by the question they answer, and that grouping is what these tabs are:
// where tickets come from, how a run behaves, what the dashboard prices work at,
// and what the app looks like.
//
// One form, one Save. The tabs only decide what is on screen; the payload is the
// whole settings object either way, so switching tabs never loses an edit.
const TABS = [
  { id: "connection", label: "Connection" },
  { id: "execution", label: "Execution" },
  { id: "dashboard", label: "Dashboard" },
  { id: "appearance", label: "Appearance" },
] as const;
type SettingsTabId = (typeof TABS)[number]["id"];

// Reusable pill toggle (ported from the old SettingsModal, deduplicated).
function Toggle({ on, onToggle, title }: { on: boolean; onToggle: (e: React.MouseEvent) => void; title: string }) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={on}
      title={title}
      style={{ position: "relative", flex: "0 0 auto", width: "42px", height: "24px", borderRadius: "999px", border: "none", cursor: "pointer", background: on ? "var(--accent)" : "#2A2F3A", transition: "background .18s" }}
    >
      <span style={{ position: "absolute", top: "3px", left: on ? "21px" : "3px", width: "18px", height: "18px", borderRadius: "50%", background: "#0B0C10", transition: "left .18s" }} />
    </button>
  );
}

/** One "title + explanation + switch" line. Every behaviour setting is this
 *  shape, and it was written out eight times before it was named. */
function ToggleRow({ label, desc, on, onToggle }: { label: string; desc: ReactNode; on: boolean; onToggle: (e: React.MouseEvent) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
      <div>
        <div style={{ fontSize: FONT.md, fontWeight: 700, color: COLORS.text }}>{label}</div>
        <div style={{ fontSize: FONT.sm, color: COLORS.textDim, marginTop: "2px", lineHeight: 1.5 }}>{desc}</div>
      </div>
      <Toggle on={on} title={`Toggle ${label.toLowerCase()}`} onToggle={onToggle} />
    </div>
  );
}

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export default function SettingsPage() {
  const { fireBoltFromEvent } = useBoltsContext();
  const [tab, setTab] = useState<SettingsTabId>("connection");
  const [settings, setSettings] = useState<SettingsView>(DEFAULTS);
  const [connTest, setConnTest] = useState<ConnTest>({ status: "idle", message: "" });
  const [error, setError] = useState("");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastSeq = useRef(0);
  const [loading, setLoading] = useState(true);
  const pm = providerMeta(settings.provider);
  // The Toast owns its own countdown (and pauses it on hover), so all this does
  // is hand it a fresh message.
  const showToast = (msg: string, kind: "success" | "error" | "warning" = "success", ms = 7000) =>
    setToast({ id: ++toastSeq.current, msg, kind, durationMs: ms });

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/settings");
        const data = await r.json();
        if (data.settings) setSettings(data.settings);
      } catch {
        /* keep defaults */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setField = (k: keyof SettingsView) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSettings((s) => ({ ...s, [k]: e.target.value }));

  const onProviderChange = async (label: string) => {
    const provider = PROVIDERS.find((p) => p.name === label)?.id ?? DEFAULT_PROVIDER;
    setConnTest({ status: "idle", message: "" });
    try {
      const r = await fetch(`/api/settings?provider=${provider}`);
      const data = await r.json();
      setSettings((s) => ({ ...s, provider, org: data.settings?.org ?? "", hasPat: !!data.settings?.hasPat, pat: "" }));
    } catch {
      setSettings((s) => ({ ...s, provider, org: "", hasPat: false, pat: "" }));
    }
  };

  const testConnection = async () => {
    setConnTest({ status: "testing", message: "" });
    try {
      const r = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: settings.provider, org: settings.org, pat: settings.pat }),
      });
      const data = await r.json();
      setConnTest({ status: data.ok ? "ok" : "fail", message: data.message || (data.ok ? "Connected." : "Failed.") });
    } catch (err) {
      setConnTest({ status: "fail", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const validate = (): string => {
    // An *absent* credential does not block the save. Save posts all four tabs
    // as one object, so requiring the org URL made an unrelated Appearance
    // change unsaveable. Being unconfigured is reported after the save instead,
    // and refused where it actually costs something — preflight refuses to start
    // a run, and Test connection says so out loud.
    const url = settings.org.trim();
    if (!url) return "";
    // A value that *is* there and is wrong is still a hard error: saving a
    // malformed URL only moves the failure to a place with less context.
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return "URL must start with http:// or https://";
    } catch {
      return "Enter a valid URL (e.g. https://…).";
    }
    if (!settings.hasPat && !settings.pat.trim()) return `${pm.tokenLabel} is required.`;
    return "";
  };

  /** No credential — legal to save, but nothing can run on it.
   *  Said out loud on save so the gap is never discovered by a failed run.
   *  Takes the *saved* settings rather than reading state: the server's echo is
   *  what is now in effect, and the local copy is one render behind it. */
  const credentialMissing = (s: SettingsView) => !s.org.trim();

  const save = async (e?: React.MouseEvent) => {
    const v = validate();
    // A validation failure always lives on the Connection tab, so send the user
    // there rather than showing a message about a field they cannot see.
    if (v) { setError(v); setTab("connection"); return; }
    setError("");
    if (e) fireBoltFromEvent(e);
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await r.json();
      if (!r.ok || !data.settings) { setError(data.error || "Failed to save settings"); return; }
      setSettings(data.settings);
      // Broadcast so the app-wide reactor backdrop and the click-effect layer pick
      // the change up immediately, without waiting for a route change / reload.
      window.dispatchEvent(
        new CustomEvent(SETTINGS_UPDATED_EVENT, {
          detail: {
            animatedBackground: data.settings.animatedBackground,
            clickEffects: data.settings.clickEffects,
          },
        })
      );
      if (credentialMissing(data.settings)) {
        showToast(
          `Settings saved. ${pm.name} is not configured — add the ${pm.urlLabel} and ${pm.tokenLabel} before running a ticket.`,
          "warning",
          10000
        );
      } else {
        showToast("Settings saved.");
      }
    } catch {
      setError("Failed to save settings");
    }
  };

  const divider: CSSProperties = { height: "1px", background: COLORS.borderSubtle };
  const pane: CSSProperties = { display: "flex", flexDirection: "column", gap: "20px" };
  const hint: CSSProperties = { fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.55 };

  // ---- the panes ----
  const connectionPane = (
    <div style={pane}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={fieldLabel()}>PROVIDER</span>
          <div style={{ ...card({ padding: "0 13px", background: "#0E1015" }), height: "40px", display: "flex", alignItems: "center" }}>
            <SelectMenu value={pm.name} onChange={onProviderChange} options={PROVIDERS.map((p) => p.name)} ariaLabel="Provider" />
          </div>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={fieldLabel()}>SCOPE</span>
          <div style={{ display: "flex", gap: "8px" }}>
            {(["team", "personal"] as const).map((sc) => {
              const active = settings.scope === sc;
              return (
                <button
                  key={sc}
                  onClick={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, scope: sc })); }}
                  style={{ flex: 1, height: "40px", fontSize: FONT.base, fontWeight: 700, cursor: "pointer", textTransform: "capitalize", color: active ? "#F3F5F9" : COLORS.textDim, ...(active ? ringBorder({ fill: "#171A21", duration: 3.4, cornerPx: 7 }) : { border: "1.5px solid #262B36", background: "#0E1015", clipPath: clipCorner(7) }) }}
                >
                  {sc}
                </button>
              );
            })}
          </div>
        </label>
      </div>

      {settings.scope === "personal" && (
        <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={fieldLabel()}>YOUR {pm.name.toUpperCase()} ACCOUNT</span>
          <input value={settings.personalAccount} onChange={setField("personalAccount")} placeholder="you@company.com or display name" style={fieldInput()} />
          <span style={hint}>Only tickets assigned to this account and PR review notifications it authored will be shown.</span>
        </label>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={fieldLabel()}>{pm.urlLabel}</span>
          <input value={settings.org} onChange={setField("org")} placeholder={pm.urlPlaceholder} style={fieldInput()} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={fieldLabel()}>{pm.tokenLabel}</span>
          <input type="password" value={settings.pat} onChange={setField("pat")} placeholder={settings.hasPat ? "•••••••••••••• (saved)" : "••••••••••••••••"} style={fieldInput()} />
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "11px" }}>
        <button onClick={(e) => { fireBoltFromEvent(e); testConnection(); }} disabled={connTest.status === "testing"} style={{ ...ctaButtonStyle("outline", { height: "30px", cornerPx: 7 }), cursor: connTest.status === "testing" ? "default" : "pointer" }}>
          {connTest.status === "testing" ? <LoadingRing size={13} /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h7l-1 8 10-12h-7z" /></svg>}
          Test connection
        </button>
        {connTest.status !== "idle" && connTest.status !== "testing" && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: FONT.sm, fontWeight: 600, color: connTest.status === "ok" ? "#5BE8B8" : "#FF8F8F", lineHeight: 1.4 }}>
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: connTest.status === "ok" ? COLORS.success : COLORS.danger, boxShadow: "0 0 8px " + (connTest.status === "ok" ? COLORS.success : COLORS.danger), flex: "0 0 auto" }} />
            {connTest.message}
          </span>
        )}
      </div>
      <span style={hint}>
        Connect at the organization level — the project is chosen on the Projects page or the Ticket Execution dropdown, and the current sprint loads automatically per project.
      </span>

    </div>
  );

  const executionPane = (
    <div style={pane}>
      {/* The git author every run commits as.
          Asked for here because the app runs in a container: there is no
          developer's ~/.gitconfig in there to inherit, and without an author
          `git commit` fails at the first implementing node — after the run has
          already been paid for. Left blank, nothing is written and the
          machine's own git identity is used, which is the right answer when this
          app runs on a developer's own machine. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <span style={fieldLabel()}>GIT AUTHOR</span>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "6px", flex: "1 1 200px" }}>
            <span style={hint}>Name</span>
            <input value={settings.gitUserName} onChange={setField("gitUserName")} placeholder="Linh Dao" style={fieldInput()} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "6px", flex: "1 1 240px" }}>
            <span style={hint}>Email</span>
            <input value={settings.gitUserEmail} onChange={setField("gitUserEmail")} placeholder="you@company.com" style={fieldInput()} />
          </label>
        </div>
        <span style={hint}>
          Stamped on every commit a run makes. Use the address your git host knows you by — on Azure DevOps a
          different one shows up as an unattributed commit. Leave both blank to use whatever git identity the
          machine already has.
        </span>
      </div>

      <div style={divider} />
      <ToggleRow
        label="Manage MCP for me"
        on={settings.manageMcp}
        onToggle={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, manageMcp: !s.manageMcp })); }}
        desc={<>On: each run gets a {pm.name} MCP server generated from the connection, so Claude can read the ticket with nothing to set up by hand. If you already configured your own, the app steps aside.<br />Off: the app never touches MCP — System Check only verifies whatever this machine already has.</>}
      />

      <div style={divider} />
      <ToggleRow
        label="Multi-ticket mode"
        on={settings.multiTicketMode}
        onToggle={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, multiTicketMode: !s.multiTicketMode })); }}
        desc={<>On: select multiple tickets and run them concurrently, each isolated in its own git worktree.<br />Off: one ticket at a time, run directly in the root repo — simplest and most reliable for a single run.</>}
      />
      <div style={{ display: "grid", gridTemplateRows: settings.multiTicketMode ? "1fr" : "0fr", opacity: settings.multiTicketMode ? 1 : 0, transition: "grid-template-rows .28s ease, opacity .22s ease" }}>
        <div style={{ overflow: "hidden" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "8px", paddingTop: "4px" }}>
            <span style={fieldLabel()}>CONCURRENT RUNS</span>
            <input type="number" min={1} max={20} value={settings.concurrentRuns} onChange={(e) => setSettings((s) => ({ ...s, concurrentRuns: Math.max(1, Math.min(20, Number(e.target.value) || 1)) }))} style={{ ...fieldInput(), width: "120px" }} />
            <span style={hint}>Runs beyond this limit wait in a queue until a slot frees up.</span>
          </label>
        </div>
      </div>

      <div style={divider} />
      <ToggleRow
        label="Auto-implementation"
        on={settings.autoImplement}
        onToggle={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, autoImplement: !s.autoImplement })); }}
        desc={<>On: run to a PR in one shot (<span style={mono}>implement-ticket-v2</span>).<br />Off: draft a plan and wait for your review before coding (<span style={mono}>implement-ticket-v3</span>).</>}
      />

      <div style={divider} />
      <ToggleRow
        label="Auto-resolve code review"
        on={settings.autoResolveCodeReview}
        onToggle={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, autoResolveCodeReview: !s.autoResolveCodeReview })); }}
        desc={<>On: resolve every open review thread in one shot (<span style={mono}>fix-code-review-v2</span>).<br />Off: draft a resolution plan and wait for your review before coding (<span style={mono}>fix-code-review-v3</span>).</>}
      />

      <div style={divider} />
      <ToggleRow
        label="Review before publishing"
        on={settings.evaluateBeforePublish}
        onToggle={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, evaluateBeforePublish: !s.evaluateBeforePublish })); }}
        desc={<>Adds an independent reviewer between coding and the pull request. It reads only the diff, in its own session, so it can disagree with the agent that wrote the code — blocking findings go back for up to two fix rounds.<br />Costs roughly one extra review turn per run. Applies to the plan-review flows only (<span style={mono}>-v3</span>); the one-shot flows have already published by then.</>}
      />
    </div>
  );

  const dashboardPane = (
    <div style={pane}>
      <span style={hint}>What the Dashboard prices delivered work at. These are read only when a metric is rendered; they change no run&apos;s behaviour.</span>
      <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={fieldLabel()}>BLENDED HOURLY RATE (USD)</span>
          <input type="number" min={0} step={1} value={settings.hourlyRateUsd} onChange={(e) => setSettings((s) => ({ ...s, hourlyRateUsd: Math.max(0, Number(e.target.value) || 0) }))} style={{ ...fieldInput(), width: "140px" }} />
          <span style={{ ...hint, maxWidth: "320px" }}>Prices the Dashboard&apos;s ROI tile against your team&apos;s own ticket estimates. Leave at 0 to hide that tile rather than publish a guessed number.</span>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={fieldLabel()}>HOURS PER STORY POINT</span>
          <input type="number" min={0} step={0.5} value={settings.hoursPerStoryPoint} onChange={(e) => setSettings((s) => ({ ...s, hoursPerStoryPoint: Math.max(0, Number(e.target.value) || 0) }))} style={{ ...fieldInput(), width: "140px" }} />
          <span style={{ ...hint, maxWidth: "320px" }}>Used only when a ticket carries story points instead of an hour estimate.</span>
        </label>
      </div>
    </div>
  );

  const appearancePane = (
    <div style={pane}>
      <ToggleRow
        label="Animated background"
        on={settings.animatedBackground}
        onToggle={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, animatedBackground: !s.animatedBackground })); }}
        desc="Turn off to remove the 3D reactor backdrop entirely."
      />
      <div style={divider} />
      <ToggleRow
        label="Lightning effects"
        on={settings.clickEffects}
        onToggle={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, clickEffects: !s.clickEffects })); }}
        desc={<>On: a bolt strikes where you click, and every spinner (the buttons of a running ticket) keeps striking itself while it spins.<br />Off: no bolts at all — clicks and running buttons stay still.</>}
      />
    </div>
  );

  const panes: Record<SettingsTabId, ReactNode> = {
    connection: connectionPane,
    execution: executionPane,
    dashboard: dashboardPane,
    appearance: appearancePane,
  };

  return (
    <div style={{ position: "relative", height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column", color: COLORS.text, ["--accent" as string]: COLORS.accent }}>
      <header style={{ position: "relative", zIndex: 1, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "14px", padding: "0 28px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "rgba(14,17,23,.72)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <PageHeading title="Settings" kicker="D-AGENT · CONFIGURATION" icon={<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>} />
        <div style={{ flex: 1 }} />
        <ProviderBadge provider={pm.id} />
      </header>

      <main className="te-scroll" style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", padding: "22px 28px 28px", background: "linear-gradient(110deg,rgba(6,7,10,.5) 0%,rgba(6,7,10,.22) 52%,rgba(6,7,10,0) 100%)" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: "80px" }}><LoadingRing size={120} /></div>
        ) : (
          <div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "22px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
              {TABS.map((t) => (
                <button key={t.id} onClick={(e) => { fireBoltFromEvent(e); setTab(t.id); }} style={tabStyle({ active: tab === t.id })}>
                  {t.label}
                </button>
              ))}
            </div>

            {panes[tab]}

            {error && (
              <div style={{ display: "flex", gap: "9px", alignItems: "flex-start", ...tintedCard("danger", { padding: "11px 13px", radius: "10px" }) }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2" style={{ stroke: COLORS.danger, flex: "0 0 auto", marginTop: "1px" }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
                <span style={{ fontSize: FONT.base, color: "#FF8F8F", lineHeight: 1.5 }}>{error}</span>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "12px", paddingTop: "4px" }}>
              <button onClick={save} style={{ ...ctaButtonStyle("primary", { height: "34px", cornerPx: 7 }), padding: "0 20px" }}>Save changes</button>
            </div>
          </div>
        )}
      </main>
      {toast && <Toast key={toast.id} toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
