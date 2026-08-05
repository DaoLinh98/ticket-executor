"use client";

import type { CSSProperties } from "react";

/**
 * Render a provider rich-text field (ticket Description / Acceptance Criteria).
 *
 * The HTML is **already sanitized** — every producer runs provider markup through
 * `sanitizeHtml()` in `lib/richText.ts` before it becomes a `Ticket` field, which
 * is the single place that decides what markup is allowed. Sanitizing again here
 * would just be a second, divergent allowlist. Never pass this component markup
 * that has not been through that function.
 *
 * Styling lives in `.te-rich` (app/globals.css) rather than inline styles: the
 * tags come from whoever wrote the ticket, so they have to be styled by selector.
 */
export default function RichText({ html, style }: { html: string; style?: CSSProperties }) {
  return <div className="te-rich" style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}
