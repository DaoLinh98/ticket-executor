"use client";

import { providerMeta, type ProviderId } from "@/lib/providers";
import { useConnections } from "../queries";

// The "which tracker am I driving" marker. It lives at the foot of the Sidebar,
// so it reads once for the whole app instead of once per page header.
export default function ProviderTag() {
  const id = (useConnections().data?.provider || null) as ProviderId | null;

  if (!id) return null;
  return (
    <span
      title="Connected work-tracking provider"
      style={{ whiteSpace: "nowrap", fontSize: "9.5px", letterSpacing: ".14em", fontWeight: 600, background: "linear-gradient(90deg,var(--te-faint) 0%,var(--te-faint) 30%,#FFD9BE 45%,var(--accent) 52%,var(--te-faint) 65%,var(--te-faint) 100%)", backgroundSize: "220% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "subtitleFlow 3.2s linear infinite" }}
    >
      CONNECTING · {providerMeta(id).short}
    </span>
  );
}
