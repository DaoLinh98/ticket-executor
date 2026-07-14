"use client";

// Ported from the prototype's attachSmooth() (Ticket Executor.dc.html, ~line 547):
// direct per-element wheel interception, eased toward a target scrollTop.
//
// Two differences from the port that used to live here:
// 1. Attachment is a plain ref callback on each known `.te-scroll` container,
//    not a MutationObserver on `document.body` with `subtree: true`. The
//    observer fired on every DOM mutation anywhere in the app (log lines
//    streaming in, bolt animations, any re-render) just to re-scan for
//    `.te-scroll` nodes, which was the main source of main-thread jank —
//    tuning the easing math alone couldn't fix that.
// 2. The catch-up rate is time-corrected (scaled by real elapsed time, not a
//    flat fraction) so it still looks smooth if a frame is skipped, e.g.
//    while the WebGL Reactor background is rendering — but with the observer
//    gone this matters far less now.
const DAMPING = 0.72; // per ~16.7ms frame; lower = snappier catch-up

export function attachSmoothScroll(el: HTMLElement | null) {
  if (!el) return;
  if ((el as HTMLElement & { __smooth?: boolean }).__smooth) return;
  (el as HTMLElement & { __smooth?: boolean }).__smooth = true;

  let target = el.scrollTop;
  let animating = false;
  let lastTime = 0;

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
    const rate = 1 - Math.pow(DAMPING, dt / 16.7);
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
    { passive: false },
  );
  el.addEventListener("scroll", () => {
    if (!animating) target = el.scrollTop;
  });
}
