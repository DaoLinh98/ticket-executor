"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import SelectMenu from "../../SelectMenu";
import LoadingRing from "../../ticket-executor/LoadingRing";
import { useToast } from "../ToastProvider";
import { broadcastSettingsUpdated } from "../../settingsEvents";
import { PROVIDERS, providerMeta, connectionLabel, DEFAULT_PROVIDER, type ProviderId } from "@/lib/providers";
import { COLORS, FONT, MOTION, card, chipShape, clipCorner, ctaButtonStyle, fieldInput, fieldLabel, pill, ringBorder, tabStyle, tintedCard } from "@/lib/ui";
import type { ConnTest, SettingsView } from "../../ticket-executor/types";
import { useBoltsContext } from "../../BoltsContext";
import ProviderBadge from "../ProviderBadge";
import PageHeading from "../PageHeading";
import NotificationCenter from "../NotificationCenter";
import { CONNECTION_CHANGED_EVENT } from "../../connectionEvents";
import PushNotifications from "./PushNotifications";

const DEFAULTS: SettingsView = {
  provider: "azure-devops", org: "", pat: "", hasPat: false,
  animatedBackground: true, clickEffects: true, ringAnimation: true,
  scope: "team", personalAccount: "", concurrentRuns: 2, multiTicketMode: true,
  manageMcp: true, hourlyRateUsd: 0, hoursPerStoryPoint: 6,
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
  { id: "notifications", label: "Notifications" },
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
      style={{ position: "relative", flex: "0 0 auto", width: "42px", height: "24px", ...chipShape(6), border: "none", cursor: "pointer", background: on ? "var(--accent)" : "var(--te-btn-outline-border)", transition: "background .18s" }}
    >
      <span style={{ position: "absolute", top: "3px", left: on ? "21px" : "3px", width: "18px", height: "18px", clipPath: clipCorner(6), background: "var(--te-on-accent)", transition: "left .18s var(--te-ease-expo)" }} />
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

// One saved organization, as /api/connections reports it — never the token.
type Connection = { id: string; label: string; org: string; hasPat: boolean; isActive: boolean; identityEmail: string; identityName: string; reviewers: string[] };
// The row being added ("" id) or edited. Null = the list only.
type ConnectionEditor = { id: string; label: string; org: string; pat: string; hasPat: boolean; identityEmail: string; identityName: string; reviewers: string };

export default function SettingsPage() {
  const { fireBoltFromEvent } = useBoltsContext();
  const [tab, setTab] = useState<SettingsTabId>("connection");
  const [settings, setSettings] = useState<SettingsView>(DEFAULTS);
  const [connTest, setConnTest] = useState<ConnTest>({ status: "idle", message: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Every organization saved for the selected provider. The active one is what
  // the whole app runs as; the header picker switches it.
  const [connections, setConnections] = useState<Connection[]>([]);
  const [editor, setEditor] = useState<ConnectionEditor | null>(null);
  const [connBusy, setConnBusy] = useState(false);
  const pm = providerMeta(settings.provider);
  const showToast = useToast();

  const loadConnections = async (provider: ProviderId) => {
    try {
      const r = await fetch(`/api/connections?provider=${provider}`);
      const data = await r.json();
      const list: Connection[] = Array.isArray(data.connections) ? data.connections : [];
      setConnections(list);
      return list;
    } catch {
      setConnections([]);
      return [];
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/settings", { cache: "no-store" });
        const data = await r.json();
        if (data.settings) {
          setSettings(data.settings);
          await loadConnections(data.settings.provider);
        }
      } catch {
        /* keep defaults */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // The header picker switches the very organizations listed here — without this
  // the list keeps badging the one it last fetched as ACTIVE.
  useEffect(() => {
    const onChanged = () => { loadConnections(settings.provider); };
    window.addEventListener(CONNECTION_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONNECTION_CHANGED_EVENT, onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadConnections is re-created every render; the provider is what it depends on
  }, [settings.provider]);

  const setField = (k: keyof SettingsView) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSettings((s) => ({ ...s, [k]: e.target.value }));

  const onProviderChange = async (label: string) => {
    const provider = PROVIDERS.find((p) => p.name === label)?.id ?? DEFAULT_PROVIDER;
    setConnTest({ status: "idle", message: "" });
    setEditor(null);
    setSettings((s) => ({ ...s, provider }));
    await loadConnections(provider);
  };

  // ---- organizations ----
  const startEdit = (c: Connection) => {
    setConnTest({ status: "idle", message: "" });
    setEditor({ id: c.id, label: c.label, org: c.org, pat: "", hasPat: c.hasPat, identityEmail: c.identityEmail, identityName: c.identityName, reviewers: (c.reviewers ?? []).join(", ") });
  };
  const startAdd = () => {
    setConnTest({ status: "idle", message: "" });
    setEditor({ id: "", label: "", org: "", pat: "", hasPat: false, identityEmail: "", identityName: "", reviewers: "" });
  };

  /** Everything that reads a credential runs as the active organization, so a
   *  change to the list is a change to what every other page shows. */
  const announceConnectionChange = (org: string, id: string) =>
    window.dispatchEvent(
      new CustomEvent(CONNECTION_CHANGED_EVENT, { detail: { provider: settings.provider, connectionId: id, org } })
    );

  const validateConnection = (org: string, hasPat: boolean, pat: string): string => {
    const url = org.trim();
    if (!url) return `${pm.urlLabel} is required.`;
    // A malformed URL is a hard error: saving it only moves the failure to a
    // place with less context.
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return "URL must start with http:// or https://";
    } catch {
      return "Enter a valid URL (e.g. https://…).";
    }
    if (!hasPat && !pat.trim()) return `${pm.tokenLabel} is required.`;
    return "";
  };

  const saveConnection = async () => {
    if (!editor) return;
    const v = validateConnection(editor.org, editor.hasPat, editor.pat);
    if (v) { setError(v); return; }
    setError("");
    setConnBusy(true);
    try {
      const r = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editor.id || undefined, provider: settings.provider, label: editor.label, org: editor.org, pat: editor.pat, identityEmail: editor.identityEmail, identityName: editor.identityName, reviewers: editor.reviewers.split(",").map((r) => r.trim()).filter(Boolean) }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "Failed to save the organization."); return; }
      setConnections(Array.isArray(data.connections) ? data.connections : []);
      setEditor(null);
      setConnTest({ status: "idle", message: "" });
      announceConnectionChange(editor.org, data.connection?.id ?? "");
      showToast("Organization saved.");
    } catch {
      setError("Failed to save the organization.");
    } finally {
      setConnBusy(false);
    }
  };

  const activateConnection = async (c: Connection) => {
    if (c.isActive) return;
    setConnections((cs) => cs.map((x) => ({ ...x, isActive: x.id === c.id })));
    await fetch("/api/connections/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: settings.provider, id: c.id }),
    });
    announceConnectionChange(c.org, c.id);
    showToast(`Now connected to ${connectionLabel(c)}.`);
  };

  const removeConnection = async (c: Connection) => {
    setConnBusy(true);
    try {
      const r = await fetch(`/api/connections?id=${encodeURIComponent(c.id)}&provider=${settings.provider}`, { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "Failed to remove the organization."); return; }
      const list: Connection[] = Array.isArray(data.connections) ? data.connections : [];
      setConnections(list);
      if (editor?.id === c.id) setEditor(null);
      const active = list.find((x) => x.isActive) ?? list[0];
      announceConnectionChange(active?.org ?? "", active?.id ?? "");
      showToast(`Removed ${connectionLabel(c)}.`);
    } finally {
      setConnBusy(false);
    }
  };

  const testConnection = async () => {
    setConnTest({ status: "testing", message: "" });
    try {
      const r = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: settings.provider, id: editor?.id || undefined, org: editor?.org ?? "", pat: editor?.pat ?? "" }),
      });
      const data = await r.json();
      setConnTest({ status: data.ok ? "ok" : "fail", message: data.message || (data.ok ? "Connected." : "Failed.") });
    } catch (err) {
      setConnTest({ status: "fail", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const save = async (e?: React.MouseEvent) => {
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
      // the change up immediately — in this tab and in every other tab of this
      // browser. Another device converges on its next resume or poll instead.
      broadcastSettingsUpdated({
        animatedBackground: data.settings.animatedBackground,
        clickEffects: data.settings.clickEffects,
        ringAnimation: data.settings.ringAnimation,
      });
      if (!connections.length) {
        showToast(
          `Settings saved. ${pm.name} has no organization yet — add one under Organizations before running a ticket.`,
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
  const connectionRow = (c: Connection) => (
    <div
      key={c.id}
      style={{
        display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px",
        ...(c.isActive
          ? ringBorder({ fill: "var(--te-raised-bg)", duration: 4.4, shape: "none" })
          : { border: `1px solid ${COLORS.border}`, background: COLORS.panelBg }),
        borderRadius: "12px",
      }}
    >
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: "3px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
          <span style={{ fontSize: FONT.md, fontWeight: 700, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {connectionLabel(c)}
          </span>
          {c.isActive && <span style={pill({ color: COLORS.accent, border: COLORS.border, size: "xs", weight: 700 })}>ACTIVE</span>}
          {!c.hasPat && <span style={pill({ color: COLORS.warning, size: "xs", weight: 700 })}>NO TOKEN</span>}
        </div>
        <span style={{ ...mono, fontSize: FONT.sm, color: COLORS.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.org}</span>
        {(c.identityEmail || c.identityName) && (
          <span style={{ fontSize: FONT.sm, color: COLORS.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.identityName || c.identityEmail}{c.identityName && c.identityEmail ? ` · ${c.identityEmail}` : ""}
          </span>
        )}
        <span style={{ fontSize: FONT.sm, color: (c.reviewers ?? []).length ? COLORS.textDim : COLORS.warning, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {(c.reviewers ?? []).length ? `Reviewers · ${c.reviewers.join(", ")}` : "No reviewers yet"}
        </span>
      </div>
      {!c.isActive && (
        <button
          onClick={(e) => { fireBoltFromEvent(e); activateConnection(c); }}
          style={{ ...ctaButtonStyle("ghost", { height: "30px", cornerPx: 7 }), color: COLORS.accent }}
        >
          Use
        </button>
      )}
      <button onClick={(e) => { fireBoltFromEvent(e); startEdit(c); }} style={ctaButtonStyle("ghost", { height: "30px", cornerPx: 7 })}>
        Edit
      </button>
      <button
        onClick={(e) => { fireBoltFromEvent(e); removeConnection(c); }}
        disabled={connBusy}
        style={{ ...ctaButtonStyle("ghost", { height: "30px", cornerPx: 7 }), color: COLORS.danger, cursor: connBusy ? "default" : "pointer" }}
      >
        Remove
      </button>
    </div>
  );

  const connectionPane = (
    <div style={pane}>
      <div className="te-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={fieldLabel()}>PROVIDER</span>
          <div style={{ ...card({ padding: "0 13px", background: "var(--te-inset-bg)" }), height: "40px", display: "flex", alignItems: "center" }}>
            <SelectMenu value={pm.name} onChange={onProviderChange} options={PROVIDERS.map((p) => p.name)} ariaLabel="Provider" />
          </div>
        </label>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <span style={fieldLabel()}>ORGANIZATIONS</span>
          <button onClick={(e) => { fireBoltFromEvent(e); startAdd(); }} style={ctaButtonStyle("outline", { height: "30px", cornerPx: 7 })}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
            Add organization
          </button>
        </div>
        {connections.length === 0 && !editor ? (
          <div style={tintedCard("warning", { padding: "12px 14px" })}>
            <span style={{ fontSize: FONT.base, color: COLORS.warning, fontWeight: 600 }}>
              No {pm.name} organization yet — add one before running a ticket.
            </span>
          </div>
        ) : (
          connections.map(connectionRow)
        )}
        <span style={hint}>
          Add one per organization you work with. The header switches between them, and every page — projects,
          tickets, sprints, review notifications and the dashboard — reloads as the one selected there.
        </span>
      </div>

      {editor && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", ...card({ padding: "16px", background: "var(--te-inset-bg)" }) }}>
          <span style={fieldLabel()}>{editor.id ? "EDIT ORGANIZATION" : "NEW ORGANIZATION"}</span>
          <div className="te-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={fieldLabel()}>NAME (OPTIONAL)</span>
              <input value={editor.label} onChange={(e) => setEditor({ ...editor, label: e.target.value })} placeholder="Client A" autoComplete="off" style={fieldInput()} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={fieldLabel()}>{pm.urlLabel}</span>
              <input value={editor.org} onChange={(e) => setEditor({ ...editor, org: e.target.value })} placeholder={pm.urlPlaceholder} autoComplete="off" style={fieldInput()} />
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={fieldLabel()}>{pm.tokenLabel}</span>
            <input type="password" value={editor.pat} onChange={(e) => setEditor({ ...editor, pat: e.target.value })} placeholder={editor.hasPat ? "•••••••••••••• (saved)" : "••••••••••••••••"} autoComplete="new-password" style={fieldInput()} />
          </label>

          <div className="te-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={fieldLabel()}>MY EMAIL HERE (OPTIONAL)</span>
              <input value={editor.identityEmail} onChange={(e) => setEditor({ ...editor, identityEmail: e.target.value })} placeholder="ken.nguyen@emesoft.net" autoComplete="off" style={fieldInput()} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={fieldLabel()}>MY DISPLAY NAME HERE</span>
              <input value={editor.identityName} onChange={(e) => setEditor({ ...editor, identityName: e.target.value })} placeholder="Ken Nguyen" autoComplete="off" style={fieldInput()} />
            </label>
          </div>
          <span style={hint}>
            The account this organization hands work to. Work items are assigned per organization, so this is
            stored per organization rather than once for the app. Leave it empty and nothing filters by you.
          </span>

          <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={fieldLabel()}>REVIEWERS (EMAIL OR DISPLAY NAME, COMMA SEPARATED)</span>
            <input value={editor.reviewers} onChange={(e) => setEditor({ ...editor, reviewers: e.target.value })} placeholder="reviewer@company.com, Lead Name" autoComplete="off" style={fieldInput()} />
          </label>
          <span style={hint}>
            Every pull request Flow Runner releases in this organization is assigned to these people.
          </span>

          <div style={{ display: "flex", alignItems: "center", gap: "11px", flexWrap: "wrap" }}>
            <button onClick={(e) => { fireBoltFromEvent(e); testConnection(); }} disabled={connTest.status === "testing"} style={{ ...ctaButtonStyle("outline", { height: "30px", cornerPx: 7 }), cursor: connTest.status === "testing" ? "default" : "pointer" }}>
              {connTest.status === "testing" ? <LoadingRing size={13} /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h7l-1 8 10-12h-7z" /></svg>}
              Test connection
            </button>
            <button onClick={(e) => { fireBoltFromEvent(e); saveConnection(); }} disabled={connBusy} style={{ ...ctaButtonStyle("primary", { height: "30px", cornerPx: 7 }), cursor: connBusy ? "default" : "pointer" }}>
              {editor.id ? "Save organization" : "Add organization"}
            </button>
            <button onClick={(e) => { fireBoltFromEvent(e); setEditor(null); setConnTest({ status: "idle", message: "" }); }} style={ctaButtonStyle("ghost", { height: "30px", cornerPx: 7 })}>
              Cancel
            </button>
            {connTest.status !== "idle" && connTest.status !== "testing" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: FONT.sm, fontWeight: 600, color: connTest.status === "ok" ? "var(--te-btn-success-text)" : "#FF8F8F", lineHeight: 1.4 }}>
                <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: connTest.status === "ok" ? COLORS.success : COLORS.danger, boxShadow: "0 0 8px " + (connTest.status === "ok" ? COLORS.success : COLORS.danger), flex: "0 0 auto" }} />
                {connTest.message}
              </span>
            )}
          </div>
        </div>
      )}

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

  // The one pane whose switch is not part of the saved form: it belongs to the
  // device, not to the organization's settings. See PushNotifications.
  const notificationsPane = (
    <div style={pane}>
      <PushNotifications />
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
      <div style={divider} />
      <ToggleRow
        label="Border glow"
        on={settings.ringAnimation}
        onToggle={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, ringAnimation: !s.ringAnimation })); }}
        desc="On: the light sweeps around the border of every button, tab and panel. Off: those borders paint as a flat line."
      />
    </div>
  );

  const panes: Record<SettingsTabId, ReactNode> = {
    connection: connectionPane,
    execution: executionPane,
    dashboard: dashboardPane,
    notifications: notificationsPane,
    appearance: appearancePane,
  };

  return (
    <div style={{ position: "relative", height: "var(--te-app-h)", overflow: "hidden", display: "flex", flexDirection: "column", color: COLORS.text, ["--accent" as string]: COLORS.accent }}>
      <header className="te-page-header" style={{ position: "relative", zIndex: 30, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "14px", padding: "0 28px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "var(--te-header-bg)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <PageHeading title="Settings" kicker="D-AGENT · CONFIGURATION" icon={<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>} />
        <div style={{ flex: 1 }} />
        <NotificationCenter />
        <ProviderBadge provider={pm.id} />
      </header>

      <main className="te-scroll te-main" style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", padding: "22px 28px 28px", background: "var(--te-page-veil)" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: "80px" }}><LoadingRing size={120} /></div>
        ) : (
          <div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "22px" }}>
            <div className="te-tabs-scroll te-scroll" style={{ display: "flex", alignItems: "center", gap: "6px", borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
              {TABS.map((t) => (
                <button key={t.id} onClick={(e) => { fireBoltFromEvent(e); setTab(t.id); }} style={tabStyle({ active: tab === t.id })}>
                  {t.label}
                </button>
              ))}
            </div>

            <motion.div key={tab} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ease: MOTION.easeExpo, duration: MOTION.nav }}>
              {panes[tab]}
            </motion.div>

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
    </div>
  );
}
