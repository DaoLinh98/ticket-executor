"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

// Creatable combobox: pick an option from the themed dropdown OR type a custom
// value that is not in the list. Styled to match the prototype (dark, mono).
export default function Combobox({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const q = value.trim().toLowerCase();
  const dedup = Array.from(new Set(options.filter(Boolean)));
  const matches = dedup.filter((o) => o.toLowerCase().includes(q));
  // Always allow the typed value; show all options when nothing matches so the
  // list still works as a picker.
  const list = q && matches.length ? matches : dedup;

  const inputStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    border: "none",
    outline: "none",
    background: "transparent",
    padding: 0,
    fontFamily: "var(--font-mono), monospace",
    fontSize: "13px",
    color: "#E4E7EE",
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <input
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, list.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && open && active >= 0 && list[active]) {
              e.preventDefault();
              onChange(list[active]);
              setOpen(false);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          style={inputStyle}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Toggle options"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((o) => !o)}
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "18px",
            height: "18px",
            padding: 0,
            border: "none",
            background: "transparent",
            color: "#5B6273",
            cursor: "pointer",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .18s" }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      {open && list.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: "-7px",
            right: "-7px",
            zIndex: 30,
            maxHeight: "196px",
            overflowY: "auto",
            border: "1px solid #262B36",
            borderRadius: "10px",
            background: "#0E1015",
            boxShadow: "0 22px 54px -24px #000",
            padding: "5px",
            animation: "fadeUp .16s ease-out both",
          }}
        >
          {list.map((o, i) => {
            const isSel = o === value;
            const isActive = i === active;
            return (
              <button
                key={o}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
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
                  background: isActive || isSel ? "rgba(251,114,80,.12)" : "transparent",
                  color: isSel ? "var(--accent)" : "#C7CCD8",
                  fontFamily: "var(--font-mono), monospace",
                  fontSize: "12.5px",
                  transition: "background .12s",
                }}
              >
                {o}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
