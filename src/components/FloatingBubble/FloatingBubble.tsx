import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { availableMonitors, currentMonitor, cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { Clock, FolderKanban, Plus, Search, Settings } from "lucide-react";
import {
  applyMotionRootAttributes,
  currentDocumentWindowState,
  motionModeAllowsLayout,
  normalizeMotionMode,
  resolveEffectiveMotionMode,
  type MotionWindowState,
} from "../../motion/policy";
import type { AppSettings, MotionMode } from "../../types";
import { exitFloatingModeAndShowMain } from "../../bubble/native";
import { WindowPositionAnimator } from "./windowPositionAnimator";
import "./FloatingBubble.css";

interface FloatingBubbleProps {
  settings: AppSettings | null;
}

function clearTimer(timerRef: React.MutableRefObject<number | null>) {
  if (timerRef.current !== null) {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

function readSystemReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface BubbleWindowVisibilityPayload {
  label: string;
  visible: boolean;
  minimized: boolean;
  reason: string;
}

interface BubbleMenuHideRequestPayload {
  requestId: number;
  reason: string;
  hasAction: boolean;
}

interface BubbleMenuExitRequest {
  requestId: number;
  hasAction: boolean;
  timeoutId: number | null;
}

function useBubbleMotionPolicy(settings: AppSettings | null) {
  const requestedMode = normalizeMotionMode(settings?.motionMode);
  const [systemReducedMotion, setSystemReducedMotion] = useState(readSystemReducedMotion);
  const [windowState, setWindowState] = useState<MotionWindowState>(currentDocumentWindowState);
  const effectiveMode = resolveEffectiveMotionMode(requestedMode, systemReducedMotion);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event: MediaQueryListEvent) => setSystemReducedMotion(event.matches);
    setSystemReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    let disposed = false;
    let syncSequence = 0;
    let unlistenNativeVisibility: (() => void) | undefined;
    const appWindow = hasTauriRuntime() ? getCurrentWindow() : null;
    const windowLabel = appWindow?.label;

    const syncVisibility = () => {
      const sequence = ++syncSequence;
      if (!appWindow) {
        setWindowState(currentDocumentWindowState());
        return;
      }
      void Promise.all([appWindow.isVisible(), appWindow.isMinimized()])
        .then(([visible, minimized]) => {
          if (disposed || sequence !== syncSequence) return;
          const documentVisible = currentDocumentWindowState() === "visible";
          setWindowState(visible && !minimized && documentVisible ? "visible" : "hidden");
        })
        .catch(() => {
          if (disposed || sequence !== syncSequence) return;
          setWindowState(currentDocumentWindowState());
        });
    };
    const markHidden = () => setWindowState("hidden");
    document.addEventListener("visibilitychange", syncVisibility);
    window.addEventListener("pageshow", syncVisibility);
    window.addEventListener("pagehide", markHidden);

    if (appWindow && windowLabel) {
      void listen<BubbleWindowVisibilityPayload>("orbit://bubble-window-visibility", (event) => {
        if (event.payload?.label !== windowLabel) return;
        syncSequence += 1;
        setWindowState(event.payload.visible && !event.payload.minimized ? "visible" : "hidden");
      }).then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenNativeVisibility = unlisten;
        }
      }).catch((error) => {
        console.error("Failed to listen for floating window visibility", error);
      });
    }

    syncVisibility();
    return () => {
      disposed = true;
      syncSequence += 1;
      unlistenNativeVisibility?.();
      document.removeEventListener("visibilitychange", syncVisibility);
      window.removeEventListener("pageshow", syncVisibility);
      window.removeEventListener("pagehide", markHidden);
    };
  }, []);

  useLayoutEffect(() => {
    applyMotionRootAttributes(requestedMode, effectiveMode, windowState);
  }, [effectiveMode, requestedMode, windowState]);

  return {
    effectiveMode,
    isWindowVisible: windowState === "visible",
  };
}

async function logBubbleError(message: string) {
  try {
    await invoke("log_frontend_error", { message });
  } catch {
    console.error(message);
  }
}

type BubbleAlign = "left" | "right";
interface BubbleDragState {
  isDragging: boolean;
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  startWindowX: number;
  startWindowY: number;
  hasMoved: boolean;
  positionSequence: number;
  latestMovePromise: Promise<void> | null;
}

const BUBBLE_EDGE_MARGIN_LOGICAL = 4;
const BUBBLE_SNAP_DURATION_MS = 160;

