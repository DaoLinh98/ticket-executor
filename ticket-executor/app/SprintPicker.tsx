"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FONT, dropdownPanelStyle, pill, ringBorder } from "@/lib/ui";
import { useBoltsContext } from "./BoltsContext";

export type IterationOption = {
  id?: string;
  name: string;
  /** The provider's rooted iteration path, when it has one. Not rendered — it
   *  is what the caller sends back when loading that sprint's tickets. */
  path?: string;
  timeFrame?: "past" | "current" | "future";
};

// Themed picker for the header chip: same spinning conic-gradient pill as the
// rest of the app, with a custom dark dropdown panel (native <select> can't be
// restyled to match). Falls back to a plain label when there is nothing to pick
// from (non-ADO providers). Used for both the sprint picker (default green dot)
// and the project picker (custom `leading` icon).
const defaultLeading = (
  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#35D6A4", boxShadow: "0 0 8px #35D6A4", flex: "0 0 auto" }} />
);
export default function SprintPicker({
  label,
  options,
  value,
  onSelect,
  leading = defaultLeading,
  currentName = "",
  align = "left",
}: {
  label: string;
  options: IterationOption[];
  value: string;
  onSelect: (name: string, e: { clientX: number; clientY: number }) => void;
  leading?: ReactNode;
  /** The one option to mark CURRENT. Named explicitly rather than read off each
   *  option's `timeFrame`, which is date-derived: a project with per-team
   *  iteration sub-trees really does have several sprints spanning today, and
   *  badging all of them says "current" about sprints the app is not on. */
  currentName?: string;
  /** Which edge the panel hangs from. "right" for a picker near the window's
   *  right edge, where a left-aligned panel would open off screen. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hasOptions = options.length > 0;
  const { fireBoltFromEvent } = useBoltsContext();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: "relative", marginLeft: "8px" }}>
      <button
        type="button"
        onClick={(e) => { if (hasOptions) { fireBoltFromEvent(e); setOpen((o) => !o); } }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          height: "34px",
          padding: "0 13px",
          cursor: hasOptions ? "pointer" : "default",
          color: "inherit",
          font: "inherit",
          ...ringBorder({ fill: "#14171D", shape: "pill", duration: 4 }),
        }}
      >
        {leading}
        <span className="te-picker-label" style={{ fontSize: FONT.base, fontWeight: 600, color: "#C7CCD8", whiteSpace: "nowrap" }}>{label || "—"}</span>
        {hasOptions && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#8A90A0"
            strokeWidth="2.4"
            style={{ flex: "0 0 auto", transform: open ? "rotate(180deg)" : "none", transition: "transform .18s" }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      {open && hasOptions && (
        <div
          className="te-scroll"
          style={{
            position: "absolute",
            top: "calc(100% + 10px)",
            ...(align === "right" ? { right: 0 } : { left: 0 }),
            zIndex: 40,
            animation: "fadeUp .16s ease-out both",
            ...dropdownPanelStyle({ minWidth: "230px", maxHeight: "340px" }),
            borderRadius: "13px",
            boxShadow: "0 26px 64px -22px rgba(0,0,0,.7), 0 0 0 1px rgba(251,114,80,.06)",
            padding: "6px",
          }}
        >
          {options.map((o) => {
            const isSel = o.name === value;
            return (
              <button
                // Keyed on the provider's identifier, then its path, then the
                // name — two releases can each hold a "Sprint 1", and the
                // project picker's options carry no id at all.
                key={o.id || o.path || o.name}
                type="button"
                onClick={(e) => {
                  onSelect(o.name, e);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                  background: isSel ? "rgba(251,114,80,.14)" : "transparent",
                  color: isSel ? "var(--accent)" : "#C7CCD8",
                  fontSize: FONT.base,
                  fontWeight: isSel ? 700 : 500,
                  transition: "background .12s, color .12s",
                }}
                onMouseEnter={(e) => {
                  if (!isSel) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,.05)";
                }}
                onMouseLeave={(e) => {
                  if (!isSel) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
              >
                <span>{o.name}</span>
                {o.name === currentName && (
                  <span
                    style={{
                      ...pill({ color: "#35D6A4", background: "rgba(53,214,164,.12)", size: "xs", weight: 700 }),
                      fontSize: FONT.xs,
                      letterSpacing: ".05em",
                      flex: "0 0 auto",
                    }}
                  >
                    CURRENT
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
