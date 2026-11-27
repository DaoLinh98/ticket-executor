"use client";

import type { CSSProperties, ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MOTION } from "@/lib/ui";

// `Reveal` is the same motion for a block that appears by condition - render it inside
// <AnimatePresence initial={false}>{cond && <Reveal key="x">...</Reveal>}</AnimatePresence>.
// Expand / collapse that animates height + opacity, in and out. Use it for any folded
// or revealed block instead of `{open && <Block />}`. Content is clipped while it moves.
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="collapse"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1, transition: { duration: 0.26, ease: MOTION.easeExpo } }}
          exit={{ height: 0, opacity: 0, transition: { duration: 0.18, ease: MOTION.easeOut } }}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// `gap` is the parent's flex/grid gap in px: the block starts at `marginTop: -gap` so the gap grows
// with it instead of jumping in when the block mounts.
// `style` is for the block's own placement in its parent, e.g. `{ gridColumn: "1 / -1" }`.
export function Reveal({ children, gap = 0, style }: { children: ReactNode; gap?: number; style?: CSSProperties }) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0, marginTop: -gap }}
      animate={{ height: "auto", opacity: 1, marginTop: 0, transition: { duration: 0.26, ease: MOTION.easeExpo } }}
      exit={{ height: 0, opacity: 0, marginTop: -gap, transition: { duration: 0.18, ease: MOTION.easeOut } }}
      style={{ overflow: "hidden", flexShrink: 0, ...style }}
    >
      {children}
    </motion.div>
  );
}
