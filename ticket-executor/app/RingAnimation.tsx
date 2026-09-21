"use client";

import { useEffect } from "react";
import { useAppSettings } from "./SettingsProvider";

// Keeps the `ringAnimation` class on <html> in step with a change made after
// the document was rendered — a save here, in another tab, or on another
// machine picked up by SettingsProvider's re-read.
//
// The class itself is put there by the root layout, not by this component: the
// ring lives in ringBorder()'s inline style, so the only thing that can reach
// it is the --te-ring-image variable the class sets (see globals.css), and a
// variable applied from an effect is a variable applied one paint too late.
// This used to be bridged by mirroring the last value into localStorage, which
// is per-browser by definition — the very reason the setting looked ignored in
// a browser that had never saved it.
const CLASS = "te-ring-static";

export default function RingAnimation() {
  const { settings } = useAppSettings();

  useEffect(() => {
    document.documentElement.classList.toggle(CLASS, !settings.ringAnimation);
  }, [settings.ringAnimation]);

  return null;
}
