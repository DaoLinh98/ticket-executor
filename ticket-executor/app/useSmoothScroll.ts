"use client";

import { useEffect } from "react";

// Ported verbatim from the prototype's attachSmooth() (Ticket Executor.dc.html,
// ~line 546) — direct per-element wheel interception with a heavy 0.1 ease
// factor, which is what actually reads as "smooth" rather than a quick 0.2+
// catch-up that still feels like a snap. Attached to every `.te-scroll`
// element (ticket list, sprint/combobox dropdowns, tab content, log viewer)
// as they mount, via MutationObserver since this app's scroll containers are
// dynamic (dropdowns open/close) rather than the prototype's two fixed refs.
function attachSmooth(el: HTMLElement) {
  if ((el as HTMLElement & { __smooth?: boolean }).__smooth) return;
  (el as HTMLElement & { __smooth?: boolean }).__smooth = true;

  let target = el.scrollTop;
  let animating = false;
  let lastTime = 0;

  // Time-corrected version of the reference's `diff * 0.1` per frame: at a
  // steady 60fps this reduces to the exact same 0.1-per-~16.7ms step, but it
  // stays correct (no visible stutter) if the tab drops frames — e.g. while
  // the WebGL Reactor background is also rendering — by scaling the catch-up
  // fraction to however much real time actually elapsed since the last frame.
  const ease = (now: number) => {
    const dt = lastTime ? now - lastTime : 16.7;
    lastTime = now;
    const cur = el.scrollTop;
    const diff = target - cur;
    if (Math.abs(diff) < 0.3) {
      el.scrollTop = target;
      animating = false;
      lastTime = 0;
      return;
    }
    const rate = 1 - Math.pow(0.9, dt / 16.7);
    el.scrollTop = cur + diff * rate;
    requestAnimationFrame(ease);
  };

  el.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 1) return;
      e.preventDefault();
      if (!animating) target = el.scrollTop;
      let d = e.deltaY;
      if (e.deltaMode === 1) d *= 16;
      else if (e.deltaMode === 2) d *= el.clientHeight;
      target = Math.max(0, Math.min(max, target + d));
      if (!animating) {
        animating = true;
        requestAnimationFrame(ease);
      }
    },
    { passive: false }
  );
  el.addEventListener("scroll", () => {
    if (!animating) target = el.scrollTop;
  });
}

export function useSmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const scan = (root: ParentNode) => {
      root.querySelectorAll(".te-scroll").forEach((el) => attachSmooth(el as HTMLElement));
    };
    scan(document);

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches(".te-scroll")) attachSmooth(node);
          scan(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}
