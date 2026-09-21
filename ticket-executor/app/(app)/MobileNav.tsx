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
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return mobile;
}

/** Open state of the off-canvas nav drawer, shared by the trigger (which lives
 *  in every page header, via `PageHeading`) and the drawer itself. */
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

  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
}
