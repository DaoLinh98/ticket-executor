"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { BoltLayer, useBolts } from "./Bolts";
import { useAppSettings } from "./SettingsProvider";

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
  // has to know the setting exists. The value comes from SettingsProvider,
  // which is seeded from the server render and re-reads on resume and on a
  // broadcast from another tab — so there is no window in which a LoadingRing
  // can mount and self-strike before the answer is known.
  const { settings } = useAppSettings();
  const enabled = settings.clickEffects;

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
