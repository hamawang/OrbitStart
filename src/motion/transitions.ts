import type { Transition } from "motion/react";
import type { MotionMode } from "../types";

export const motionEasings = {
  standard: [0.2, 0.8, 0.2, 1],
  enter: [0.16, 1, 0.3, 1],
  exit: [0.4, 0, 1, 1]
} as const;

export type MotionTransitionName =
  | "instant"
  | "fast"
  | "base"
  | "panel"
  | "emphasis"
  | "overlay"
  | "dialog"
  | "context"
  | "exit"
  | "stepExit"
  | "drawerExit"
  | "contextExit";

const standardDurations: Record<MotionTransitionName, number> = {
  instant: 0.08,
  fast: 0.12,
  base: 0.16,
  panel: 0.2,
  emphasis: 0.24,
  overlay: 0.14,
  dialog: 0.18,
  context: 0.1,
  exit: 0.12,
  stepExit: 0.1,
  drawerExit: 0.14,
  contextExit: 0.07
};

const minimalDurations: Record<MotionTransitionName, number> = {
  instant: 0.06,
  fast: 0.08,
  base: 0.1,
  panel: 0.12,
  emphasis: 0.12,
  overlay: 0.08,
  dialog: 0.1,
  context: 0.07,
  exit: 0.08,
  stepExit: 0.08,
  drawerExit: 0.1,
  contextExit: 0.06
};

export function motionDuration(name: MotionTransitionName, mode: MotionMode): number {
  if (mode === "off") return 0.001;
  return (mode === "minimal" ? minimalDurations : standardDurations)[name];
}

export function createMotionTransition(
  name: MotionTransitionName,
  mode: MotionMode,
  easing: keyof typeof motionEasings =
    name === "exit" || name === "stepExit" || name === "drawerExit" || name === "contextExit" ? "exit" : "standard"
): Transition {
  return {
    duration: motionDuration(name, mode),
    ease: motionEasings[easing]
  };
}

/**
 * Shared defaults for code paths that do not need mode-specific durations.
 * Components that must support Motion Off should use useMotionTransition().
 */
export const motionTransitions = {
  instant: createMotionTransition("instant", "standard"),
  fast: createMotionTransition("fast", "standard"),
  base: createMotionTransition("base", "standard"),
  panel: createMotionTransition("panel", "standard", "enter"),
  emphasis: createMotionTransition("emphasis", "standard", "enter"),
  overlay: createMotionTransition("overlay", "standard", "enter"),
  dialog: createMotionTransition("dialog", "standard", "enter"),
  context: createMotionTransition("context", "standard", "enter"),
  exit: createMotionTransition("exit", "standard", "exit"),
  stepExit: createMotionTransition("stepExit", "standard", "exit"),
  drawerExit: createMotionTransition("drawerExit", "standard", "exit"),
  contextExit: createMotionTransition("contextExit", "standard", "exit")
} satisfies Record<MotionTransitionName, Transition>;
