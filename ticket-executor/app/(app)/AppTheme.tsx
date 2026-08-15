"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SETTINGS_UPDATED_EVENT, THEME_STORAGE_KEY, type SettingsUpdatedDetail } from "../settingsEvents";

/**
 * Selects the app's design language by stamping `data-theme` on `<html>`.
 *
 * That one attribute is the whole switch: every colour, radius, blur and font in
 * the app resolves through the custom properties in `globals.css`, so nothing
 * re-renders and no component knows which theme it is in.
 *
 * The setting lives in Postgres, which means the first paint of a reload would
 * otherwise be D-Agent-coloured until the fetch lands — a visible flash of the
 * wrong brand on every navigation. The last known value is therefore mirrored
 * into `localStorage` and applied by a blocking script in the document head
 * (`ThemeScript`); this component's job is to keep that mirror honest and to
 * react to a change made on the Settings page without a reload.
 */
export default function AppTheme() {
  const pathname = usePathname();
  const [emehub, setEmehub] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => { if (d.settings) setEmehub(!!d.settings.emehubTheme); })
      .catch(() => {});
  }, [pathname]);

  useEffect(() => {
    const onUpdated = (e: Event) => {
      const detail = (e as CustomEvent<SettingsUpdatedDetail>).detail;
      if (detail && typeof detail.emehubTheme === "boolean") setEmehub(detail.emehubTheme);
    };
    window.addEventListener(SETTINGS_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, onUpdated);
  }, []);

  useEffect(() => {
    if (emehub === null) return; // not read yet — leave the pre-painted theme alone
    const root = document.documentElement;
    if (emehub) root.setAttribute("data-theme", "emehub");
    else root.removeAttribute("data-theme");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, emehub ? "emehub" : "dagent");
    } catch {
      /* private mode / storage disabled — costs a flash on the next load, nothing more */
    }
  }, [emehub]);

  return null;
}

/**
 * The two blurred radial glows behind everything, per the EmeHub handoff's
 * background stack. Mounted unconditionally: both bloom colours are `transparent`
 * in the D-Agent palette, so the layer paints nothing there rather than needing a
 * second switch that could disagree with `data-theme`.
 */
export function AppBlooms() {
  const common: React.CSSProperties = {
    position: "fixed",
    borderRadius: "50%",
    filter: "blur(34px)",
    pointerEvents: "none",
    opacity: "var(--te-bloom-opacity)" as unknown as number,
    zIndex: 0,
  };
  return (
    <>
      <div
        aria-hidden
        style={{
          ...common,
          width: "660px", height: "660px", top: "-16%", left: "-8%",
          background: "radial-gradient(circle, var(--te-bloom-1), transparent 62%)",
          animation: "glowPulse 9s ease-in-out infinite",
        }}
      />
      <div
        aria-hidden
        style={{
          ...common,
          width: "740px", height: "740px", bottom: "-22%", right: "-6%",
          background: "radial-gradient(circle, var(--te-bloom-2), transparent 62%)",
          animation: "glowPulse 11s ease-in-out infinite 1s",
        }}
      />
    </>
  );
}
