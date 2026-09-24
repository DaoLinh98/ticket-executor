"use client";

import type { ReactNode } from "react";
import { MotionConfig, motion, type HTMLMotionProps, type TargetAndTransition } from "motion/react";
import { MOTION } from "@/lib/ui";

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ ease: MOTION.easeExpo, duration: MOTION.enter }}>
      {children}
    </MotionConfig>
  );
}

const OFFSET: Record<"up" | "left" | "right" | "none", TargetAndTransition> = {
  up: { y: 24 },
  left: { x: -40 },
  right: { x: 40 },
  none: {},
};

export type RevealFrom = keyof typeof OFFSET;

export function reveal(opts?: { from?: RevealFrom; index?: number; delay?: number }) {
  const { from = "up", index = 0, delay = 0 } = opts ?? {};
  return {
    initial: { opacity: 0, ...OFFSET[from] },
    whileInView: { opacity: 1, x: 0, y: 0 },
    viewport: { once: true, margin: MOTION.revealMargin },
    transition: { ease: MOTION.easeExpo, duration: MOTION.enter, delay: delay + (index < 10 ? index * 0.05 : 0) },
  } as const;
}

export function Reveal({
  from,
  index,
  delay,
  children,
  ...rest
}: HTMLMotionProps<"div"> & { from?: RevealFrom; index?: number; delay?: number }) {
  return (
    <motion.div {...reveal({ from, index, delay })} {...rest}>
      {children}
    </motion.div>
  );
}
