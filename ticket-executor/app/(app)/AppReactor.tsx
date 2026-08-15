"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Reactor from "../Reactor";
import { COLORS, resolveColor } from "@/lib/ui";
import { SETTINGS_UPDATED_EVENT, type SettingsUpdatedDetail } from "../settingsEvents";

// Single app-wide reactor backdrop, mounted once in the shared layout so the
// animation persists across page navigations (and only one instance ever owns
// the window.__reactor singleton). Re-read on route change, and updated live via
// SETTINGS_UPDATED_EVENT so a Settings-page toggle takes effect on save without
// a reload/navigation.
//
// `animatedBackground` off **unmounts** the backdrop rather than pausing it: the
// setting means "no backdrop", so the globe and the star field have to go, not
// stand still. Unmounting is also what actually stops the cost — the WebGL
// context is disposed and the requestAnimationFrame loop ends, where a frozen or
// merely hidden canvas would keep both alive for something nobody can see.
export default function AppReactor() {
  const pathname = usePathname();
  // Three states, and the third one matters: `null` is "the setting has not been
  // read yet". Starting at `true` renders the backdrop for one fetch on every
  // page load, so anyone who turned it off would watch it flash in and vanish.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  // three.js needs a real colour, not the `var(--te-accent)` every other
  // consumer takes. Held in state rather than read during render because the
  // computed value only exists in the browser, and because the theme can change
  // under a mounted reactor — `resolveColor` in the render body would go stale.
  const [accent, setAccent] = useState("");

  // Read after paint, so the stylesheet (and any data-theme the head script
  // stamped) is already applied.
  const readAccent = () => setAccent(resolveColor(COLORS.accent));

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => { if (d.settings) setEnabled(!!d.settings.animatedBackground); })
      .catch(() => {})
      .finally(readAccent);
  }, [pathname]);

  useEffect(() => {
    const onUpdated = (e: Event) => {
      const detail = (e as CustomEvent<SettingsUpdatedDetail>).detail;
      if (detail && typeof detail.animatedBackground === "boolean") setEnabled(detail.animatedBackground);
      // AppTheme stamps `data-theme` from the same event. Re-read on the next
      // frame so the new palette has been applied before the colour is sampled.
      if (detail && typeof detail.emehubTheme === "boolean") requestAnimationFrame(readAccent);
    };
    window.addEventListener(SETTINGS_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, onUpdated);
  }, []);

  if (!enabled || !accent) return null;
  // Keyed on the colour: the accent is baked into geometry, textures and shader
  // uniforms all over the scene, so a theme change rebuilds it rather than
  // leaving it half-repainted.
  return <Reactor key={accent} accent={accent} />;
}
