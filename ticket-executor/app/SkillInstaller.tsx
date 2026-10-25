"use client";

// Shared by the Guide page and System Check: the skills (`skills/`) and the
// D-Agent subagents (`agents/`) ship in this repo, and the app runs on the
// developer's own machine, so installing one is just a file copy into
// ~/.claude/skills/ or ~/.claude/agents/. No download, no unzip.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import LoadingRing from "./ticket-executor/LoadingRing";
import { useBoltsContext } from "./BoltsContext";
import { COLORS, FONT, card, ctaButtonStyle, pill } from "@/lib/ui";

// Mirrors SkillState in lib/skillPack.ts and AgentState in lib/agentPack.ts —
// redeclared because those modules are server-only (fs/os) and must not reach
// the client bundle.
type SkillState = {
  name: string;
  bundledVersion: string;
  installedVersion: string | null;
  installedPath: string | null;
  status: "missing" | "outdated" | "modified" | "ok";
};

type Pack = "skills" | "agents";

const PACKS: Record<Pack, { endpoint: string; field: string; queryKey: readonly string[]; title: string; unit: string }> = {
  skills: { endpoint: "/api/skills/install", field: "skills", queryKey: ["skills-install"], title: "Skills on this machine", unit: "skill" },
  agents: { endpoint: "/api/agents/install", field: "agents", queryKey: ["agents-install"], title: "Agents on this machine", unit: "agent" },
};

const TONE: Record<SkillState["status"], { color: string; label: string; action: string | null }> = {
  missing: { color: COLORS.danger, label: "NOT INSTALLED", action: "Install" },
  outdated: { color: COLORS.warning, label: "OUTDATED", action: "Update" },
  modified: { color: COLORS.warning, label: "EDITED LOCALLY", action: "Overwrite" },
  ok: { color: COLORS.success, label: "INSTALLED", action: null },
};

export default function SkillInstaller({ onChanged, pack = "skills" }: { onChanged?: () => void; pack?: Pack }) {
  const cfg = PACKS[pack];
  const { fireBoltFromEvent } = useBoltsContext();
  const queryClient = useQueryClient();
  const skillsQuery = useQuery({
    queryKey: cfg.queryKey,
    queryFn: async (): Promise<{ skills: SkillState[]; target: string }> => {
      const r = await fetch(cfg.endpoint);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Could not read the installed ${cfg.unit}s.`);
      return { skills: data[cfg.field] as SkillState[], target: data.target as string };
    },
  });
  const skills = skillsQuery.data?.skills ?? null;
  const target = skillsQuery.data?.target ?? "";
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  /** Names whose next click is an explicit confirmed overwrite. */
  const [confirming, setConfirming] = useState<Set<string>>(new Set());

  const run = async (payload: { name?: string; all?: boolean; force?: boolean }, key: string) => {
    setBusy(key);
    setNote("");
    try {
      const r = await fetch(cfg.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (data[cfg.field]) {
        queryClient.setQueryData(cfg.queryKey, (old?: { skills: SkillState[]; target: string }) => ({
          target: old?.target ?? "",
          skills: data[cfg.field] as SkillState[],
        }));
      }

      if (r.status === 409) {
        // Existing copy differs — arm the confirmed-overwrite click.
        const blocked: string[] = (data.results ?? []).filter((x: { ok: boolean }) => !x.ok).map((x: { name: string }) => x.name);
        setConfirming(new Set(blocked));
        setNote(`Your copy differs from the bundled one. Click again to overwrite ${blocked.join(", ")}.`);
        return;
      }
      if (!r.ok) {
        setNote(data.error || "Install failed.");
        return;
      }
      setConfirming(new Set());
      const results = (data.results ?? []) as { ok: boolean; detail: string }[];
      const bad = results.filter((x) => !x.ok);
      setNote(bad.length ? bad.map((b) => b.detail).join(" · ") : `Done — ${results.length} ${cfg.unit}(s) up to date.`);
      if (pack === "skills") queryClient.invalidateQueries({ queryKey: ["skills"] });
      onChanged?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  if (!skills) {
    return (
      <div style={{ ...card(), display: "flex", justifyContent: "center", padding: "18px" }}>
        <LoadingRing size={28} />
      </div>
    );
  }

  const pending = skills.filter((s) => s.status !== "ok");

  return (
    <div style={{ ...card({ padding: "13px" }), display: "flex", flexDirection: "column", gap: "9px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "9px", flexWrap: "wrap" }}>
        <span style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.text }}>{cfg.title}</span>
        <span style={{ fontSize: FONT.xs, color: COLORS.faint, fontFamily: "var(--font-mono), monospace" }}>{target}</span>
        <span style={{ flex: 1 }} />
        {pending.length > 0 && (
          <button
            onClick={(e) => { fireBoltFromEvent(e); run({ all: true, force: confirming.size > 0 }, "all"); }}
            disabled={!!busy}
            style={{ ...ctaButtonStyle("primary", { height: "28px", cornerPx: 6 }), fontSize: FONT.sm, opacity: busy ? 0.55 : 1, cursor: busy ? "default" : "pointer" }}
          >
            <span style={{ position: "relative", zIndex: 1 }}>
              {busy === "all" ? "Working…" : `Install all (${pending.length})`}
            </span>
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
        {skills.map((s) => {
          const t = TONE[s.status];
          const needsConfirm = confirming.has(s.name);
          return (
            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: "9px", padding: "6px 2px", borderTop: `1px solid ${COLORS.borderSubtle}` }}>
              <span style={{ fontSize: FONT.sm, fontFamily: "var(--font-mono), monospace", color: COLORS.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.name}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: FONT.xs, color: COLORS.faint, fontFamily: "var(--font-mono), monospace", whiteSpace: "nowrap" }}>
                {s.installedVersion ? `${s.installedVersion} → ${s.bundledVersion}` : s.bundledVersion}
              </span>
              <span style={{ ...pill({ color: t.color, border: COLORS.border, size: "xs", weight: 700 }), letterSpacing: ".04em", flex: "0 0 auto" }}>
                {t.label}
              </span>
              {t.action && (
                <button
                  onClick={(e) => { fireBoltFromEvent(e); run({ name: s.name, force: needsConfirm || s.status === "outdated" }, s.name); }}
                  disabled={!!busy}
                  style={{ ...ctaButtonStyle(needsConfirm ? "danger" : "ghost", { height: "26px", cornerPx: 6 }), fontSize: FONT.xs, flex: "0 0 auto", opacity: busy ? 0.55 : 1, cursor: busy ? "default" : "pointer" }}
                >
                  <span style={{ position: "relative", zIndex: 1, display: "inline-flex", alignItems: "center", gap: "5px" }}>
                    {busy === s.name ? <LoadingRing size={12} /> : null}
                    {needsConfirm ? "Confirm overwrite" : t.action}
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {note && (
        <span style={{ fontSize: FONT.sm, color: COLORS.textDim, lineHeight: 1.55 }}>{note}</span>
      )}
    </div>
  );
}
