"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BoltLayer, useBolts } from "./Bolts";
import { SETTINGS_UPDATED_EVENT, type SettingsUpdatedDetail } from "./settingsEvents";

type BoltsApi = {
  fireBolt: (x: number, y: number, opts?: { big?: boolean }) => void;
  fireBoltFromEvent: (e?: { clientX?: number; clientY?: number }, opts?: { big?: boolean }) => void;
  statusBoltAnchor: () => { x: number; y: number };
};

const BoltsCtx = createContext<BoltsApi | null>(null);

export function BoltsProvider({ children }: { children: ReactNode }) {
  const { bolts, flashes, fireBolt, fireBoltFromEvent, statusBoltAnchor } = useBolts();
  // The `clickEffects` setting gates *every* bolt: the click strikes and the
  // self-strikes a mounted LoadingRing fires into running buttons. Gating here
  // rather than at each call site means one switch covers both, and no component
  // has to know the setting exists. Read once on mount and kept live via the
  // same event the Settings page uses for the animated backdrop.
  //
  // Starts off, not on: a LoadingRing mounts and self-strikes immediately, well
  // before the read below resolves, so defaulting to on made bolts flash on
  // every page load with the setting off. The pending window is the only state
  // treated as off — a read that returns no setting at all (the login page, 401)
  // still turns them on, as it always did.
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setEnabled(typeof d?.settings?.clickEffects === "boolean" ? d.settings.clickEffects : true))
      .catch(() => { /* unauthenticated (login page) or offline — keep the effect on */ setEnabled(true); });
  }, []);

  useEffect(() => {
    const onUpdated = (e: Event) => {
      const detail = (e as CustomEvent<SettingsUpdatedDetail>).detail;
      if (detail && typeof detail.clickEffects === "boolean") setEnabled(detail.clickEffects);
    };
    window.addEventListener(SETTINGS_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, onUpdated);
  }, []);

  const gatedFireBolt = useCallback<BoltsApi["fireBolt"]>(
    (x, y, opts) => { if (enabled) fireBolt(x, y, opts); },
    [enabled, fireBolt]
  );
  const gatedFireBoltFromEvent = useCallback<BoltsApi["fireBoltFromEvent"]>(
    (e, opts) => { if (enabled) fireBoltFromEvent(e, opts); },
    [enabled, fireBoltFromEvent]
  );

  const api = useMemo(
    () => ({ fireBolt: gatedFireBolt, fireBoltFromEvent: gatedFireBoltFromEvent, statusBoltAnchor }),
    [gatedFireBolt, gatedFireBoltFromEvent, statusBoltAnchor]
  );
  return (
    <BoltsCtx.Provider value={api}>
      {children}
      <BoltLayer bolts={bolts} flashes={flashes} />
    </BoltsCtx.Provider>
  );
}

export function useBoltsContext() {
  const ctx = useContext(BoltsCtx);
  if (!ctx) throw new Error("useBoltsContext must be used within BoltsProvider");
  return ctx;
}