export function snapDurationForMode(mode: MotionMode) {
  return motionModeAllowsLayout(mode) ? BUBBLE_SNAP_DURATION_MS : 0;
}

export function bubbleMenuExitDuration(mode: MotionMode) {
  if (mode === "off") return 0;
  if (mode === "minimal") return 70;
  return 90;
}

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function clampNumber(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function monitorPhysicalBounds(monitor: {
  position: { x: number; y: number };
  size: { width: number; height: number };
  scaleFactor: number;
}) {
  return {
    x: monitor.position.x,
    y: monitor.position.y,
    width: monitor.size.width,
    height: monitor.size.height,
  };
}

function bubbleEdgeMargin(monitor: { scaleFactor: number }) {
  return Math.round(BUBBLE_EDGE_MARGIN_LOGICAL * (monitor.scaleFactor || 1));
}

function bubbleVisualDiameter(sizeValue: number, monitor: { scaleFactor: number }) {
  return Math.round(sizeValue * (monitor.scaleFactor || 1));
}

function bubbleHorizontalInset(windowWidth: number, visualDiameter: number) {
  return Math.max(0, (windowWidth - visualDiameter) / 2);
}

function bubbleEdgeX(
  align: BubbleAlign,
  windowWidth: number,
  visualDiameter: number,
  monitor: {
    position: { x: number; y: number };
    size: { width: number; height: number };
    scaleFactor: number;
  }
) {
  const bounds = monitorPhysicalBounds(monitor);
  const margin = bubbleEdgeMargin(monitor);
  const horizontalInset = bubbleHorizontalInset(windowWidth, visualDiameter);
  return align === "left"
    ? bounds.x + margin - horizontalInset
    : bounds.x + bounds.width - visualDiameter - margin - horizontalInset;
}

function clampBubbleToMonitor(
  x: number,
  y: number,
  windowWidth: number,
  windowHeight: number,
  monitor: {
    position: { x: number; y: number };
    size: { width: number; height: number };
    scaleFactor: number;
  },
  visualWidth = windowWidth
): { x: number; y: number; align: BubbleAlign } {
  const bounds = monitorPhysicalBounds(monitor);
  const margin = bubbleEdgeMargin(monitor);
  const horizontalInset = bubbleHorizontalInset(windowWidth, visualWidth);
  const minX = bounds.x + margin - horizontalInset;
  const maxX = bounds.x + bounds.width - visualWidth - margin - horizontalInset;
  const minY = bounds.y + margin;
  const maxY = bounds.y + bounds.height - windowHeight - margin;
  const fallbackX = bounds.x + Math.max(0, (bounds.width - windowWidth) / 2);
  const fallbackY = bounds.y + Math.max(0, (bounds.height - windowHeight) / 2);
  const nextX = maxX >= minX ? clampNumber(x, minX, maxX) : fallbackX;
  const nextY = maxY >= minY ? clampNumber(y, minY, maxY) : fallbackY;
  const align = nextX + windowWidth / 2 < bounds.x + bounds.width / 2 ? "left" : "right";
  return { x: nextX, y: nextY, align };
}

async function getBubbleOuterSize(appWin: any, sizeValue: number, monitor: { scaleFactor: number } | null) {
  try {
    const size = await appWin.outerSize();
    if (Number.isFinite(size?.width) && Number.isFinite(size?.height) && size.width > 0 && size.height > 0) {
      return { width: Number(size.width), height: Number(size.height) };
    }
  } catch {
    // Fall through to a conservative fallback.
  }
  const scaleFactor = monitor?.scaleFactor || 1;
  const fallbackSize = Math.round(sizeValue * scaleFactor);
  return { width: fallbackSize, height: fallbackSize };
}

async function pickMonitorForBubblePosition(x: number, y: number, windowWidth: number, windowHeight: number) {
  let monitors: Awaited<ReturnType<typeof availableMonitors>> = [];
  try {
    monitors = await availableMonitors();
  } catch {
    monitors = [];
  }

  const centerX = x + windowWidth / 2;
  const centerY = y + windowHeight / 2;
  const matchingMonitor = monitors.find((monitor) => {
    const bounds = monitorPhysicalBounds(monitor);
    return (
      centerX >= bounds.x &&
      centerX <= bounds.x + bounds.width &&
      centerY >= bounds.y &&
      centerY <= bounds.y + bounds.height
    );
  });
  if (matchingMonitor) return matchingMonitor;

  try {
    return (await currentMonitor()) ?? monitors[0] ?? null;
  } catch {
    return monitors[0] ?? null;
  }
}

function readSavedBubblePosition(): { x: number; y: number } | null {
  const savedPos = localStorage.getItem("orbitstart_bubble_position");
  if (!savedPos) return null;
  try {
    const pos = JSON.parse(savedPos);
    if (Number.isFinite(pos?.x) && Number.isFinite(pos?.y)) {
      return { x: Number(pos.x), y: Number(pos.y) };
    }
  } catch (e) {
    console.error("Failed to parse saved bubble position", e);
  }
  localStorage.removeItem("orbitstart_bubble_position");
  return null;
}

export function FloatingBubble({ settings }: FloatingBubbleProps) {
  const sizeValue = settings?.bubbleSize ?? 64;
  const configuredOpacity = settings?.bubbleOpacity ?? 1.0;
  const alwaysOnTop = settings?.bubbleAlwaysOnTop ?? true;
  const expandOnHover = settings?.bubbleExpandOnHover ?? true;
  const expandDelayMs = Math.max(80, settings?.bubbleExpandDelayMs ?? 180);
  const snapToEdge = settings?.bubbleSnapToEdge ?? true;
  const { effectiveMode, isWindowVisible } = useBubbleMotionPolicy(settings);

  const [isMainBubbleHovered, setIsMainBubbleHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [align, setAlign] = useState<"left" | "right">("right");
  const [previewOpacity, setPreviewOpacity] = useState(configuredOpacity);

  const showMenuTimerRef = useRef<number | null>(null);
  const hideMenuTimerRef = useRef<number | null>(null);
  const bubbleHoveredRef = useRef(false);
  const menuHoveredRef = useRef(false);
  const isWindowVisibleRef = useRef(isWindowVisible);
  const positionAnimatorRef = useRef<WindowPositionAnimator | null>(null);

  const dragRef = useRef<BubbleDragState | null>(null);

  const getPositionAnimator = () => {
    if (!positionAnimatorRef.current) {
      positionAnimatorRef.current = new WindowPositionAnimator((error) => {
        void logBubbleError(`bubble position update failed: ${String(error)}`);
      });
    }
    return positionAnimatorRef.current;
  };

  useEffect(() => {
    const animator = getPositionAnimator();
    return () => {
      animator.dispose();
      if (positionAnimatorRef.current === animator) {
        positionAnimatorRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setPreviewOpacity(configuredOpacity);
  }, [configuredOpacity]);

  useEffect(() => {
    isWindowVisibleRef.current = isWindowVisible;
    if (isWindowVisible) return;

    clearTimer(showMenuTimerRef);
    clearTimer(hideMenuTimerRef);
    bubbleHoveredRef.current = false;
    menuHoveredRef.current = false;
    setIsMainBubbleHovered(false);
    setIsPressed(false);
    setIsDragging(false);

    if (dragRef.current?.isDragging) {
      dragRef.current = null;
    }
    positionAnimatorRef.current?.finishAnimation();
  }, [isWindowVisible]);

  useEffect(() => {
    if (!motionModeAllowsLayout(effectiveMode)) {
      positionAnimatorRef.current?.finishAnimation();
    }
  }, [effectiveMode]);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    let unlistenOpacity: (() => void) | undefined;
    let unlistenMenuHover: (() => void) | undefined;
    let unlistenPosition: (() => void) | undefined;

    listen<number>("orbit://bubble-opacity-preview", (event) => {
      const value = Number(event.payload);
      if (Number.isFinite(value)) {
        setPreviewOpacity(Math.max(0.1, Math.min(1, value)));
      }
    }).then((unlisten) => {
      unlistenOpacity = unlisten;
    });

    listen<string>("orbit://bubble-menu-hover", (event) => {
      menuHoveredRef.current = event.payload === "enter";
      if (menuHoveredRef.current) {
        clearTimer(hideMenuTimerRef);
        void invoke("cancel_hide_bubble_menu_window").catch(() => undefined);
      } else {
        scheduleHideMenu();
      }
    }).then((unlisten) => {
      unlistenMenuHover = unlisten;
    });

    listen<{ x: number; y: number; align: "left" | "right" }>("orbit://bubble-position-changed", (event) => {
      const payload = event.payload;
      if (!payload || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
      positionAnimatorRef.current?.cancelAnimation();
      const nextAlign = payload.align === "left" ? "left" : "right";
      setAlign(nextAlign);
      localStorage.setItem("orbitstart_bubble_align", nextAlign);
      localStorage.setItem("orbitstart_bubble_position", JSON.stringify({ x: payload.x, y: payload.y }));
    }).then((unlisten) => {
      unlistenPosition = unlisten;
    });

    return () => {
      unlistenOpacity?.();
      unlistenMenuHover?.();
      unlistenPosition?.();
    };
  }, []);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    let cancelled = false;
    const savedAlign = localStorage.getItem("orbitstart_bubble_align");

    if (savedAlign === "left" || savedAlign === "right") {
      setAlign(savedAlign);
    }

    const appWin = getCurrentWindow() as any;
    const positionAnimator = getPositionAnimator();
    positionAnimator.cancelAnimation();
    const savedPosition = readSavedBubblePosition();
    const runInit = async () => {
      try {
        if (savedPosition) {
          const probeMonitor = await pickMonitorForBubblePosition(savedPosition.x, savedPosition.y, sizeValue, sizeValue);
          const outerSize = await getBubbleOuterSize(appWin, sizeValue, probeMonitor);
          const monitor = await pickMonitorForBubblePosition(savedPosition.x, savedPosition.y, outerSize.width, outerSize.height);
          if (monitor) {
            const visualDiameter = bubbleVisualDiameter(sizeValue, monitor);
            let next = clampBubbleToMonitor(savedPosition.x, savedPosition.y, outerSize.width, outerSize.height, monitor, visualDiameter);
            if (snapToEdge) {
              const preferredAlign = savedAlign === "left" || savedAlign === "right" ? savedAlign : next.align;
              const edgeX = bubbleEdgeX(preferredAlign, outerSize.width, visualDiameter, monitor);
              next = clampBubbleToMonitor(edgeX, next.y, outerSize.width, outerSize.height, monitor, visualDiameter);
            }
            await positionAnimator.moveTo(appWin, next.x, next.y);
            if (cancelled || dragRef.current) return;
            setAlign(next.align);
            localStorage.setItem("orbitstart_bubble_align", next.align);
            localStorage.setItem("orbitstart_bubble_position", JSON.stringify({ x: next.x, y: next.y }));
            return;
          }
          await positionAnimator.moveTo(appWin, savedPosition.x, savedPosition.y);
          return;
        }

        const monitor = await currentMonitor();
        if (monitor) {
          const bounds = monitorPhysicalBounds(monitor);
          const outerSize = await getBubbleOuterSize(appWin, sizeValue, monitor);
          const visualDiameter = bubbleVisualDiameter(sizeValue, monitor);
          const defaultX = bubbleEdgeX("right", outerSize.width, visualDiameter, monitor);
          const defaultY = bounds.y + bounds.height * 0.7 - outerSize.height / 2;
          const next = clampBubbleToMonitor(defaultX, defaultY, outerSize.width, outerSize.height, monitor, visualDiameter);
          await positionAnimator.moveTo(appWin, next.x, next.y);
          if (cancelled || dragRef.current) return;
          setAlign(next.align);
          localStorage.setItem("orbitstart_bubble_align", next.align);
          localStorage.setItem("orbitstart_bubble_position", JSON.stringify({ x: next.x, y: next.y }));
        }
      } catch (err) {
        console.error("Failed to initialize bubble window position:", err);
      }
    };
    void runInit();

    return () => {
      cancelled = true;
    };
  }, [sizeValue, snapToEdge]);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    const appWin = getCurrentWindow() as any;
    appWin.setAlwaysOnTop(alwaysOnTop).catch(() => undefined);
  }, [alwaysOnTop]);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    const preventDefault = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", preventDefault);
    void invoke("refresh_bubble_native_window").catch((error) => {
      void logBubbleError(`refresh_bubble_native_window failed: ${String(error)}`);
    });
    const refreshTimer = window.setTimeout(() => {
      void invoke("refresh_bubble_native_window").catch(() => undefined);
    }, 250);

    let unlistenReset: (() => void) | undefined;
    listen<{ x?: number; y?: number }>("orbit://bubble-reset-position", (event) => {
      positionAnimatorRef.current?.cancelAnimation();
      dragRef.current = null;
      setIsPressed(false);
      setIsDragging(false);
      setAlign("right");
      localStorage.setItem("orbitstart_bubble_align", "right");
      const payload = event.payload;
      if (payload && Number.isFinite(payload.x) && Number.isFinite(payload.y)) {
        localStorage.setItem("orbitstart_bubble_position", JSON.stringify({ x: payload.x, y: payload.y }));
      }
    }).then((un) => {
      unlistenReset = un;
    });

    return () => {
      clearTimer(showMenuTimerRef);
      clearTimer(hideMenuTimerRef);
      void invoke("hide_bubble_menu_window", { reason: "bubble-unmount" }).catch(() => undefined);
      window.clearTimeout(refreshTimer);
      window.removeEventListener("contextmenu", preventDefault);
      unlistenReset?.();
    };
  }, []);

  const styleVariables = useMemo(() => {
    return {
      "--main-size": `${sizeValue}px`,
      opacity: previewOpacity,
    } as React.CSSProperties;
  }, [sizeValue, previewOpacity]);

  const isLarge = sizeValue >= 64;
  const normalImg = isLarge ? "/design/大悬浮球(无光晕).png" : "/design/小悬浮球(无光晕).png";
  const hoverImg = isLarge ? "/design/大悬浮球(有光晕).png" : "/design/小悬浮球(有光晕).png";

  function scheduleShowMenu() {
    if (!expandOnHover || !isWindowVisibleRef.current) return;
    void invoke("cancel_hide_bubble_menu_window").catch(() => undefined);
    clearTimer(hideMenuTimerRef);
    clearTimer(showMenuTimerRef);
    showMenuTimerRef.current = window.setTimeout(() => {
      if (!isWindowVisibleRef.current || !bubbleHoveredRef.current || dragRef.current?.isDragging) return;
      void invoke("show_bubble_menu_window").catch((error) => {
        void logBubbleError(`show_bubble_menu_window failed: ${String(error)}`);
      });
    }, expandDelayMs);
  }

  function scheduleHideMenu() {
    clearTimer(showMenuTimerRef);
    clearTimer(hideMenuTimerRef);
    hideMenuTimerRef.current = window.setTimeout(() => {
      if (!isWindowVisibleRef.current) return;
      if (bubbleHoveredRef.current || menuHoveredRef.current) return;
      void invoke("hide_bubble_menu_window", { reason: "hover-leave" }).catch(() => undefined);
    }, 350);
  }

  function showMenuNow() {
    if (!isWindowVisibleRef.current) return;
    void invoke("cancel_hide_bubble_menu_window").catch(() => undefined);
    clearTimer(showMenuTimerRef);
    clearTimer(hideMenuTimerRef);
    void invoke("show_bubble_menu_window").catch((error) => {
      void logBubbleError(`show_bubble_menu_window failed: ${String(error)}`);
    });
  }

  function markBubbleHovered() {
    if (dragRef.current?.isDragging) return;
    if (!bubbleHoveredRef.current) {
      bubbleHoveredRef.current = true;
      setIsMainBubbleHovered(true);
      scheduleShowMenu();
    }
  }

  const handlePointerDown = async (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.button === 2) {
      bubbleHoveredRef.current = true;
      setIsMainBubbleHovered(true);
      showMenuNow();
      return;
    }
    if (e.button !== 0) return;
    getPositionAnimator().cancelAnimation();
    e.currentTarget.setPointerCapture(e.pointerId);
    clearTimer(showMenuTimerRef);
    bubbleHoveredRef.current = false;
    setIsMainBubbleHovered(false);
    setIsPressed(true);
    setIsDragging(false);
    void invoke("hide_bubble_menu_window", { reason: "drag-start" }).catch(() => undefined);

    const appWin = getCurrentWindow() as any;
    const dragState: BubbleDragState = {
      isDragging: true,
      pointerId: e.pointerId,
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      startWindowX: Number.NaN,
      startWindowY: Number.NaN,
      hasMoved: false,
      positionSequence: 0,
      latestMovePromise: null,
    };
    dragRef.current = dragState;
    try {
      const startPos = await appWin.outerPosition();
      const startCursor = await cursorPosition();
      if (dragRef.current === dragState && dragState.isDragging) {
        dragState.startScreenX = startCursor.x;
        dragState.startScreenY = startCursor.y;
        dragState.startWindowX = startPos.x;
        dragState.startWindowY = startPos.y;
      }
    } catch (error) {
      if (dragRef.current === dragState) {
        dragRef.current = null;
      }
      setIsPressed(false);
      setIsDragging(false);
      await invoke("begin_bubble_drag").catch((fallbackError) => {
        void logBubbleError(`bubble drag failed: ${String(error)}; fallback failed: ${String(fallbackError)}`);
      });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      markBubbleHovered();
      return;
    }
    if (!drag.isDragging || drag.pointerId !== e.pointerId) return;

    const sequence = ++drag.positionSequence;
    const movePromise = cursorPosition()
      .then((currentCursor) => {
        const activeDrag = dragRef.current;
        if (activeDrag !== drag || !activeDrag.isDragging || sequence !== activeDrag.positionSequence) return;
        if (!Number.isFinite(activeDrag.startWindowX) || !Number.isFinite(activeDrag.startWindowY)) return;

        const deltaX = currentCursor.x - activeDrag.startScreenX;
        const deltaY = currentCursor.y - activeDrag.startScreenY;
        if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
          if (!activeDrag.hasMoved) {
            activeDrag.hasMoved = true;
            setIsPressed(false);
            setIsDragging(true);
          }
        }
        if (!activeDrag.hasMoved) return;

        const newX = activeDrag.startWindowX + deltaX;
        const newY = activeDrag.startWindowY + deltaY;
        getPositionAnimator().queueLatest(getCurrentWindow() as any, newX, newY);
      })
      .catch((error) => {
        void logBubbleError(`bubble pointer move failed: ${String(error)}`);
      });
    drag.latestMovePromise = movePromise;
  };

  const handlePointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    setIsPressed(false);
    if (!drag) {
      if (e.button === 2) {
        e.preventDefault();
        bubbleHoveredRef.current = true;
        setIsMainBubbleHovered(true);
        showMenuNow();
      }
      return;
    }
    if (drag.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    await drag.latestMovePromise;
    await getPositionAnimator().waitForIdle();
    if (dragRef.current !== drag) return;

    drag.isDragging = false;
    setIsDragging(false);
    const appWin = getCurrentWindow() as any;

    if (drag.hasMoved) {
      try {
        const monitor = await currentMonitor();
        if (dragRef.current !== drag) return;
        if (monitor) {
          const pos = await appWin.outerPosition();
          if (dragRef.current !== drag) return;
          const outerSize = await getBubbleOuterSize(appWin, sizeValue, monitor);
          if (dragRef.current !== drag) return;
          const bounds = monitorPhysicalBounds(monitor);
          const visualDiameter = bubbleVisualDiameter(sizeValue, monitor);
          const centerX = pos.x + outerSize.width / 2;
          const monitorCenterX = bounds.x + bounds.width / 2;
          const isLeft = centerX < monitorCenterX;

          const rawX = bubbleEdgeX(isLeft ? "left" : "right", outerSize.width, visualDiameter, monitor);
          const rawY = pos.y;
          const next = clampBubbleToMonitor(rawX, rawY, outerSize.width, outerSize.height, monitor, visualDiameter);

          if (snapToEdge) {
            const snapCompleted = await getPositionAnimator().animate(
              appWin,
              pos.x,
              pos.y,
              next.x,
              next.y,
              isWindowVisibleRef.current ? snapDurationForMode(effectiveMode) : 0
            );
            if (!snapCompleted || dragRef.current !== drag) return;
          }

          const savedX = snapToEdge ? next.x : pos.x;
          const savedY = snapToEdge ? next.y : pos.y;
          setAlign(next.align);
          localStorage.setItem("orbitstart_bubble_align", next.align);
          localStorage.setItem("orbitstart_bubble_position", JSON.stringify({ x: savedX, y: savedY }));
        }
      } catch (error) {
        void logBubbleError(`bubble snap failed: ${String(error)}`);
      }
    } else {
      dragRef.current = null;
      try {
        await exitFloatingModeAndShowMain();
      } catch (error) {
        await logBubbleError(`failed to restore main window from bubble click: ${String(error)}`);
      }
    }

    if (dragRef.current === drag) {
      dragRef.current = null;
    }
    if (bubbleHoveredRef.current) scheduleShowMenu();
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    getPositionAnimator().cancelAnimation();
    dragRef.current = null;
    setIsPressed(false);
    setIsDragging(false);
  };

  const handlePointerEnter = () => {
    if (dragRef.current?.isDragging) return;
    bubbleHoveredRef.current = true;
    setIsMainBubbleHovered(true);
    scheduleShowMenu();
  };

  const handlePointerLeave = () => {
    bubbleHoveredRef.current = false;
    setIsMainBubbleHovered(false);
    if (!dragRef.current?.isDragging) scheduleHideMenu();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    showMenuNow();
  };

  const handleMouseMove = () => {
    markBubbleHovered();
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (e.button === 2) {
      e.preventDefault();
      bubbleHoveredRef.current = true;
      setIsMainBubbleHovered(true);
      showMenuNow();
    }
  };

  return (
    <div className="bubble-window-wrapper">
      <div
        className={`bubble-active-area align-${align}`}
        style={styleVariables}
        onContextMenu={handleContextMenu}
      >
        <div
          className={[
            "main-bubble",
            isMainBubbleHovered ? "hovered" : "",
            isPressed && !isDragging ? "pressed" : "",
            isDragging ? "dragging" : "",
          ].filter(Boolean).join(" ")}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <img
            src={normalImg}
            alt="OrbitStart"
            className="bubble-img bubble-img-normal"
            draggable={false}
          />
          <img
            src={hoverImg}
            alt=""
            aria-hidden="true"
            className="bubble-img bubble-img-hover"
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}

