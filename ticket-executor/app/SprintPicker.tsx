"use client";

import { useEffect, useRef, useState } from "react";
import { dropdownPanelStyle, pill, ringBorder } from "@/lib/ui";

export type IterationOption = {
  id: string;
  name: string;
  timeFrame?: "past" | "current" | "future";
};

// Themed sprint picker for the header chip: same spinning conic-gradient pill
// as the rest of the app, with a custom dark dropdown panel (native <select>
// can't be restyled to match). Falls back to a plain label when there is
// nothing to pick from (non-ADO providers).
export default function SprintPicker({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: IterationOption[];
  value: string;
  onSelect: (name: string, e: { clientX: number; clientY: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hasOptions = options.length > 0;

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
        onClick={() => hasOptions && setOpen((o) => !o)}
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
        <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#35D6A4", boxShadow: "0 0 8px #35D6A4", flex: "0 0 auto" }} />
        <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#C7CCD8", whiteSpace: "nowrap" }}>{label || "—"}</span>
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
            left: 0,
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
                key={o.id}
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
                  fontSize: "12.5px",
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
                {o.timeFrame === "current" && (
                  <span
                    style={{
                      ...pill({ color: "#35D6A4", background: "rgba(53,214,164,.12)", size: "xs", weight: 700 }),
                      fontSize: "9.5px",
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
