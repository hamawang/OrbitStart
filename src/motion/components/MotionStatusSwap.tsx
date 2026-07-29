import { AnimatePresence, m } from "motion/react";
import type { Key, ReactNode } from "react";
import { useMotionPolicy, useMotionTransition } from "../MotionProvider";
import { motionVariants } from "../variants";

export interface MotionStatusSwapProps {
  statusKey: Key;
  children: ReactNode;
  className?: string;
  id?: string;
}

export function MotionStatusSwap({ statusKey, children, className, id }: MotionStatusSwapProps) {
  const transition = useMotionTransition("fast");
  const { animationsEnabled, transformsEnabled } = useMotionPolicy();
  const variants = !animationsEnabled
    ? {
        hidden: { opacity: 1 },
        visible: { opacity: 1 },
        exit: { opacity: 1 }
      }
    : transformsEnabled
      ? motionVariants.statusSwap
      : motionVariants.fade;

  return (
    <AnimatePresence initial={false} mode="wait">
      <m.span
        key={statusKey}
        id={id}
        className={className}
        variants={variants}
        initial="hidden"
        animate="visible"
        exit="exit"
        transition={transition}
      >
        {children}
      </m.span>
    </AnimatePresence>
  );
}
