"use client";

import { useCallback, useEffect, useState } from "react";
import SprintPicker from "../SprintPicker";
import { connectionLabel, providerMeta, type ProviderId } from "@/lib/providers";
import { FONT } from "@/lib/ui";
import { CONNECTION_CHANGED_EVENT } from "../connectionEvents";

type Connection = { id: string; label: string; org: string; isActive: boolean };

// Shared "which tracker am I driving" marker, rendered at the end of every
// page header: the organization currently connected, and the provider it
// belongs to. The picker is the app-wide organization switch — one POST
// re-points every credential consumer (`resolveCredential()`), and the event it
// fires is what makes the open page reload its data as that organization.
const orgLeading = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8A90A0" strokeWidth="2" style={{ flex: "0 0 auto" }}>
    <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5" />
  </svg>
);

export default function ProviderBadge({ provider }: { provider?: ProviderId }) {
  const [id, setId] = useState<ProviderId | null>(provider ?? null);
  const [connections, setConnections] = useState<Connection[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(provider ? `/api/connections?provider=${provider}` : "/api/connections");
      const data = await r.json();
      if (data?.provider) setId(data.provider as ProviderId);
      setConnections(Array.isArray(data?.connections) ? data.connections : []);
    } catch {
      /* leave whatever is on screen */
    }
  }, [provider]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onChanged = () => { load(); };
    window.addEventListener(CONNECTION_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONNECTION_CHANGED_EVENT, onChanged);
  }, [load]);

  const active = connections.find((c) => c.isActive) ?? connections[0] ?? null;

  const onSelect = async (name: string) => {
    const next = connections.find((c) => connectionLabel(c) === name);
    if (!next || next.id === active?.id) return;
    setConnections((cs) => cs.map((c) => ({ ...c, isActive: c.id === next.id })));
    try {
      await fetch("/api/connections/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id, id: next.id }),
      });
    } catch {
      load();
      return;
    }
    window.dispatchEvent(
      new CustomEvent(CONNECTION_CHANGED_EVENT, {
        detail: { provider: id ?? "", connectionId: next.id, org: next.org },
      })
    );
  };

  if (!id) return null;
  // Picker first, provider last: "CONNECTING · …" closes every page header.
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: "0 0 auto" }}>
      {active && (
        <SprintPicker
          label={connectionLabel(active)}
          options={connections.map((c) => ({ id: c.id, name: connectionLabel(c) }))}
          value={connectionLabel(active)}
          onSelect={onSelect}
          leading={orgLeading}
          align="right"
        />
      )}
      <span
        title="Connected work-tracking provider"
        style={{ flex: "0 0 auto", whiteSpace: "nowrap", fontSize: FONT.xs, letterSpacing: ".16em", fontWeight: 600, background: "linear-gradient(90deg,#5B6273 0%,#5B6273 30%,#FFD9BE 45%,var(--accent) 52%,#5B6273 65%,#5B6273 100%)", backgroundSize: "220% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "subtitleFlow 3.2s linear infinite" }}
      >
        CONNECTING · {providerMeta(id).short}
      </span>
    </div>
  );
}
