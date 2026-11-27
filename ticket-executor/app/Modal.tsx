"use client";

import { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { MOTION } from "@/lib/ui";

// Animated modal parts. Render the dialog inside <AnimatePresence> (keyed) so the
// scrim fades and the panel lifts in on open AND eases out on close:
//   <AnimatePresence>{open && <Dialog key="x" />}</AnimatePresence>
// with <ModalOverlay style={modalOverlayStyle()}> wrapping <ModalPanel style={modalShellStyle()}>.
// The helpers' CSS `fadeIn` / `slideIn` are switched off here — a CSS keyframe cannot play an exit.

export function ModalOverlay({ style, ...rest }: HTMLMotionProps<"div">) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.2, ease: MOTION.easeOut } }}
      exit={{ opacity: 0, transition: { duration: 0.16, ease: MOTION.easeOut } }}
      {...rest}
      style={{ ...style, animation: "none" }}
    />
  );
}

export const ModalPanel = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(function ModalPanel({ style, ...rest }, ref) {
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.32, ease: MOTION.easeExpo } }}
      exit={{ opacity: 0, y: 12, scale: 0.98, transition: { duration: 0.16, ease: MOTION.easeOut } }}
      {...rest}
      style={{ ...style, animation: "none" }}
    />
  );
});
