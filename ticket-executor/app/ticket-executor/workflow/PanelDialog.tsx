"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { COLORS, FONT, codeBlock, modalOverlayStyle, modalShellStyle, ringBorder, tabStyle } from "@/lib/ui";
import { IC } from "@/lib/workflow/meta";
import type { Tone } from "@/lib/workflow/types";
import { useTranslation } from "../../queries";
import { useBoltsContext } from "../../BoltsContext";
import LoadingRing from "../LoadingRing";
import { Ico, IconTile } from "./parts";

type Lang = "eng" | "vie";

type Props = {
  title: string;
  subtitle?: string;
  icon: string;
  tone: Tone;
  /** The panel's plain text — what the VIE toggle translates, one turn per panel. */
  source: string;
  /** The body in English, laid out for reading. Omitted ⇒ `source` shown as prose, one block per `## ` section. */
  eng?: ReactNode;
  /** A `## ` section of `source` to scroll to on open. */
  focus?: string;
  onClose: () => void;
};

const sectionId = (title: string) => `te-panel-sec-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/** `source` cut at its `## ` headings, so each section is its own block a jump link can land on. */
function splitSections(text: string): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [];
  for (const line of text.split("\n")) {
    if (/^## \S/.test(line) || !out.length) out.push({ title: /^## \S/.test(line) ? line.slice(3).trim() : "", body: "" });
    out[out.length - 1].body += `${out[out.length - 1].body ? "\n" : ""}${line}`;
  }
  return out;
}

/** The reading block both languages fall back to: the app's code block, opened
 *  up — one size step above the inspector's, with the line rhythm of prose. */
function PanelProse({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {splitSections(text).map((s, i) => (
        <pre key={i} id={s.title ? sectionId(s.title) : undefined} style={{ ...codeBlock({ fontSize: FONT.md, padding: "16px 18px", wrap: true }), lineHeight: 1.75, scrollMarginTop: 12 }}>
          {s.body}
        </pre>
      ))}
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** The roomy view of one inspector panel: the whole brief, or the whole row set,
 *  with a language toggle. Translation is asked for on the first switch to VIE and
 *  kept for the session (`useTranslation`), so reopening the panel costs nothing. */
export default function PanelDialog({ title, subtitle, icon, tone, source, eng, focus, onClose }: Props) {
  const [lang, setLang] = useState<Lang>("eng");
  const { fireBoltFromEvent } = useBoltsContext();
  const translatable = !!source.trim();
  const tr = useTranslation(source, lang === "vie" && translatable);
  const shell = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  // Keyboard stays inside the dialog while it is open (Tab cycles, Escape closes) and returns where it was after.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    shell.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab" || !shell.current) return;
      const els = [...shell.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [onClose]);

  useEffect(() => {
    if (focus && lang === "eng") body.current?.querySelector(`#${sectionId(focus)}`)?.scrollIntoView({ block: "start" });
  }, [focus, lang]);

  return (
    <div
      className="te-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{ ...modalOverlayStyle(), padding: "24px" }}
    >
      <div
        ref={shell}
        className="te-modal-shell"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "880px", maxWidth: "96vw", height: "calc(var(--te-app-h, 100dvh) * 0.86)", display: "flex", flexDirection: "column", overflow: "hidden", ...modalShellStyle() }}
      >
        <header style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
          <IconTile d={icon} tone={tone} size={32} iconSize={17} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <b style={{ display: "block", fontSize: FONT.lg, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</b>
            {subtitle ? <span style={{ display: "block", fontSize: FONT.xs, color: COLORS.textMuted }}>{subtitle}</span> : null}
          </span>
          <div role="tablist" aria-label="Language" style={{ display: "flex", gap: 4, flex: "0 0 auto" }}>
            {([["eng", "ENG"], ["vie", "VIE"]] as [Lang, string][]).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={lang === k}
                disabled={k === "vie" && !translatable}
                className="te-wf-tap"
                title={k === "vie" ? "Read this in Vietnamese" : "Read this in English"}
                onClick={() => setLang(k)}
                style={tabStyle({ active: lang === k, enabled: k === "eng" || translatable })}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={(e) => {
              fireBoltFromEvent(e);
              onClose();
            }}
            style={{ width: 30, height: 30, flex: "0 0 auto", color: COLORS.textDim, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", ...ringBorder({ fill: "var(--te-btn-ghost-fill)", duration: 4, cornerPx: 6 }) }}
          >
            <Ico d={IC.x} size={15} />
          </button>
        </header>

        <div ref={body} className="te-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 20px calc(24px + env(safe-area-inset-bottom))" }}>
          {lang === "eng" ? (
            (eng ?? <PanelProse text={source} />)
          ) : tr.isPending ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
              <LoadingRing size={56} />
            </div>
          ) : tr.isError ? (
            <p style={{ margin: 0, fontSize: FONT.base, color: COLORS.danger }}>{tr.error.message}</p>
          ) : (
            <PanelProse text={tr.data ?? ""} />
          )}
        </div>
      </div>
    </div>
  );
}
