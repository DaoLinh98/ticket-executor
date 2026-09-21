"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onSettingsUpdated, type SettingsUpdatedDetail } from "./settingsEvents";

/**
 * The app-wide effect settings, owned once for the whole document.
 *
 * Before this existed each consumer fetched /api/settings itself on mount and
 * never again, so a value changed on one machine stayed wrong on every other
 * open copy of the app until it was hard-reloaded — and an installed iOS app,
 * which suspends and resumes rather than reloading, stayed wrong for days. One
 * owner with explicit re-read triggers is what makes the answer converge.
 *
 * The first value is not fetched at all: the root layout reads the row on the
 * server and hands it down as `initial`. A client fetch can only ever answer
 * *after* first paint, which is why an effect turned off still ran for a beat
 * on every load — and why a browser that had never saved the setting itself,
 * with nothing cached to bridge that beat, showed the effect as if it were on.
 * Everything below is re-reading, not first reading.
 */
export type AppSettings = {
  animatedBackground: boolean;
  clickEffects: boolean;
  ringAnimation: boolean;
};

type SettingsContextValue = {
  settings: AppSettings;
  refresh: (opts?: { force?: boolean }) => Promise<void>;
};

// Long, because a settings change is rare and the resume/broadcast hops below
// carry the ones that matter. This is the backstop for a copy of the app left
// open and visible on a second screen.
const POLL_MS = 60_000;
const MIN_GAP_MS = 5_000;

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useAppSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useAppSettings must be used inside SettingsProvider");
  return ctx;
}

export default function SettingsProvider({
  initial,
  children,
}: { initial: AppSettings; children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(initial);
  const fetchedAt = useRef(0);

  const refresh = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force && Date.now() - fetchedAt.current < MIN_GAP_MS) return;
    fetchedAt.current = Date.now();
    try {
      // `no-store` is load-bearing on iOS: the response carries no validator, so
      // Safari will heuristically serve a stale body to a plain fetch — which is
      // a re-read that cannot see the change it was made for.
      const r = await fetch("/api/settings", { cache: "no-store" });
      if (!r.ok) throw new Error(`GET /api/settings -> ${r.status}`);
      const d = await r.json();
      const s = d?.settings;
      if (!s || typeof s.clickEffects !== "boolean")
        throw new Error("GET /api/settings returned no settings");
      setSettings({
        animatedBackground: !!s.animatedBackground,
        clickEffects: !!s.clickEffects,
        ringAnimation: !!s.ringAnimation,
      });
    } catch (err) {
      // The last known values stand — the server-rendered ones on a fresh
      // document — but a re-read that keeps failing is why a change made
      // elsewhere never arrives, so it is not swallowed.
      console.error("[settings] re-read failed", err);
    }
  }, []);

  // Re-read whenever the app comes back into view, and on a slow timer while it
  // stays there. `pageshow` is the one that covers an iOS home-screen app coming
  // out of suspension and a back-forward-cache restore, where the document is
  // resumed rather than re-created and no mount effect runs again.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void refresh();
      timer = setInterval(() => void refresh({ force: true }), POLL_MS);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    const onPageShow = () => { if (!document.hidden) { void refresh({ force: true }); start(); } };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [refresh]);

  // A save in this document or in another tab of this browser. Applied from the
  // message rather than by re-reading: the detail already carries the saved
  // values, and a toggle has to land on the frame it was flipped.
  useEffect(() => {
    const apply = (detail: SettingsUpdatedDetail) => {
      setSettings((prev) => ({
        animatedBackground: detail.animatedBackground ?? prev.animatedBackground,
        clickEffects: detail.clickEffects ?? prev.clickEffects,
        ringAnimation: detail.ringAnimation ?? prev.ringAnimation,
      }));
    };
    return onSettingsUpdated(apply);
  }, []);

  const value = useMemo(() => ({ settings, refresh }), [settings, refresh]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
