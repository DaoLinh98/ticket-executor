"use client";

import LoadingRing from "../../ticket-executor/LoadingRing";
import { useBoltsContext } from "../../BoltsContext";
import { ctaButtonStyle } from "@/lib/ui";

export type ActionVariant = "primary" | "outline" | "ghost" | "warning" | "success";

export default function ActionButton({
  label,
  variant,
  onClick,
  busy = false,
  disabled = false,
}: {
  label: string;
  variant: ActionVariant;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const { fireBoltFromEvent } = useBoltsContext();
  const inert = disabled || busy;
  return (
    <button
      className="te-action-btn"
      onClick={(e) => { fireBoltFromEvent(e); onClick(); }}
      disabled={inert}
      style={{
        ...ctaButtonStyle(variant, { height: "30px", cornerPx: 7 }),
        flex: "0 0 auto",
        whiteSpace: "nowrap",
        padding: "0 11px",
        cursor: inert ? "default" : "pointer",
      }}
    >
      {busy && <LoadingRing size={13} />}
      {label}
    </button>
  );
}
