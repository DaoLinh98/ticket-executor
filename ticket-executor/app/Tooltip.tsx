"use client";

import { useEffect, useRef, useState } from "react";

const SHOW_DELAY_MS = 350;
const HIDE_UNMOUNT_MS = 260;

// Replaces the browser's native `title` popup (it appears abruptly and cannot be
// animated) app-wide without touching call sites: on hover/focus the element's
// `title` is moved to `data-tip` so the native one never fires, and a single
// fixed bubble fades in beside it.
export default function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; show: boolean } | null>(null);
  const timer = useRef<number>(0);
  const unmount = useRef<number>(0);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      current.current = null;
      setTip((t) => (t ? { ...t, show: false } : t));
      window.clearTimeout(unmount.current);
      unmount.current = window.setTimeout(() => setTip(null), HIDE_UNMOUNT_MS);
    };
    const open = (el: HTMLElement) => {
      const text = el.getAttribute("title") ?? el.getAttribute("data-tip");
      if (!text) return;
      if (el.hasAttribute("title")) {
        el.setAttribute("data-tip", text);
        el.removeAttribute("title");
      }
      current.current = el;
      window.clearTimeout(timer.current);
      window.clearTimeout(unmount.current);
      timer.current = window.setTimeout(() => {
        if (current.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        setTip({ text, x: r.left + r.width / 2, y: r.bottom + 8, show: false });
        requestAnimationFrame(() => requestAnimationFrame(() => setTip((t) => (t ? { ...t, show: true } : t))));
      }, SHOW_DELAY_MS);
    };
    const onOver = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[title],[data-tip]") as HTMLElement | null;
      if (!el || el === current.current) return;
      hide();
      open(el);
    };
    const onOut = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tip]");
      if (el && el === current.current) hide();
    };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("focusin", onOver);
    document.addEventListener("focusout", onOut);
    document.addEventListener("mousedown", hide);
    document.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("focusin", onOver);
      document.removeEventListener("focusout", onOut);
      document.removeEventListener("mousedown", hide);
      document.removeEventListener("scroll", hide, true);
      window.clearTimeout(timer.current);
      window.clearTimeout(unmount.current);
    };
  }, []);

  if (!tip) return null;
  const left = Math.max(8, Math.min(tip.x, window.innerWidth - 8));
  return (
    <div
      role="tooltip"
      className="te-tip"
      data-show={tip.show}
      style={{ left, top: tip.y, translate: "-50% 0", maxWidth: Math.min(260, window.innerWidth - 16) }}
    >
      {tip.text}
    </div>
  );
}
