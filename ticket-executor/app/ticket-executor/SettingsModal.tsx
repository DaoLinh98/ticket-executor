"use client";

import type { CSSProperties, Dispatch, MouseEvent, SetStateAction } from "react";
import SelectMenu from "../SelectMenu";
import { PROVIDERS, type ProviderMeta } from "@/lib/providers";
import { card, clipCorner, modalShellStyle, ringBorder, tintedCard } from "@/lib/ui";
import type { ConnTest, SettingsView } from "./types";
import LoadingRing from "./LoadingRing";
import { useBoltsContext } from "../BoltsContext";

const fieldInputStyle: CSSProperties = {
  height: "40px", padding: "0 13px", border: "1px solid #262B36", borderRadius: "9px",
  background: "#0E1015", color: "#ECEEF3", fontFamily: "var(--font-mono), monospace",
  fontSize: "13px", outline: "none",
};
const fieldLabelStyle: CSSProperties = {
  fontSize: "11px", letterSpacing: ".1em", fontWeight: 600, color: "#8A90A0",
};

type Props = {
  settings: SettingsView;
  setSettings: Dispatch<SetStateAction<SettingsView>>;
  setField: (k: keyof SettingsView) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  pm: ProviderMeta;
  connTest: ConnTest;
  settingsError: string;
  onProviderChange: (label: string) => void;
  onTestConnection: () => void;
  onSave: (e?: MouseEvent) => void;
  onClose: (e?: MouseEvent) => void;
};

