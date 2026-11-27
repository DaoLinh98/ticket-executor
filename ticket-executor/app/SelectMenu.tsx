"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence } from "motion/react";
import { COLORS, FONT, dropdownPanelStyle, fieldInput, ringBorder } from "@/lib/ui";
import { useBoltsContext } from "./BoltsContext";
import { MenuPanel } from "./MenuPanel";

export type SelectOption = string | { value: string; label: string };

// Themed, non-creatable dropdown — same button+panel pattern as the ticket
// status dropdown (dropdownPanelStyle-based menu), reused for the ticket-list
// filter bar and for fixed-choice fields (Model/Effort) on the Overview tab.
export default function SelectMenu({
  value,
  onChange,
  options,
  allLabel,
  ariaLabel,
  variant = "field",
  alwaysGlow = false,
  maxHeight = "240px",
  valueColor,
  disabled = false,
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  /** When set, an extra leading option with value "" is offered, labeled e.g. "Status: All". */
  allLabel?: string;
  ariaLabel?: string;
  variant?: "filter" | "field" | "input";
  /** Keep the spinning ring on even with no value selected — for standalone header
   *  controls (e.g. the Dashboard's Provider/Project pickers) that should always read
   *  as a live control, unlike the sidebar's optional refinement filters. */
  alwaysGlow?: boolean;
  maxHeight?: string;
  /** Pass-through for the colour of an `input` variant's value. */
  valueColor?: string;
  disabled?: boolean;
  /** Wrapper width for an `input` variant (default: fill the cell). */
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { fireBoltFromEvent } = useBoltsContext();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const active = !!value || alwaysGlow;
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const list = allLabel ? [{ value: "", label: allLabel }, ...opts] : opts;
  const shown = opts.find((o) => o.value === value)?.label ?? (value || allLabel || "");

  const buttonStyle: CSSProperties =
    variant === "input"
      ? {
          ...fieldInput({ height: "32px", fontSize: FONT.sm }),
          display: "flex",
          alignItems: "center",
          gap: "6px",
          width: "100%",
          padding: "0 8px 0 10px",
          color: valueColor ?? COLORS.text,
          fontWeight: 600,
          textAlign: "left",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
          transition: "filter .15s",
        }
      : variant === "filter"
      ? {
          position: "relative",
          width: "100%",
          height: "32px",
          padding: "0 26px 0 11px",
          border: active ? "1.5px solid transparent" : "1px solid var(--te-border)",
          borderRadius: "9px",
          background: active ? undefined : "var(--te-raised-bg)",
          color: active ? "var(--te-text)" : "var(--te-text-dim)",
          fontSize: FONT.sm,
          fontWeight: 600,
          textAlign: "left",
          cursor: "pointer",
          ...(active ? ringBorder({ fill: "var(--te-raised-bg)", shape: "none", duration: 3.4 }) : {}),
        }
      : {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          width: "100%",
          border: "none",
          outline: "none",
          background: "transparent",
          padding: 0,
          fontFamily: "var(--font-mono), monospace",
          fontSize: FONT.base,
          color: "var(--te-text)",
          cursor: "pointer",
          textAlign: "left",
        };

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: variant === "field" ? 1 : undefined, minWidth: 0, width }}>
      <button type="button" aria-label={ariaLabel} disabled={disabled} onClick={(e) => { fireBoltFromEvent(e); setOpen((o) => !o); }} style={buttonStyle}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {shown}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            position: variant === "filter" ? "absolute" : "static",
            right: variant === "filter" ? "9px" : undefined,
            top: variant === "filter" ? "9px" : undefined,
            flex: "0 0 auto",
            color: "var(--te-faint)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .2s var(--te-ease-out)",
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <AnimatePresence>
      {open && (
        <MenuPanel
          className="te-scroll"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: variant === "field" ? "-7px" : 0,
            right: variant === "field" ? "-7px" : 0,
            zIndex: 30,
            ...dropdownPanelStyle({ maxHeight, ...(variant === "input" ? { minWidth: "max-content" } : {}) }),
          }}
        >
          {list.map((o) => {
            const isSel = o.value === value;
            const label = o.label;
            return (
              <button
                key={o.value || "__all__"}
                type="button"
                onClick={(e) => {
                  fireBoltFromEvent(e);
                  onChange(o.value);
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 9px",
                  borderRadius: "7px",
                  border: "none",
                  cursor: "pointer",
                  background: isSel ? "rgba(251,114,80,.12)" : "transparent",
                  color: isSel ? "var(--accent)" : "var(--te-text-soft)",
                  fontFamily: variant === "field" ? "var(--font-mono), monospace" : undefined,
                  fontSize: variant === "field" ? "12.5px" : "12.5px",
                  fontWeight: isSel ? 700 : 500,
                  transition: "background .12s",
                }}
              >
                {label}
              </button>
            );
          })}
        </MenuPanel>
      )}
      </AnimatePresence>
    </div>
  );
}
