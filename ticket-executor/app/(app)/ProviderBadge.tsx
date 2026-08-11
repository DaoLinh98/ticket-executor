"use client";

import { useEffect, useState } from "react";
import { providerMeta, type ProviderId } from "@/lib/providers";
import { FONT } from "@/lib/ui";

// Shared "which tracker am I driving" marker, rendered at the end of every
// page header. It reads the provider off the stored settings so it stays true
// on pages that have no settings state of their own.
export default function ProviderBadge({ provider }: { provider?: ProviderId }) {
  const [id, setId] = useState<ProviderId | null>(provider ?? null);

  useEffect(() => {
    if (provider) { setId(provider); return; }
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => { if (!cancelled && s?.provider) setId(s.provider as ProviderId); })
      .catch(() => { });
    return () => { cancelled = true; };
  }, [provider]);

  if (!id) return null;
  return (
    <span
      title="Connected work-tracking provider"
      style={{ flex: "0 0 auto", whiteSpace: "nowrap", fontSize: FONT.xs, letterSpacing: ".16em", fontWeight: 600, background: "linear-gradient(90deg,#5B6273 0%,#5B6273 30%,#FFD9BE 45%,var(--accent) 52%,#5B6273 65%,#5B6273 100%)", backgroundSize: "220% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "subtitleFlow 3.2s linear infinite" }}
    >
      CONNECTING · {providerMeta(id).short}
    </span>
  );
}
