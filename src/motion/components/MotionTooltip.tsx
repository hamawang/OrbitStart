import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type FocusEvent,
  type PointerEvent,
  type ReactElement
} from "react";
import { createPortal } from "react-dom";
import { useMotionPolicy } from "../MotionProvider";
import "./MotionTooltip.css";

export type TooltipPlacement = "top" | "bottom";

type ActiveTooltipOwner = {
  id: string;
  close: (immediate?: boolean) => void;
};

let activeTooltipOwner: ActiveTooltipOwner | null = null;

export interface MotionTooltipProps {
  children: ReactElement<Record<string, unknown>>;
  label: string;
  placement?: TooltipPlacement;
}

export interface MotionTooltipButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tooltip: string;
  tooltipPlacement?: TooltipPlacement;
}

type TooltipPosition = {
  left: number;
  top: number;
  placement: TooltipPlacement;
};

export function MotionTooltip({ children, label, placement = "bottom" }: MotionTooltipProps) {
  const id = useId();
  const { effectiveMode, isPaused } = useMotionPolicy();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({
    left: 0,
    top: 0,
    placement
  });
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const openRef = useRef(false);
  const mountedRef = useRef(false);
  const closeTooltipRef = useRef<(immediate?: boolean) => void>(() => undefined);
  const ownerCloseRef = useRef((immediate?: boolean) => closeTooltipRef.current(immediate));
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const tooltipElementRef = useRef<HTMLSpanElement | null>(null);

  const clearTimers = () => {
    if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    openTimerRef.current = null;
    closeTimerRef.current = null;
  };

  const releaseOwnership = () => {
    if (activeTooltipOwner?.id === id) activeTooltipOwner = null;
  };

  const closeTooltip = (immediate = false) => {
    clearTimers();
    const wasOpen = openRef.current;
    openRef.current = false;
    setOpen(false);
    releaseOwnership();

    if (!mountedRef.current) return;
    const exitDuration =
      immediate || !wasOpen || effectiveMode === "off"
        ? 0
        : effectiveMode === "minimal"
          ? 60
          : 70;
    if (exitDuration === 0) {
      mountedRef.current = false;
      setMounted(false);
      return;
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      mountedRef.current = false;
      setMounted(false);
    }, exitDuration);
  };
  closeTooltipRef.current = (immediate = false) => closeTooltip(immediate);

  useEffect(() => {
    if (!isPaused) return;
    closeTooltip(true);
  }, [isPaused]);

  useEffect(() => {
    return () => {
      clearTimers();
      releaseOwnership();
    };
  }, [id]);

  const measure = (
    element: HTMLElement,
    tooltipSize: { width: number; height: number } = {
      width: Math.min(240, Math.max(0, window.innerWidth - 24)),
      height: 40
    }
  ) => {
    const rect = element.getBoundingClientRect();
    const gap = 8;
    const viewportPadding = 12;
    const availableTop = rect.top - viewportPadding - gap;
    const availableBottom =
      window.innerHeight - rect.bottom - viewportPadding - gap;
    const resolvedPlacement =
      placement === "top" && availableTop < tooltipSize.height
        ? availableBottom >= availableTop
          ? "bottom"
          : "top"
        : placement === "bottom" && availableBottom < tooltipSize.height
          ? availableTop >= availableBottom
            ? "top"
            : "bottom"
          : placement;
    const halfWidth = tooltipSize.width / 2;
    const minLeft = viewportPadding + halfWidth;
    const maxLeft = Math.max(minLeft, window.innerWidth - viewportPadding - halfWidth);
    setPosition({
      left: Math.min(Math.max(rect.left + rect.width / 2, minLeft), maxLeft),
      top: resolvedPlacement === "top" ? rect.top - gap : rect.bottom + gap,
      placement: resolvedPlacement
    });
  };

  useLayoutEffect(() => {
    if (!mounted) return;
    const trigger = triggerElementRef.current;
    const tooltip = tooltipElementRef.current;
    if (!trigger || !tooltip) return;
    measure(trigger, {
      width: tooltip.offsetWidth,
      height: tooltip.offsetHeight
    });
  }, [label, mounted, placement]);

  useEffect(() => {
    if (!mounted) return;
    const update = () => {
      const trigger = triggerElementRef.current;
      const tooltip = tooltipElementRef.current;
      if (!trigger || !tooltip) return;
      measure(trigger, {
        width: tooltip.offsetWidth,
        height: tooltip.offsetHeight
      });
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [mounted, placement]);

  const scheduleOpen = (element: HTMLElement, immediate = false) => {
    clearTimers();
    triggerElementRef.current = element;
    measure(element);
    if (!mountedRef.current) {
      mountedRef.current = true;
      setMounted(true);
    }
    const delay = immediate || effectiveMode === "off" ? 0 : 240;
    const show = () => {
      openTimerRef.current = null;
      if (activeTooltipOwner?.id !== id) activeTooltipOwner?.close(true);
      activeTooltipOwner = { id, close: ownerCloseRef.current };
      openRef.current = true;
      setOpen(true);
    };
    if (delay === 0) show();
    else openTimerRef.current = window.setTimeout(show, delay);
  };

  const scheduleClose = () => {
    closeTooltip();
  };

  const childProps = children.props as {
    onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
    onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
    onFocus?: (event: FocusEvent<HTMLElement>) => void;
    onBlur?: (event: FocusEvent<HTMLElement>) => void;
    "aria-describedby"?: string;
  };

  const trigger = cloneElement(children, {
    "aria-describedby": open ? id : childProps["aria-describedby"],
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      childProps.onPointerEnter?.(event);
      scheduleOpen(event.currentTarget);
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      childProps.onPointerLeave?.(event);
      scheduleClose();
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      childProps.onFocus?.(event);
      scheduleOpen(event.currentTarget, true);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      childProps.onBlur?.(event);
      scheduleClose();
    }
  });

  return (
    <>
      {trigger}
      {mounted &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            ref={tooltipElementRef}
            id={id}
            role="tooltip"
            className="orbit-motion-tooltip"
            data-motion-tooltip
            data-state={open ? "open" : "closed"}
            data-placement={position.placement}
            aria-hidden={!open}
            style={{ left: position.left, top: position.top }}
          >
            {label}
          </span>,
          document.body
        )}
    </>
  );
}

export function MotionTooltipButton({
  tooltip,
  tooltipPlacement = "top",
  children,
  "aria-label": ariaLabel,
  ...buttonProps
}: MotionTooltipButtonProps) {
  return (
    <MotionTooltip label={tooltip} placement={tooltipPlacement}>
      <button aria-label={ariaLabel ?? tooltip} {...buttonProps}>
        {children}
      </button>
    </MotionTooltip>
  );
}
