"use client";

import { useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, RefObject } from "react";
import type { AskState } from "@/lib/ask";
import { COLORS, FONT, card, ctaButtonStyle, dropdownPanelStyle, pill, ringBorder, tintedCard } from "@/lib/ui";
import type { LogLineView } from "../types";
import LoadingRing from "../LoadingRing";

type Props = {
  rootRepo: string;
  logLines: LogLineView[];
  state: AskState;
  /** The next prompt continues the session already open in this repo. */
  resuming: boolean;
  error: string;
  prompt: string;
  /** Every skill installed on this machine, for the `/` picker. */
  skillOptions: string[];
  onPromptChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  onReset: () => void;
  logRef: RefObject<HTMLDivElement | null>;
};

const STATUS: Record<AskState, [string, string]> = {
  idle: ["ready", "#5B6273"],
  running: ["running", "#F5B341"],
  failed: ["failed", "#FF6B6B"],
};

// A terminal you can type into from a phone: the same Claude CLI the Open
// Terminal button launches, run in the ticket's Root repo on this machine, with
// its output streamed back here.
export default function AskTab({
  rootRepo, logLines, state, resuming, error, prompt, skillOptions, onPromptChange, onSend, onCancel, onReset, logRef,
}: Props) {
  const running = state === "running";
  const ready = !!rootRepo.trim();
  const canSend = ready && !running && !!prompt.trim();
  const [statusLabel, statusColor] = STATUS[state];

  // The terminal pops the skill list open on `/`; typing the whole name from
  // memory on a phone keyboard is the thing this replaces. Only while the skill
  // name itself is being typed — once there is a space, the rest is arguments.
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [picked, setPicked] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const token = /^\/(\S*)$/.exec(prompt);
  const matches = token
    ? skillOptions.filter((s) => s.toLowerCase().includes(token[1].toLowerCase())).slice(0, 8)
    : [];
  const menuOpen = !dismissed && matches.length > 0;
  const active = Math.min(picked, matches.length - 1);

  const choose = (skill: string) => {
    onPromptChange(`/${skill} `);
    setDismissed(true);
    setPicked(0);
    taRef.current?.focus();
  };

  const changePrompt = (value: string) => {
    onPromptChange(value);
    setDismissed(false);
    setPicked(0);
  };

  const statusStyle: CSSProperties = {
    letterSpacing: ".1em", textTransform: "uppercase",
    ...pill({ color: statusColor, background: "rgba(255,255,255,.04)", border: statusColor + "55", size: "xs", weight: 700 }),
    padding: "2px 9px",
  };

  // Enter sends, Shift+Enter breaks the line — a phone keyboard has no other way
  // to send, and a multi-line prompt is still worth being able to write.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // While the picker is open the arrows and Enter belong to it, exactly as
    // they do in the CLI.
    if (menuOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setPicked((i) => {
          const next = e.key === "ArrowDown" ? i + 1 : i - 1;
          return (next + matches.length) % matches.length;
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(matches[active]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  if (!ready) {
    return (
      <div style={{ display: "flex", gap: "9px", alignItems: "flex-start", ...tintedCard("warning", { padding: "10px 13px", radius: "10px" }) }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" strokeWidth="2" style={{ stroke: COLORS.warning, flex: "0 0 auto", marginTop: "1px" }}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
        <span style={{ fontSize: FONT.base, color: COLORS.warning, lineHeight: 1.55 }}>
          Set <strong>ROOT REPO</strong> on the Overview tab first — it is the folder Claude runs in.
        </span>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "14px", animation: "fadeUp .4s both" }}>
      <div style={{ position: "relative", borderRadius: "13px", overflow: "hidden", boxShadow: "0 24px 60px -34px #000", ...ringBorder({ fill: "#0A0B0E", duration: 5.5, shape: "none" }) }}>
        <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", background: "repeating-linear-gradient(0deg,rgba(255,255,255,.016) 0px,rgba(255,255,255,.016) 1px,transparent 1px,transparent 3px)" }} />
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: "10px", padding: "11px 15px", borderBottom: "1px solid #1A1E25", background: "#0E1015" }}>
          <span style={{ display: "flex", gap: "6px" }}><span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#3A3030" }} /><span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#3A3830" }} /><span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#2F3A32" }} /></span>
          <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, color: "#6B7283", marginLeft: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>claude — {rootRepo}</span>
          <div style={{ flex: 1 }} />
          {resuming && <span style={{ fontSize: FONT.xs, color: COLORS.textMuted, letterSpacing: ".08em" }}>SESSION</span>}
          <span style={statusStyle}>{statusLabel}</span>
        </div>
        <div ref={logRef} className="te-scroll te-ask-log" style={{ position: "relative", zIndex: 1, height: "420px", overflowY: "auto", padding: "14px 17px", fontFamily: "var(--font-mono), monospace", fontSize: FONT.base, lineHeight: 1.75 }}>
          {logLines.length === 0 && <div style={{ color: "#5B6273" }}>Ask anything. It runs on the machine hosting this app, in {rootRepo}.</div>}
          {logLines.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: "12px" }}>
              <span style={l.style}>{l.text}</span>
            </div>
          ))}
          {running && <span style={{ display: "inline-block", width: "8px", height: "15px", background: "var(--accent)", verticalAlign: "text-bottom", animation: "blink 1s step-end infinite" }} />}
        </div>
      </div>

      {state === "failed" && error && (
        <div style={{ display: "flex", gap: "13px", alignItems: "flex-start", ...tintedCard("danger") }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" strokeWidth="2" style={{ flex: "0 0 auto", marginTop: "1px" }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
          <div style={{ fontSize: FONT.base, color: "#C7A8A8", lineHeight: 1.55 }}>{error}</div>
        </div>
      )}

      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: "10px", ...card({ padding: "13px 15px" }) }}>
        {menuOpen && (
          <div className="te-scroll" style={{ position: "absolute", bottom: "calc(100% - 8px)", left: "15px", right: "15px", zIndex: 20, animation: "fadeUp .16s ease-out both", ...dropdownPanelStyle({ maxHeight: "260px" }) }}>
            {matches.map((s, i) => (
              // onMouseDown, not onClick: a tap must not blur the textarea first,
              // or the picker unmounts before the choice lands.
              <button
                key={s}
                onMouseDown={(e) => { e.preventDefault(); choose(s); }}
                onMouseEnter={() => setPicked(i)}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "9px 10px", borderRadius: "8px",
                  border: "none", cursor: "pointer", fontFamily: "var(--font-mono), monospace", fontSize: FONT.base,
                  background: i === active ? "rgba(251,114,80,.14)" : "transparent",
                  color: i === active ? "var(--accent)" : COLORS.textSoft,
                  fontWeight: i === active ? 700 : 500,
                }}
              >
                /{s}
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          value={prompt}
          onChange={(e) => changePrompt(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          className="te-ask-input"
          placeholder="Ask Claude to do something in this repo — or type / for a skill"
          aria-label="Prompt for Claude"
          style={{
            width: "100%", resize: "vertical", minHeight: "72px", padding: "10px 12px",
            borderRadius: "9px", border: `1px solid ${COLORS.borderSubtle}`, background: COLORS.panelBgDark,
            color: COLORS.text, fontFamily: "var(--font-mono), monospace", fontSize: FONT.md, lineHeight: 1.6,
            outline: "none",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ flex: 1, minWidth: "120px", fontSize: FONT.sm, color: COLORS.textMuted }}>
            {menuOpen ? "Tap a skill, or Enter to pick it" : "Enter sends · Shift+Enter new line · / for skills"}
          </span>
          <button
            onClick={onReset}
            disabled={running}
            title="Forget this conversation and start a fresh Claude session"
            style={{ ...ctaButtonStyle("ghost", { height: "30px", cornerPx: 6 }), opacity: running ? 0.5 : 1, cursor: running ? "default" : "pointer" }}
          >
            New session
          </button>
          {running ? (
            <button onClick={onCancel} style={ctaButtonStyle("danger", { height: "30px", cornerPx: 6 })}>
              <LoadingRing size={13} />
              Stop
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!canSend}
              style={{ ...ctaButtonStyle("primary", { height: "30px", cornerPx: 6 }), opacity: canSend ? 1 : 0.5, cursor: canSend ? "pointer" : "default" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ position: "relative", zIndex: 1 }}><path d="M3 20l18-8L3 4l4 8z" /></svg>
              <span style={{ position: "relative", zIndex: 1 }}>Send</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