const menuActions = [
  { id: "search", label: "搜索", icon: Search },
  { id: "add-resource", label: "添加", icon: Plus },
  { id: "workspace", label: "工作区", icon: FolderKanban },
  { id: "recent", label: "最近", icon: Clock },
  { id: "settings", label: "设置", icon: Settings },
] as const;

export function FloatingBubbleMenu({ settings }: FloatingBubbleProps) {
  const opacityValue = settings?.bubbleOpacity ?? 1.0;
  const { effectiveMode, isWindowVisible } = useBubbleMotionPolicy(settings);
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);
  const [menuPhase, setMenuPhase] = useState<"visible" | "exiting">("visible");
  const [presentationRevision, setPresentationRevision] = useState(0);
  const [actionPending, setActionPending] = useState(false);
  const effectiveModeRef = useRef(effectiveMode);
  const actionPendingRef = useRef(false);
  const nativeVisibleRef = useRef(hasTauriRuntime() ? false : isWindowVisible);
  const exitRequestRef = useRef<BubbleMenuExitRequest | null>(null);

  const normalActionImg = "/design/小悬浮球(无光晕).png";
  const hoverActionImg = "/design/小悬浮球(有光晕).png";

  const clearExitTimer = () => {
    const pending = exitRequestRef.current;
    if (pending?.timeoutId !== null && pending?.timeoutId !== undefined) {
      window.clearTimeout(pending.timeoutId);
      pending.timeoutId = null;
    }
  };

  const completeMenuExit = (requestId: number) => {
    const pending = exitRequestRef.current;
    if (!pending || pending.requestId !== requestId) return;
    clearExitTimer();
    exitRequestRef.current = null;
    void invoke<boolean>("complete_hide_bubble_menu_window", { requestId }).catch((error) => {
      void logBubbleError(`bubble menu exit completion failed: ${String(error)}`);
    });
  };

  const beginMenuExit = (payload: BubbleMenuHideRequestPayload) => {
    const current = exitRequestRef.current;
    if (current?.requestId === payload.requestId) return;
    if (current?.hasAction && !payload.hasAction) return;

    clearExitTimer();
    const pending: BubbleMenuExitRequest = {
      requestId: payload.requestId,
      hasAction: payload.hasAction,
      timeoutId: null,
    };
    exitRequestRef.current = pending;
    if (payload.hasAction) {
      actionPendingRef.current = true;
      setActionPending(true);
    }
    setHoveredAction(null);
    setMenuPhase("exiting");
    setPresentationRevision((revision) => revision + 1);

    const duration = bubbleMenuExitDuration(effectiveModeRef.current);
    if (duration === 0) {
      completeMenuExit(payload.requestId);
      return;
    }
    pending.timeoutId = window.setTimeout(() => completeMenuExit(payload.requestId), duration);
  };

  const cancelLocalMenuExit = (forceEntrance = false) => {
    const pending = exitRequestRef.current;
    if (pending?.hasAction) return;
    if (!pending && !forceEntrance) return;
    clearExitTimer();
    exitRequestRef.current = null;
    setMenuPhase("visible");
    setPresentationRevision((revision) => revision + 1);
  };

  useEffect(() => {
    effectiveModeRef.current = effectiveMode;
    const pending = exitRequestRef.current;
    if (!pending) return;
    const duration = bubbleMenuExitDuration(effectiveMode);
    clearExitTimer();
    if (duration === 0) {
      completeMenuExit(pending.requestId);
    } else {
      pending.timeoutId = window.setTimeout(() => completeMenuExit(pending.requestId), duration);
    }
  }, [effectiveMode]);

  useEffect(() => {
    let disposed = false;
    let unlistenHideRequest: (() => void) | undefined;
    let unlistenVisibility: (() => void) | undefined;
    const windowLabel = hasTauriRuntime() ? getCurrentWindow().label : "";

    if (hasTauriRuntime()) {
      void Promise.all([
        listen<BubbleMenuHideRequestPayload>("orbit://bubble-menu-hide-requested", (event) => {
          beginMenuExit(event.payload);
        }),
        listen<BubbleWindowVisibilityPayload>("orbit://bubble-window-visibility", (event) => {
          const payload = event.payload;
          if (!payload || payload.label !== windowLabel) return;
          const nextVisible = payload.visible && !payload.minimized;
          const wasVisible = nativeVisibleRef.current;
          nativeVisibleRef.current = nextVisible;
          if (!nextVisible) {
            clearExitTimer();
            exitRequestRef.current = null;
            setHoveredAction(null);
            setMenuPhase("visible");
            actionPendingRef.current = false;
            setActionPending(false);
            return;
          }

          if (!wasVisible) {
            cancelLocalMenuExit(true);
          } else if (payload.reason === "hide-cancelled") {
            cancelLocalMenuExit();
          }
        }),
      ]).then(([hideRequestDisposer, visibilityDisposer]) => {
        if (disposed) {
          hideRequestDisposer();
          visibilityDisposer();
        } else {
          unlistenHideRequest = hideRequestDisposer;
          unlistenVisibility = visibilityDisposer;
        }
      }).catch((error) => {
        console.error("Failed to listen for floating bubble menu transitions", error);
      });
    }

    return () => {
      disposed = true;
      clearExitTimer();
      unlistenHideRequest?.();
      unlistenVisibility?.();
      void emit("orbit://bubble-menu-hover", "leave").catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (isWindowVisible) return;
    clearExitTimer();
    exitRequestRef.current = null;
    setHoveredAction(null);
    setMenuPhase("visible");
    actionPendingRef.current = false;
    setActionPending(false);
    void emit("orbit://bubble-menu-hover", "leave").catch(() => undefined);
  }, [isWindowVisible]);

  const handleMouseEnter = () => {
    if (!isWindowVisible) return;
    if (!actionPendingRef.current) {
      cancelLocalMenuExit();
      void invoke<boolean>("cancel_hide_bubble_menu_window").catch(() => undefined);
    }
    void emit("orbit://bubble-menu-hover", "enter").catch(() => undefined);
  };

  const handleMouseLeave = () => {
    setHoveredAction(null);
    void emit("orbit://bubble-menu-hover", "leave").catch(() => undefined);
  };

  const handleAction = async (action: string) => {
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    setActionPending(true);
    await emit("orbit://bubble-menu-hover", "leave").catch(() => undefined);
    try {
      const requestId = await invoke<number | null>("hide_bubble_menu_window", {
        reason: "action",
        action,
      });
      if (requestId !== null) {
        beginMenuExit({ requestId, reason: "action", hasAction: true });
      }
    } catch (error) {
      actionPendingRef.current = false;
      setActionPending(false);
      await logBubbleError(`bubble menu action failed: ${String(error)}`);
    }
  };

  return (
    <div
      key={presentationRevision}
      className={`bubble-menu-shell ${menuPhase === "exiting" ? "is-exiting" : "is-visible"}`}
      style={{ "--bubble-menu-opacity": opacityValue } as React.CSSProperties}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={(event) => event.preventDefault()}
      onAnimationEnd={(event) => {
        if (!event.animationName.startsWith("orbit-bubble-menu-exit")) return;
        const pending = exitRequestRef.current;
        if (pending) completeMenuExit(pending.requestId);
      }}
    >
      {menuActions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            className="bubble-menu-action"
            aria-label={action.label}
            disabled={actionPending}
            onPointerEnter={() => setHoveredAction(action.id)}
            onPointerLeave={() => setHoveredAction((current) => current === action.id ? null : current)}
            onClick={() => void handleAction(action.id)}
          >
            <img
              src={normalActionImg}
              alt=""
              aria-hidden="true"
              className="bubble-menu-action-bg bubble-menu-action-bg-normal"
              draggable={false}
            />
            <img
              src={hoverActionImg}
              alt=""
              aria-hidden="true"
              className="bubble-menu-action-bg bubble-menu-action-bg-hover"
              draggable={false}
            />
            <Icon size={18} />
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}
