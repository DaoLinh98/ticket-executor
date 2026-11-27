"use client";

import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { COLORS, FONT, card, chipShape } from "@/lib/ui";
import { IC } from "@/lib/workflow/meta";
import PanelDialog from "./PanelDialog";
import { Ico, IconTile } from "./parts";

type Props = { en: string; vi: string };

/** The run's whole story, one tap away and in either language. Both were written in the recap turn and stored with
 *  the run, so the ENG/VIE toggle in the dialog is a re-render — nothing is translated on demand. */
export default function RecapCard({ en, vi }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ ...card({ padding: "12px", background: COLORS.panelBgDark, border: COLORS.borderSubtle }), marginTop: 12 }}>
      <button
        type="button"
        className="te-wf-tap"
        title="Read the whole recap, in English or Vietnamese"
        onClick={() => setOpen(true)}
        style={{ ...chipShape(6), width: "100%", minHeight: 44, display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", border: 0, background: "transparent", color: COLORS.text, cursor: "pointer", textAlign: "left" }}
      >
        <IconTile d={IC.sparkle} tone="accent" size={24} iconSize={14} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ display: "block", fontSize: FONT.base }}>Read the full recap</b>
          <span style={{ display: "block", fontSize: FONT.xs, color: COLORS.textMuted }}>the whole run in one page · English and Tiếng Việt</span>
        </span>
        <Ico d={IC.out} size={13} sw={2.2} />
      </button>

      <AnimatePresence>
      {open ? (
        <PanelDialog
          key="recap"
          title="Run recap"
          subtitle="everything this run did, in one page"
          icon={IC.sparkle}
          tone="accent"
          source={en}
          vie={vi}
          onClose={() => setOpen(false)}
        />
      ) : null}
      </AnimatePresence>
    </div>
  );
}
