"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

// The breakpoint the responsive layer in globals.css uses. Kept here as the one
// place JS reads it, so the two cannot drift apart.
export const MOBILE_QUERY = "(max-width: 900px)";

type MobileNav = { open: boolean; setOpen: (open: boolean) => void };

const Ctx = createContext<MobileNav>({ open: false, setOpen: () => {} });

/** Whether the viewport is below the responsive breakpoint.
 *
 * Starts `false` and is corrected after mount: the server has no viewport, so
 * rendering the mobile shape first would be a hydration mismatch. Everything
 * that can be answered in CSS is, and this hook is only for the handful of
 * decisions CSS cannot make — a drawer that must not also be a collapsed rail,
 * and a nav that closes itself on navigation.
 */
export function useIsMobile() {
  return useResolvedIsMobile() === true;
}

/** Same reading as `useIsMobile`, but `null` until the viewport is known.
 *
 * `useIsMobile` answers "not mobile" for the first client render, which is the
 * right default for layout but the wrong one for a gate that must stop a
 * desktop-only page from mounting and firing its requests on a phone. */
export function useResolvedIsMobile() {
  const [mobile, setMobile] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return mobile;
}

/** Open state of the off-canvas nav drawer, shared by the floating trigger and
 *  the drawer itself. */
export function useMobileNav() {
  return useContext(Ctx);
}

export default function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const setOpen = useCallback((v: boolean) => setOpenState(v), []);

  // A drawer over the page must not leave the page scrolling underneath it.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    let start: { x: number; y: number; t: number } | null = null;
    const scrollsX = (el: EventTarget | null) => {
      for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if ((ox === "auto" || ox === "scroll") && n.scrollWidth > n.clientWidth) return true;
      }
      return false;
    };
    const onStart = (e: TouchEvent) => {
      if (!mq.matches || e.touches.length !== 1 || scrollsX(e.target)) { start = null; return; }
      const p = e.touches[0];
      start = { x: p.clientX, y: p.clientY, t: e.timeStamp };
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const p = e.changedTouches[0];
      const dx = p.clientX - start.x;
      const dy = p.clientY - start.y;
      const quick = e.timeStamp - start.t < 600;
      start = null;
      if (!quick || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      setOpenState(dx > 0);
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, []);

  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
}
