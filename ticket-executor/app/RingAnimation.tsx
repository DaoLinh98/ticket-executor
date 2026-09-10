"use client";

import { useEffect } from "react";
import { SETTINGS_UPDATED_EVENT, type SettingsUpdatedDetail } from "./settingsEvents";

// The `ringAnimation` setting, applied app-wide as one class on <html>.
//
// Mounted in the root layout rather than read per component: the ring lives in
// ringBorder()'s inline style, so the only place a global switch can reach it is
// the --te-ring-image variable that class sets (see globals.css).
//
// The last known value is mirrored into localStorage and applied before paint,
// because the /api/settings read resolves well after first paint — without the
// cache, turning the glow off still flashed a full sweep on every page load.
const CACHE_KEY = "te:ring-animation";
const CLASS = "te-ring-static";

function apply(on: boolean) {
  document.documentElement.classList.toggle(CLASS, !on);
  try {
    localStorage.setItem(CACHE_KEY, on ? "1" : "0");
  } catch {
    /* private mode — the setting still applies for this page */
  }
}

export default function RingAnimation() {
  useEffect(() => {
    try {
      if (localStorage.getItem(CACHE_KEY) === "0")
        document.documentElement.classList.add(CLASS);
    } catch {
      /* ignore */
    }
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => apply(typeof d?.settings?.ringAnimation === "boolean" ? d.settings.ringAnimation : true))
      .catch(() => { /* unauthenticated (login page) or offline — leave as cached */ });
  }, []);

  useEffect(() => {
    const onUpdated = (e: Event) => {
      const detail = (e as CustomEvent<SettingsUpdatedDetail>).detail;
      if (detail && typeof detail.ringAnimation === "boolean") apply(detail.ringAnimation);
    };
    window.addEventListener(SETTINGS_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, onUpdated);
  }, []);

  return null;
}
