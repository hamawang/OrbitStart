import { AnimatePresence, m } from "motion/react";
import type { ReactNode } from "react";
import { useMotionPolicy, useMotionTransition } from "../MotionProvider";
import { motionVariants } from "../variants";

export interface MotionCollapseProps {
  open: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
  instant?: boolean;
}

export function MotionCollapse({ open, children, className, id, instant = false }: MotionCollapseProps) {
  const transition = useMotionTransition("base");
  const { layoutAnimationsEnabled } = useMotionPolicy();

  if (instant) {
    return open ? (
      <div id={id} className={className}>
        {children}
      </div>
    ) : null;
  }

  const variants = layoutAnimationsEnabled
    ? motionVariants.collapse
    : {
        hidden: { opacity: 0, height: "auto" },
        visible: { opacity: 1, height: "auto" },
        exit: { opacity: 0, height: "auto" }
      };

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <m.div
          id={id}
          className={className}
          variants={variants}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={transition}
          style={{ overflow: "clip" }}
        >
          {children}
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}
