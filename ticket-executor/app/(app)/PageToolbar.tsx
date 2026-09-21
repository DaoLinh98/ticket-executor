"use client";

import type { ReactNode } from "react";
import { COLORS } from "@/lib/ui";

/**
 * The strip a page's own controls live on — the pickers, filters and toggles
 * that change what *that* page is showing.
 *
 * They used to sit in the page header, which put a project picker, three
 * dashboard filters and a sprint dropdown in the same row as the app-wide
 * organization switch and the notification bell: the header claimed to be
 * app-level chrome and was really half page controls. The header now carries
 * only what is true everywhere — the page's identity, the bell, the connected
 * organization — and everything page-scoped moves down here.
 *
 * A sibling of the scrolling `<main>`, never inside it: a control whose dropdown
 * opens into a scroll container gets clipped by it.
 */
export default function PageToolbar({ children }: { children: ReactNode }) {
  return (
    <div
      className="te-page-toolbar"
      style={{
        position: "relative", zIndex: 20, flex: "0 0 auto",
        display: "flex", alignItems: "center", gap: "12px",
        minHeight: "50px", padding: "9px 28px",
        borderBottom: `1px solid ${COLORS.borderSubtle}`,
      }}
    >
      {children}
    </div>
  );
}
