"use client";

import LoadingRing from "../../ticket-executor/LoadingRing";
import { useBoltsContext } from "../../BoltsContext";
import type { ReactNode } from "react";
import { COLORS, FONT, ctaButtonStyle } from "@/lib/ui";

export type ActionVariant = "primary" | "outline" | "ghost" | "warning" | "success";

export default function ActionButton({
  label,
  variant,
  onClick,
  busy = false,
  disabled = false,
  compact = false,
  tall = false,
  icon,
}: {
  label: string;
  variant: ActionVariant;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  compact?: boolean;
  /** Match a `fieldInput()` (40px) when the button sits beside one. */
  tall?: boolean;
  /** Icon-only button: `label` becomes its accessible name and tooltip. */
  icon?: ReactNode;
}) {
  const { fireBoltFromEvent } = useBoltsContext();
  const inert = disabled || busy;
  return (
    <button
      className={icon ? "te-action-btn te-icon-btn" : "te-action-btn"}
      aria-label={icon ? label : undefined}
      title={icon ? label : undefined}
      onClick={(e) => { fireBoltFromEvent(e); onClick(); }}
      disabled={inert}
      data-state={busy ? "busy" : disabled ? "off" : "ready"}
      style={{
        ...ctaButtonStyle(variant, { height: compact ? "26px" : tall ? "40px" : "30px", cornerPx: 7 }),
        flex: "0 0 auto",
        whiteSpace: "nowrap",
        padding: compact ? "0 9px" : "0 11px",
        ...(compact ? { fontSize: FONT.sm } : {}),
        ...(icon ? { width: compact ? "26px" : tall ? "40px" : "30px", padding: 0, justifyContent: "center" } : {}),
        // The whole shorthand, not `borderColor`: dropping a longhand over `border` on re-render (busy ⇄ ready) is a React styling bug.
        ...(variant === "outline" && !inert ? { border: `1.5px solid ${COLORS.accent}`, color: COLORS.text } : {}),
        ...(disabled && !busy ? { cursor: "not-allowed" } : {}),
      }}
    >
      {busy && <LoadingRing size={13} />}
      {icon ? (!busy && icon) : label}
    </button>
  );
}