// Connection + execution-defaults modal. Field labels/placeholders come from the
// active provider's metadata; the stored token is never sent back to the client.
export default function SettingsModal({
  settings, setSettings, setField, pm, connTest, settingsError,
  onProviderChange, onTestConnection, onSave, onClose,
}: Props) {
  const { fireBoltFromEvent } = useBoltsContext();
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(6,7,9,.68)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn .2s both" }} onClick={onClose}>
      <div style={{ width: "95%", maxWidth: "980px", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", ...modalShellStyle() }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 28px", borderBottom: "1px solid #1E232C", flex: "0 0 auto" }}>
          <div><div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: "17px", fontWeight: 700, color: "#F3F5F9" }}>Settings</div><div style={{ fontSize: "12.5px", color: "#6B7283", marginTop: "3px" }}>Connect your work-tracking provider &amp; execution defaults</div></div>
          <button onClick={onClose} style={{ width: "28px", height: "28px", color: "#8A90A0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", ...ringBorder({ fill: "#1A1E25", duration: 4, cornerPx: 6 }) }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="te-scroll" style={{ padding: "26px 28px", display: "flex", flexDirection: "column", gap: "20px", overflowY: "auto", flex: "1 1 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={fieldLabelStyle}>PROVIDER</span>
              <div style={{ ...card({ padding: "0 13px", background: "#0E1015" }), height: "40px", display: "flex", alignItems: "center" }}>
                <SelectMenu value={pm.name} onChange={onProviderChange} options={PROVIDERS.map((p) => p.name)} ariaLabel="Provider" />
              </div>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={fieldLabelStyle}>SCOPE</span>
              <div style={{ display: "flex", gap: "8px" }}>
                {(["team", "personal"] as const).map((sc) => {
                  const active = settings.scope === sc;
                  return (
                    <button
                      key={sc}
                      onClick={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, scope: sc })); }}
                      style={{
                        flex: 1, height: "40px", fontSize: "13px", fontWeight: 700, cursor: "pointer",
                        textTransform: "capitalize", color: active ? "#F3F5F9" : "#8A90A0",
                        ...(active
                          ? ringBorder({ fill: "#171A21", duration: 3.4, cornerPx: 7 })
                          : { border: "1.5px solid #262B36", background: "#0E1015", clipPath: clipCorner(7) }),
                      }}
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
              <span style={fieldLabelStyle}>YOUR {pm.name.toUpperCase()} ACCOUNT</span>
              <input value={settings.personalAccount} onChange={setField("personalAccount")} placeholder="you@company.com or display name" style={fieldInputStyle} />
              <span style={{ fontSize: "11.5px", color: "#5B6273", lineHeight: 1.5 }}>Only tickets assigned to this account and PR review notifications it authored will be shown.</span>
            </label>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}><span style={fieldLabelStyle}>{pm.urlLabel}</span><input value={settings.org} onChange={setField("org")} placeholder={pm.urlPlaceholder} style={fieldInputStyle} /></label>
            <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}><span style={fieldLabelStyle}>{pm.tokenLabel}</span><input type="password" value={settings.pat} onChange={setField("pat")} placeholder={settings.hasPat ? "•••••••••••••• (saved)" : "••••••••••••••••"} style={fieldInputStyle} /></label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "11px" }}>
            <button onClick={(e) => { fireBoltFromEvent(e); onTestConnection(); }} disabled={connTest.status === "testing"} style={{ display: "inline-flex", alignItems: "center", gap: "7px", height: "30px", padding: "0 13px", border: "1.5px solid #2A2F3A", background: "#0E1015", color: "#C7CCD8", fontSize: "12px", fontWeight: 600, cursor: connTest.status === "testing" ? "default" : "pointer", clipPath: clipCorner(7) }}>
              {connTest.status === "testing" ? <LoadingRing size={13} /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h7l-1 8 10-12h-7z" /></svg>}
              Test connection
            </button>
            {connTest.status !== "idle" && connTest.status !== "testing" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600, color: connTest.status === "ok" ? "#5BE8B8" : "#FF8F8F", lineHeight: 1.4 }}>
                <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: connTest.status === "ok" ? "#35D6A4" : "#FF6B6B", boxShadow: "0 0 8px " + (connTest.status === "ok" ? "#35D6A4" : "#FF6B6B"), flex: "0 0 auto" }} />
                {connTest.message}
              </span>
            )}
          </div>
          <span style={{ fontSize: "11.5px", color: "#5B6273", lineHeight: 1.55 }}>Root repo, project and skill are set per ticket on the Overview tab. The current sprint is loaded automatically from the selected provider.</span>
          <div style={{ height: "1px", background: "#1E232C" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
            <div>
              <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#ECEEF3" }}>Multi-ticket mode</div>
              <div style={{ fontSize: "12px", color: "#6B7283", marginTop: "2px", lineHeight: 1.5 }}>
                On: select multiple tickets and run them concurrently, each isolated in its own git worktree.<br />
                Off: one ticket at a time, run directly in the root repo — simplest and most reliable for a single run.
              </div>
            </div>
            <button
              onClick={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, multiTicketMode: !s.multiTicketMode })); }}
              aria-pressed={settings.multiTicketMode}
              title="Toggle multi-ticket mode"
              style={{
                position: "relative", flex: "0 0 auto", width: "42px", height: "24px", borderRadius: "999px",
                border: "none", cursor: "pointer",
                background: settings.multiTicketMode ? "var(--accent)" : "#2A2F3A",
                transition: "background .18s",
              }}
            >
              <span
                style={{
                  position: "absolute", top: "3px", left: settings.multiTicketMode ? "21px" : "3px",
                  width: "18px", height: "18px", borderRadius: "50%", background: "#0B0C10",
                  transition: "left .18s",
                }}
              />
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateRows: settings.multiTicketMode ? "1fr" : "0fr",
              opacity: settings.multiTicketMode ? 1 : 0,
              transition: "grid-template-rows .28s ease, opacity .22s ease",
            }}
          >
            <div style={{ overflow: "hidden", display: "flex", flexDirection: "column", gap: "20px" }}>
              <div style={{ height: "1px", background: "#1E232C" }} />
              <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={fieldLabelStyle}>CONCURRENT RUNS</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.concurrentRuns}
                  onChange={(e) => setSettings((s) => ({ ...s, concurrentRuns: Math.max(1, Math.min(20, Number(e.target.value) || 1)) }))}
                  style={{ ...fieldInputStyle, width: "120px" }}
                />
                <span style={{ fontSize: "11.5px", color: "#5B6273", lineHeight: 1.5 }}>Runs beyond this limit wait in a queue until a slot frees up.</span>
              </label>
            </div>
          </div>
          <div style={{ height: settings.multiTicketMode ? 0 : "1px", background: "#1E232C", transition: "height .22s ease" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
            <div>
              <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#ECEEF3" }}>Auto-implementation</div>
              <div style={{ fontSize: "12px", color: "#6B7283", marginTop: "2px", lineHeight: 1.5 }}>
                On: run to a PR in one shot (<span style={{ fontFamily: "var(--font-mono), monospace" }}>implement-ticket-v2</span>).<br />
                Off: draft a plan and wait for your review before coding (<span style={{ fontFamily: "var(--font-mono), monospace" }}>implement-ticket-v3</span>).
              </div>
            </div>
            <button
              onClick={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, autoImplement: !s.autoImplement })); }}
              aria-pressed={settings.autoImplement}
              title="Toggle auto-implementation mode"
              style={{
                position: "relative", flex: "0 0 auto", width: "42px", height: "24px", borderRadius: "999px",
                border: "none", cursor: "pointer",
                background: settings.autoImplement ? "var(--accent)" : "#2A2F3A",
                transition: "background .18s",
              }}
            >
              <span
                style={{
                  position: "absolute", top: "3px", left: settings.autoImplement ? "21px" : "3px",
                  width: "18px", height: "18px", borderRadius: "50%", background: "#0B0C10",
                  transition: "left .18s",
                }}
              />
            </button>
          </div>
          <div style={{ height: "1px", background: "#1E232C" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
            <div>
              <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#ECEEF3" }}>Auto-resolve code review</div>
              <div style={{ fontSize: "12px", color: "#6B7283", marginTop: "2px", lineHeight: 1.5 }}>
                On: resolve every open review thread in one shot (<span style={{ fontFamily: "var(--font-mono), monospace" }}>fix-code-review-v2</span>).<br />
                Off: draft a resolution plan and wait for your review before coding (<span style={{ fontFamily: "var(--font-mono), monospace" }}>fix-code-review-v3</span>).
              </div>
            </div>
            <button
              onClick={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, autoResolveCodeReview: !s.autoResolveCodeReview })); }}
              aria-pressed={settings.autoResolveCodeReview}
              title="Toggle auto-resolve-code-review mode"
              style={{
                position: "relative", flex: "0 0 auto", width: "42px", height: "24px", borderRadius: "999px",
                border: "none", cursor: "pointer",
                background: settings.autoResolveCodeReview ? "var(--accent)" : "#2A2F3A",
                transition: "background .18s",
              }}
            >
              <span
                style={{
                  position: "absolute", top: "3px", left: settings.autoResolveCodeReview ? "21px" : "3px",
                  width: "18px", height: "18px", borderRadius: "50%", background: "#0B0C10",
                  transition: "left .18s",
                }}
              />
            </button>
          </div>
          <div style={{ height: "1px", background: "#1E232C" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
            <div>
              <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#ECEEF3" }}>Animated background</div>
              <div style={{ fontSize: "12px", color: "#6B7283", marginTop: "2px" }}>Turn off to freeze the 3D reactor backdrop.</div>
            </div>
            <button
              onClick={(e) => { fireBoltFromEvent(e); setSettings((s) => ({ ...s, animatedBackground: !s.animatedBackground })); }}
              aria-pressed={settings.animatedBackground}
              title="Toggle animated background"
              style={{
                position: "relative", flex: "0 0 auto", width: "42px", height: "24px", borderRadius: "999px",
                border: "none", cursor: "pointer",
                background: settings.animatedBackground ? "var(--accent)" : "#2A2F3A",
                transition: "background .18s",
              }}
            >
              <span
                style={{
                  position: "absolute", top: "3px", left: settings.animatedBackground ? "21px" : "3px",
                  width: "18px", height: "18px", borderRadius: "50%", background: "#0B0C10",
                  transition: "left .18s",
                }}
              />
            </button>
          </div>
          {settingsError && (
            <div style={{ display: "flex", gap: "9px", alignItems: "flex-start", ...tintedCard("danger", { padding: "11px 13px", radius: "10px" }) }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" strokeWidth="2" style={{ flex: "0 0 auto", marginTop: "1px" }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
              <span style={{ fontSize: "12.5px", color: "#FF8F8F", lineHeight: 1.5 }}>{settingsError}</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", padding: "20px 28px", borderTop: "1px solid #1E232C", background: "#101318", flex: "0 0 auto" }}>
          <button onClick={onClose} style={{ height: "32px", padding: "0 16px", border: "1.5px solid #2A2F3A", background: "transparent", color: "#C7CCD8", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", clipPath: clipCorner(7), transition: "border-color .15s,color .15s,transform .12s" }}>Cancel</button>
          <button onClick={onSave} style={{ height: "32px", padding: "0 18px", color: "#0B0C10", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", ...ringBorder({ fill: "var(--accent)", variant: "filled", duration: 3, cornerPx: 7 }) }}>Save changes</button>
        </div>
      </div>
    </div>
  );
}
