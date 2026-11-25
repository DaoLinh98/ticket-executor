"use client";

import type { ReactNode } from "react";
import PageHeading from "./PageHeading";
import NotificationCenter from "./NotificationCenter";
import ProviderBadge from "./ProviderBadge";

// The 60px header every page opens with: identity block on the left, the bell and
// the provider on the right. Pages pass only what is theirs — title, kicker, glyph.
export default function PageHeader({ title, kicker, icon }: { title: string; kicker: string; icon: ReactNode }) {
  return (
    <header className="te-page-header" style={{ position: "relative", zIndex: 30, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "14px", padding: "0 28px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "var(--te-header-bg)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
      <PageHeading title={title} kicker={kicker} icon={icon} />
      <div style={{ flex: 1 }} />
      <NotificationCenter />
      <ProviderBadge />
    </header>
  );
}
