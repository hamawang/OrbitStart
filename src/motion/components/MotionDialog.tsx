import { AnimatePresence, m, useIsPresent } from "motion/react";
import { useEffect, useRef, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMotionPolicy, useMotionTransition } from "../MotionProvider";
import { motionVariants } from "../variants";

export interface MotionDialogProps {
  open: boolean;
  children: ReactNode;
  className?: string;
  backdropClassName?: string;
  onBackdropClick?: () => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  backdropStyle?: CSSProperties;
  panelStyle?: CSSProperties;
}

type MotionDialogFrameProps = Omit<MotionDialogProps, "open">;

function MotionDialogFrame({
  children,
  className,
  backdropClassName,
  onBackdropClick,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  backdropStyle,
  panelStyle
}: MotionDialogFrameProps) {
  const isPresent = useIsPresent();
  const backdropRef = useRef<HTMLDivElement>(null);
  const backdropTransition = useMotionTransition("overlay");
  const panelTransition = useMotionTransition("dialog");
  const exitTransition = useMotionTransition("exit");
  const { animationsEnabled, transformsEnabled } = useMotionPolicy();
  const panelVariants = !animationsEnabled
    ? {
        hidden: { opacity: 1 },
        visible: { opacity: 1 },
        exit: { opacity: 1 }
      }
    : transformsEnabled
      ? motionVariants.dialog
      : motionVariants.fade;
  const panelExit = !animationsEnabled
    ? { opacity: 1, transition: exitTransition }
    : transformsEnabled
      ? { opacity: 0, y: 4, scale: 0.99, transition: exitTransition }
      : { opacity: 0, transition: exitTransition };

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onBackdropClick?.();
  };

  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    if (isPresent) backdrop.removeAttribute("inert");
    else backdrop.setAttribute("inert", "");
  }, [isPresent]);

  return (
    <m.div
      ref={backdropRef}
      className={backdropClassName}
      data-motion-dialog=""
      data-presence={isPresent ? "present" : "exiting"}
      variants={motionVariants.backdrop}
      initial="hidden"
      animate="visible"
      exit={{ opacity: 0, transition: exitTransition }}
      transition={backdropTransition}
      onClick={handleBackdropClick}
      style={{
        ...backdropStyle,
        pointerEvents: isPresent ? backdropStyle?.pointerEvents : "none"
      }}
    >
      <m.div
        role="dialog"
        aria-modal="true"
        aria-hidden={!isPresent}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        className={className}
        data-motion-dialog-panel=""
        style={panelStyle}
        variants={panelVariants}
        initial="hidden"
        animate="visible"
        exit={panelExit}
        transition={panelTransition}
      >
        {children}
      </m.div>
    </m.div>
  );
}

export function MotionDialog({ open, ...frameProps }: MotionDialogProps) {
  const content = (
    <AnimatePresence initial={false}>
      {open ? <MotionDialogFrame {...frameProps} /> : null}
    </AnimatePresence>
  );
  return typeof document === "undefined" ? content : createPortal(content, document.body);
}
