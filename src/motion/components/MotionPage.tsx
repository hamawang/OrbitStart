import { m, useIsPresent } from "motion/react";
import type { HTMLMotionProps } from "motion/react";
import { useEffect, useRef } from "react";
import { useMotionPolicy, useMotionTransition } from "../MotionProvider";
import { motionVariants } from "../variants";

export interface MotionPageProps extends HTMLMotionProps<"div"> {}

export function MotionPage({ children, initial = "hidden", style, ...props }: MotionPageProps) {
  const transition = useMotionTransition("base");
  const { animationsEnabled, transformsEnabled } = useMotionPolicy();
  const isPresent = useIsPresent();
  const pageRef = useRef<HTMLDivElement>(null);
  const variants = !animationsEnabled
    ? {
        hidden: { opacity: 1 },
        visible: { opacity: 1 },
        exit: { opacity: 1 }
      }
    : transformsEnabled
      ? motionVariants.page
      : motionVariants.fade;

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    if (isPresent) page.removeAttribute("inert");
    else page.setAttribute("inert", "");
  }, [isPresent]);

  return (
    <m.div
      ref={pageRef}
      {...props}
      data-presence={isPresent ? "present" : "exiting"}
      aria-hidden={!isPresent}
      variants={variants}
      initial={initial}
      animate="visible"
      exit="exit"
      transition={transition}
      style={{
        ...style,
        pointerEvents: isPresent ? style?.pointerEvents : "none"
      }}
    >
      {children}
    </m.div>
  );
}
