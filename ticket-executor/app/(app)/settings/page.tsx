"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import SelectMenu from "../../SelectMenu";
import LoadingRing from "../../ticket-executor/LoadingRing";
import Toast, { type ToastMessage } from "../../ticket-executor/Toast";
import { SETTINGS_UPDATED_EVENT } from "../../settingsEvents";
import { PROVIDERS, providerMeta, DEFAULT_PROVIDER, type ProviderId } from "@/lib/providers";
import { COLORS, FONT, card, clipCorner, fieldInput, fieldLabel, logoText, ringBorder, tintedCard } from "@/lib/ui";
import type { ConnTest, SettingsView } from "../../ticket-executor/types";
import { useBoltsContext } from "../../BoltsContext";

const DEFAULTS: SettingsView = {
  provider: "azure-devops", org: "", pat: "", hasPat: false,
  animatedBackground: true, clickEffects: true, autoImplement: true, autoResolveCodeReview: true,
  scope: "team", personalAccount: "", concurrentRuns: 2, multiTicketMode: true,
  manageMcp: true, hourlyRateUsd: 0, hoursPerStoryPoint: 6,
};

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

export default function SettingsPage() {
  const { fireBoltFromEvent } = useBoltsContext();
  const [settings, setSettings] = useState<SettingsView>(DEFAULTS);
  const [connTest, setConnTest] = useState<ConnTest>({ status: "idle", message: "" });
  const [error, setError] = useState("");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastSeq = useRef(0);
  const [loading, setLoading] = useState(true);
  const pm = providerMeta(settings.provider);

  // The Toast owns its own countdown (and pauses it on hover), so all this does
  // is hand it a fresh message.
  const showToast = (msg: string, kind: "success" | "error" = "success", ms = 7000) =>
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
    const url = settings.org.trim();
    if (!url) return `${pm.urlLabel} is required.`;
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return "URL must start with http:// or https://";
    } catch {
      return "Enter a valid URL (e.g. https://…).";
    }
    if (!settings.hasPat && !settings.pat.trim()) return `${pm.tokenLabel} is required.`;
    return "";
  };

  const save = async (e?: React.MouseEvent) => {
    const v = validate();
    if (v) { setError(v); return; }
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
      showToast("Settings saved.");
    } catch {
      setError("Failed to save settings");
    }
  };

  const rowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" };
  const divider: CSSProperties = { height: "1px", background: "#1E232C" };

  return (
    <div style={{ position: "relative", height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column", color: COLORS.text, ["--accent" as string]: "#FB7250" }}>
      <header style={{ position: "relative", zIndex: 1, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "14px", padding: "0 28px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "rgba(14,17,23,.72)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <span style={logoText(FONT.xl)}>Settings</span>
        <span style={{ fontSize: FONT.base, color: COLORS.textDim }}>Connect your work-tracking provider &amp; execution defaults</span>
      </header>

      <main className="te-scroll" style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", padding: "28px", background: "linear-gradient(110deg,rgba(6,7,10,.5) 0%,rgba(6,7,10,.22) 52%,rgba(6,7,10,0) 100%)" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: "80px" }}><LoadingRing size={120} /></div>
        ) : (
          <div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>
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
                        style={{ flex: 1, height: "40px", fontSize: FONT.base, fontWeight: 700, cursor: "pointer", textTransform: "capitalize", color: active ? "#F3F5F9" : "#8A90A0", ...(active ? ringBorder({ fill: "#171A21", duration: 3.4, cornerPx: 7 }) : { border: "1.5px solid #262B36", background: "#0E1015", clipPath: clipCorner(7) }) }}
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
                <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.5 }}>Only tickets assigned to this account and PR review notifications it authored will be shown.</span>
              </label>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}><span style={fieldLabel()}>{pm.urlLabel}</span><input value={settings.org} onChange={setField("org")} placeholder={pm.urlPlaceholder} style={fieldInput()} /></label>
              <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}><span style={fieldLabel()}>{pm.tokenLabel}</span><input type="password" value={settings.pat} onChange={setField("pat")} placeholder={settings.hasPat ? "•••••••••••••• (saved)" : "••••••••••••••••"} style={fieldInput()} /></label>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "11px" }}>
              <button onClick={(e) => { fireBoltFromEvent(e); testConnection(); }} disabled={connTest.status === "testing"} style={{ display: "inline-flex", alignItems: "center", gap: "7px", height: "30px", padding: "0 13px", border: "1.5px solid #2A2F3A", background: "#0E1015", color: "#C7CCD8", fontSize: FONT.sm, fontWeight: 600, cursor: connTest.status === "testing" ? "default" : "pointer", clipPath: clipCorner(7) }}>
                {connTest.status === "testing" ? <LoadingRing size={13} /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h7l-1 8 10-12h-7z" /></svg>}
                Test connection
              </button>
              {connTest.status !== "idle" && connTest.status !== "testing" && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: FONT.sm, fontWeight: 600, color: connTest.status === "ok" ? "#5BE8B8" : "#FF8F8F", lineHeight: 1.4 }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: connTest.status === "ok" ? "#35D6A4" : "#FF6B6B", boxShadow: "0 0 8px " + (connTest.status === "ok" ? "#35D6A4" : "#FF6B6B"), flex: "0 0 auto" }} />
                  {connTest.message}
                </span>
              )}
            </div>
            <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.55 }}>Connect at the organization level — the project is chosen on the Projects page or the Ticket Execution dropdown, and the current sprint loads automatically per project.</span>

            <div style={divider} />
            <div style={rowStyle}>
              <div>
                <div style={{ fontSize: FONT.md, fontWeight: 700, color: COLORS.text }}>Manage MCP for me</div>
                <div style={{ fontSize: FONT.sm, color: COLORS.textDim, marginTop: "2px", lineHeight: 1.5 }}>
                  On: each run gets a {pm.name} MCP server generated from the connection above, so Claude can read the
                  ticket with nothing to set up by hand. If you already configured your own, the app steps aside.<br />
                  Off: the app never touches MCP — System Check only verifies whatever this machine already has.
                </div>
              </div>
              <Toggle on={settings.manageMcp} title="Toggle app-managed MCP" onToggle={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, manageMcp: !s.manageMcp })); }} />
            </div>

            <div style={divider} />
            <div style={rowStyle}>
              <div>
                <div style={{ fontSize: FONT.md, fontWeight: 700, color: COLORS.text }}>Multi-ticket mode</div>
                <div style={{ fontSize: FONT.sm, color: COLORS.textDim, marginTop: "2px", lineHeight: 1.5 }}>
                  On: select multiple tickets and run them concurrently, each isolated in its own git worktree.<br />
                  Off: one ticket at a time, run directly in the root repo — simplest and most reliable for a single run.
                </div>
              </div>
              <Toggle on={settings.multiTicketMode} title="Toggle multi-ticket mode" onToggle={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, multiTicketMode: !s.multiTicketMode })); }} />
            </div>
            <div style={{ display: "grid", gridTemplateRows: settings.multiTicketMode ? "1fr" : "0fr", opacity: settings.multiTicketMode ? 1 : 0, transition: "grid-template-rows .28s ease, opacity .22s ease" }}>
              <div style={{ overflow: "hidden", display: "flex", flexDirection: "column", gap: "20px" }}>
                <div style={divider} />
                <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={fieldLabel()}>CONCURRENT RUNS</span>
                  <input type="number" min={1} max={20} value={settings.concurrentRuns} onChange={(e) => setSettings((s) => ({ ...s, concurrentRuns: Math.max(1, Math.min(20, Number(e.target.value) || 1)) }))} style={{ ...fieldInput(), width: "120px" }} />
                  <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.5 }}>Runs beyond this limit wait in a queue until a slot frees up.</span>
                </label>
              </div>
            </div>

            <div style={divider} />
            <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={fieldLabel()}>BLENDED HOURLY RATE (USD)</span>
                <input type="number" min={0} step={1} value={settings.hourlyRateUsd} onChange={(e) => setSettings((s) => ({ ...s, hourlyRateUsd: Math.max(0, Number(e.target.value) || 0) }))} style={{ ...fieldInput(), width: "140px" }} />
                <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.5, maxWidth: "320px" }}>Prices the Dashboard&apos;s ROI tile against your team&apos;s own ticket estimates. Leave at 0 to hide that tile rather than publish a guessed number.</span>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={fieldLabel()}>HOURS PER STORY POINT</span>
                <input type="number" min={0} step={0.5} value={settings.hoursPerStoryPoint} onChange={(e) => setSettings((s) => ({ ...s, hoursPerStoryPoint: Math.max(0, Number(e.target.value) || 0) }))} style={{ ...fieldInput(), width: "140px" }} />
                <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.5, maxWidth: "320px" }}>Used only when a ticket carries story points instead of an hour estimate.</span>
              </label>
            </div>

            <div style={divider} />
            <div style={rowStyle}>
              <div>
                <div style={{ fontSize: FONT.md, fontWeight: 700, color: COLORS.text }}>Auto-implementation</div>
                <div style={{ fontSize: FONT.sm, color: COLORS.textDim, marginTop: "2px", lineHeight: 1.5 }}>
                  On: run to a PR in one shot (<span style={{ fontFamily: "var(--font-mono), monospace" }}>implement-ticket-v2</span>).<br />
                  Off: draft a plan and wait for your review before coding (<span style={{ fontFamily: "var(--font-mono), monospace" }}>implement-ticket-v3</span>).
                </div>
              </div>
              <Toggle on={settings.autoImplement} title="Toggle auto-implementation mode" onToggle={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, autoImplement: !s.autoImplement })); }} />
            </div>

            <div style={divider} />
            <div style={rowStyle}>
              <div>
                <div style={{ fontSize: FONT.md, fontWeight: 700, color: COLORS.text }}>Auto-resolve code review</div>
                <div style={{ fontSize: FONT.sm, color: COLORS.textDim, marginTop: "2px", lineHeight: 1.5 }}>
                  On: resolve every open review thread in one shot (<span style={{ fontFamily: "var(--font-mono), monospace" }}>fix-code-review-v2</span>).<br />
                  Off: draft a resolution plan and wait for your review before coding (<span style={{ fontFamily: "var(--font-mono), monospace" }}>fix-code-review-v3</span>).
                </div>
              </div>
              <Toggle on={settings.autoResolveCodeReview} title="Toggle auto-resolve-code-review mode" onToggle={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, autoResolveCodeReview: !s.autoResolveCodeReview })); }} />
            </div>

            <div style={divider} />
            <div style={rowStyle}>
              <div>
                <div style={{ fontSize: FONT.md, fontWeight: 700, color: COLORS.text }}>Animated background</div>
                <div style={{ fontSize: FONT.sm, color: COLORS.textDim, marginTop: "2px" }}>Turn off to freeze the 3D reactor backdrop.</div>
              </div>
              <Toggle on={settings.animatedBackground} title="Toggle animated background" onToggle={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, animatedBackground: !s.animatedBackground })); }} />
            </div>

            <div style={divider} />
            <div style={rowStyle}>
              <div>
                <div style={{ fontSize: FONT.md, fontWeight: 700, color: COLORS.text }}>Lightning effects</div>
                <div style={{ fontSize: FONT.sm, color: COLORS.textDim, marginTop: "2px", lineHeight: 1.5 }}>
                  On: a bolt strikes where you click, and every spinner (the buttons of a running ticket) keeps
                  striking itself while it spins.<br />
                  Off: no bolts at all — clicks and running buttons stay still.
                </div>
              </div>
              <Toggle on={settings.clickEffects} title="Toggle lightning effects" onToggle={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, clickEffects: !s.clickEffects })); }} />
            </div>

            {error && (
              <div style={{ display: "flex", gap: "9px", alignItems: "flex-start", ...tintedCard("danger", { padding: "11px 13px", radius: "10px" }) }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" strokeWidth="2" style={{ flex: "0 0 auto", marginTop: "1px" }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
                <span style={{ fontSize: FONT.base, color: "#FF8F8F", lineHeight: 1.5 }}>{error}</span>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "12px", paddingTop: "4px" }}>
              <button onClick={save} style={{ height: "34px", padding: "0 20px", color: "#0B0C10", fontSize: FONT.base, fontWeight: 700, cursor: "pointer", ...ringBorder({ fill: "var(--accent)", variant: "filled", duration: 3, cornerPx: 7 }) }}>Save changes</button>
            </div>
          </div>
        )}
      </main>
      {toast && <Toast key={toast.id} toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
