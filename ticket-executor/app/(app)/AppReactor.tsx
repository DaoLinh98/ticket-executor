"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Reactor from "../Reactor";
import { COLORS } from "@/lib/ui";

// Single app-wide reactor backdrop, mounted once in the shared layout so the
// animation persists across page navigations (and only one instance ever owns
// the window.__reactor singleton). `frozen` mirrors the animatedBackground
// setting; re-read on route change so toggling it on the Settings page takes
// effect on the next navigation without a full reload.
export default function AppReactor() {
  const pathname = usePathname();
  const [frozen, setFrozen] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => { if (d.settings) setFrozen(!d.settings.animatedBackground); })
      .catch(() => {});
  }, [pathname]);

  return <Reactor accent={COLORS.accent} frozen={frozen} />;
}
