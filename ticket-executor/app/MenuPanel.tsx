"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import { MOTION } from "@/lib/ui";

// Animated shell for a dropdown / popover panel. Render it inside
// <AnimatePresence> so it eases in on open AND out on close, e.g.
//   <AnimatePresence>{open && <MenuPanel style={dropdownPanelStyle()}>…</MenuPanel>}</AnimatePresence>
// Pair it with dropdownPanelStyle(); the helper's CSS `popIn` is switched off here
// because motion drives the enter instead (a CSS keyframe cannot play an exit).
export function MenuPanel({ style, ...rest }: HTMLMotionProps<"div">) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.2, ease: MOTION.easeExpo } }}
      exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12, ease: MOTION.easeOut } }}
      {...rest}
      style={{ ...style, animation: "none" }}
    />
  );
}
