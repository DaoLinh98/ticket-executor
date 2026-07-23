"use client";

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { BoltLayer, useBolts } from "./Bolts";

type BoltsApi = {
  fireBolt: (x: number, y: number, opts?: { big?: boolean }) => void;
  fireBoltFromEvent: (e?: { clientX?: number; clientY?: number }, opts?: { big?: boolean }) => void;
  statusBoltAnchor: () => { x: number; y: number };
};

const BoltsCtx = createContext<BoltsApi | null>(null);

export function BoltsProvider({ children }: { children: ReactNode }) {
  const { bolts, flashes, fireBolt, fireBoltFromEvent, statusBoltAnchor } = useBolts();
  const api = useMemo(
    () => ({ fireBolt, fireBoltFromEvent, statusBoltAnchor }),
    [fireBolt, fireBoltFromEvent, statusBoltAnchor]
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
