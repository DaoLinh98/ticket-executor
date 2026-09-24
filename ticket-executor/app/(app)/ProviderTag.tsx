"use client";

import { useCallback, useEffect, useState } from "react";
import { providerMeta, type ProviderId } from "@/lib/providers";
import { CONNECTION_CHANGED_EVENT } from "../connectionEvents";

// The "which tracker am I driving" marker. It lives at the foot of the Sidebar,
// so it reads once for the whole app instead of once per page header.
export default function ProviderTag() {
  const [id, setId] = useState<ProviderId | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/connections");
      const data = await r.json();
      if (data?.provider) setId(data.provider as ProviderId);
    } catch {
      /* leave whatever is on screen */
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onChanged = () => { load(); };
    window.addEventListener(CONNECTION_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONNECTION_CHANGED_EVENT, onChanged);
  }, [load]);

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
