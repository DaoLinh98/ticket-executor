"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Reactor from "../Reactor";
import { COLORS, resolveColor } from "@/lib/ui";
import { useAppSettings } from "../SettingsProvider";

// Single app-wide reactor backdrop, mounted once in the shared layout so the
// animation persists across page navigations (and only one instance ever owns
// the window.__reactor singleton). The setting comes from SettingsProvider, so
// a toggle saved here, in another tab, or on another machine takes effect
// without a reload — see that module for the re-read triggers.
//
// `animatedBackground` off **unmounts** the backdrop rather than pausing it: the
// setting means "no backdrop", so the globe and the star field have to go, not
// stand still. Unmounting is also what actually stops the cost — the WebGL
// context is disposed and the requestAnimationFrame loop ends, where a frozen or
// merely hidden canvas would keep both alive for something nobody can see.
export default function AppReactor() {
  const pathname = usePathname();
  const { settings } = useAppSettings();
  // three.js needs a real colour, not the `var(--te-accent)` every other
  // consumer takes. Held in state rather than read during render because the
  // computed value only exists in the browser, and because the theme can change
  // under a mounted reactor — `resolveColor` in the render body would go stale.
  const [accent, setAccent] = useState("");

  // Read after paint, so the stylesheet (and any data-theme the head script
  // stamped) is already applied. Re-read on route change because the theme can
  // have changed under a backdrop that never unmounted.
  useEffect(() => {
    setAccent(resolveColor(COLORS.accent));
  }, [pathname]);

  // `accent` is the only thing still resolved in the browser: the setting
  // arrives with the server render, so a backdrop turned off never flashes in.
  if (!settings.animatedBackground || !accent) return null;
  // Keyed on the colour: the accent is baked into geometry, textures and shader
  // uniforms all over the scene, so a theme change rebuilds it rather than
  // leaving it half-repainted.
  return <Reactor key={accent} accent={accent} />;
}
