import type { Variants } from "motion/react";

export const motionVariants = {
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 }
  },
  fadeSlide: {
    hidden: { opacity: 0, y: 6 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 4 }
  },
  page: {
    hidden: { opacity: 0.96, y: 4 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0.96, y: -2 }
  },
  backdrop: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 }
  },
  dialog: {
    hidden: { opacity: 0, y: 6, scale: 0.985 },
    visible: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: 4, scale: 0.99 }
  },
  drawer: {
    hidden: { opacity: 0, x: 12 },
    visible: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 8 }
  },
  contextMenu: {
    hidden: { opacity: 0, scale: 0.98 },
    visible: { opacity: 1, scale: 1 },
    exit: { opacity: 0 }
  },
  collapse: {
    hidden: { opacity: 0, height: 0 },
    visible: { opacity: 1, height: "auto" },
    exit: { opacity: 0, height: 0 }
  },
  statusSwap: {
    hidden: { opacity: 0, y: 2 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -2 }
  }
} satisfies Record<string, Variants>;
