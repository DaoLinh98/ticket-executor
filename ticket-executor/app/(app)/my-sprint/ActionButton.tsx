"use client";

import LoadingRing from "../../ticket-executor/LoadingRing";
import { useBoltsContext } from "../../BoltsContext";
import { COLORS, FONT, ctaButtonStyle } from "@/lib/ui";

export type ActionVariant = "primary" | "outline" | "ghost" | "warning" | "success";

export default function ActionButton({
  label,
  variant,
  onClick,
  busy = false,
  disabled = false,
  compact = false,
}: {
  label: string;
  variant: ActionVariant;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { fireBoltFromEvent } = useBoltsContext();
  const inert = disabled || busy;
  return (
    <button
      className="te-action-btn"
      onClick={(e) => { fireBoltFromEvent(e); onClick(); }}
      disabled={inert}
      data-state={busy ? "busy" : disabled ? "off" : "ready"}
      style={{
        ...ctaButtonStyle(variant, { height: compact ? "26px" : "30px", cornerPx: 7 }),
        flex: "0 0 auto",
        whiteSpace: "nowrap",
        padding: compact ? "0 9px" : "0 11px",
        ...(compact ? { fontSize: FONT.sm } : {}),
        ...(variant === "outline" && !inert ? { borderColor: COLORS.accent, color: COLORS.text } : {}),
        ...(disabled && !busy ? { cursor: "not-allowed" } : {}),
      }}
    >
      {busy && <LoadingRing size={13} />}
      {label}
    </button>
  );
}
