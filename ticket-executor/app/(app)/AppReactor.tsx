"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Reactor from "../Reactor";
import { COLORS } from "@/lib/ui";
import { SETTINGS_UPDATED_EVENT, type SettingsUpdatedDetail } from "../settingsEvents";

// Single app-wide reactor backdrop, mounted once in the shared layout so the
// animation persists across page navigations (and only one instance ever owns
// the window.__reactor singleton). `frozen` mirrors the animatedBackground
// setting; re-read on route change, and updated live via SETTINGS_UPDATED_EVENT
// so a Settings-page toggle takes effect on save without a reload/navigation.
export default function AppReactor() {
  const pathname = usePathname();
  const [frozen, setFrozen] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => { if (d.settings) setFrozen(!d.settings.animatedBackground); })
      .catch(() => {});
  }, [pathname]);

  useEffect(() => {
    const onUpdated = (e: Event) => {
      const detail = (e as CustomEvent<SettingsUpdatedDetail>).detail;
      if (detail && typeof detail.animatedBackground === "boolean") setFrozen(!detail.animatedBackground);
    };
    window.addEventListener(SETTINGS_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, onUpdated);
  }, []);

  return <Reactor accent={COLORS.accent} frozen={frozen} />;
}
