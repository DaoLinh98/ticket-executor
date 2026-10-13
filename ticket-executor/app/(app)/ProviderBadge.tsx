"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import SprintPicker from "../SprintPicker";
import { connectionLabel, type ProviderId } from "@/lib/providers";
import { CONNECTION_CHANGED_EVENT } from "../connectionEvents";
import { rememberActiveConnection } from "../pagePrefs";
import { connectionsKey, useConnections, type ConnectionsPayload } from "../queries";


// Shared organization marker, rendered at the end of every page header: the
// organization currently connected. The picker is the app-wide switch — one POST
// re-points every credential consumer (`resolveCredential()`), and the event it
// fires is what makes the open page reload its data as that organization.
const orgLeading = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8A90A0" strokeWidth="2" style={{ flex: "0 0 auto" }}>
    <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5" />
  </svg>
);

// What the chip says on a phone. A connection name is long enough that no
// amount of ellipsis leaves anything readable ("CreativePlanning-27global" cut
// to fit is "Creat…"), so the capitals carry it instead — they are how the
// organization is said out loud anyway. Falls back to the first characters when
// a name has no capitals of its own to use.
function orgInitials(label: string): string {
  const caps = label.replace(/[^A-Z]/g, "");
  if (caps.length >= 2) return caps.slice(0, 3);
  return label.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
}

export default function ProviderBadge({ provider }: { provider?: ProviderId }) {
  const queryClient = useQueryClient();
  const key = connectionsKey(provider ?? "");
  const query = useConnections(provider ?? "");
  const id = (query.data?.provider || provider || null) as ProviderId | null;
  const connections = query.data?.connections ?? [];
  const load = () => queryClient.invalidateQueries({ queryKey: key });

  const active = connections.find((c) => c.isActive) ?? connections[0] ?? null;

  // Page preferences are stored per organization, and a page reads that scope
  // before its first fetch resolves — so the id has to be on disk, not only in
  // the event that announces a switch.
  useEffect(() => {
    if (active) rememberActiveConnection(active.id);
  }, [active]);

  const onSelect = async (name: string) => {
    const next = connections.find((c) => connectionLabel(c) === name);
    if (!next || next.id === active?.id) return;
    queryClient.setQueryData<ConnectionsPayload>(key, (old) =>
      old ? { ...old, connections: old.connections.map((c) => ({ ...c, isActive: c.id === next.id })) } : old
    );
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
  // Just the organization switch: the provider marker itself lives in the
  // Sidebar (ProviderTag), so it is stated once instead of on every header.
  return (
    <div className="te-org-badge" style={{ display: "flex", alignItems: "center", gap: "10px", flex: "0 0 auto" }}>
      {active && (
        <SprintPicker
          label={connectionLabel(active)}
          shortLabel={orgInitials(connectionLabel(active))}
          options={connections.map((c) => ({ id: c.id, name: connectionLabel(c) }))}
          value={connectionLabel(active)}
          onSelect={onSelect}
          leading={orgLeading}
          align="right"
        />
      )}
    </div>
  );
}
