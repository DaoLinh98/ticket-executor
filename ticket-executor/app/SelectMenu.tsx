"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { dropdownPanelStyle, ringBorder } from "@/lib/ui";

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
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  /** When set, an extra leading option with value "" is offered, labeled e.g. "Status: All". */
  allLabel?: string;
  ariaLabel?: string;
  variant?: "filter" | "field";
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const active = !!value;
  const list = allLabel ? ["", ...options] : options;

  const buttonStyle: CSSProperties =
    variant === "filter"
      ? {
          position: "relative",
          width: "100%",
          height: "32px",
          padding: "0 26px 0 11px",
          border: active ? "1.5px solid transparent" : "1px solid #262B36",
          borderRadius: "9px",
          background: active ? undefined : "#14171D",
          color: active ? "#F3F5F9" : "#8A90A0",
          fontSize: "12px",
          fontWeight: 600,
          textAlign: "left",
          cursor: "pointer",
          ...(active ? ringBorder({ fill: "#14171D", shape: "none", duration: 3.4 }) : {}),
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
          fontSize: "13px",
          color: "#E4E7EE",
          cursor: "pointer",
          textAlign: "left",
        };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button type="button" aria-label={ariaLabel} onClick={() => setOpen((o) => !o)} style={buttonStyle}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {value ? value : allLabel ?? ""}
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
            color: "#5B6273",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .18s",
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          className="te-scroll"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: variant === "filter" ? 0 : "-7px",
            right: variant === "filter" ? 0 : "-7px",
            zIndex: 30,
            animation: "fadeUp .16s ease-out both",
            ...dropdownPanelStyle({ maxHeight: "240px" }),
          }}
        >
          {list.map((o) => {
            const isSel = o === value;
            const label = o === "" ? allLabel ?? "" : o;
            return (
              <button
                key={o || "__all__"}
                type="button"
                onClick={() => {
                  onChange(o);
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
                  color: isSel ? "var(--accent)" : "#C7CCD8",
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
        </div>
      )}
    </div>
  );
}
