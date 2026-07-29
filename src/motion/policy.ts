import type { MotionMode } from "../types";

export type MotionWindowState = "visible" | "hidden";

export const MOTION_MODES: readonly MotionMode[] = ["full", "standard", "minimal", "off"] as const;
export const DEFAULT_MOTION_MODE: MotionMode = "standard";
export const MOTION_MODE_BOOTSTRAP_KEY = "orbitstart.motion-mode";

export function isMotionMode(value: unknown): value is MotionMode {
  return typeof value === "string" && (MOTION_MODES as readonly string[]).includes(value);
}

export function normalizeMotionMode(value: unknown): MotionMode {
  return isMotionMode(value) ? value : DEFAULT_MOTION_MODE;
}

export function readBootstrapMotionMode(): MotionMode {
  if (typeof window === "undefined") return DEFAULT_MOTION_MODE;
  try {
    const mirroredMode = window.localStorage.getItem(MOTION_MODE_BOOTSTRAP_KEY);
    if (isMotionMode(mirroredMode)) return mirroredMode;

    const browserSnapshot = window.localStorage.getItem("orbitstart.browser.snapshot");
    if (browserSnapshot) {
      const parsed = JSON.parse(browserSnapshot) as {
        settings?: { motionMode?: unknown };
      };
      if (isMotionMode(parsed.settings?.motionMode)) {
        return parsed.settings.motionMode;
      }
    }
  } catch {
    // A blocked or malformed localStorage entry must not prevent startup.
  }
  return DEFAULT_MOTION_MODE;
}

export function persistBootstrapMotionMode(mode: MotionMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOTION_MODE_BOOTSTRAP_KEY, mode);
  } catch {
    // The database remains authoritative when localStorage is unavailable.
  }
}

/**
 * Windows/browser reduced-motion is a hard cap, not a replacement for the
 * stored preference. The requested mode remains available when the OS setting
 * is turned off again.
 */
export function resolveEffectiveMotionMode(requestedMode: MotionMode, systemReducedMotion: boolean): MotionMode {
  if (!systemReducedMotion) return requestedMode;
  return requestedMode === "off" ? "off" : "minimal";
}

export function currentDocumentWindowState(): MotionWindowState {
  if (typeof document === "undefined") return "visible";
  return document.visibilityState === "hidden" ? "hidden" : "visible";
}

export function applyMotionRootAttributes(
  requestedMode: MotionMode,
  effectiveMode: MotionMode,
  windowState: MotionWindowState
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.motionRequested = requestedMode;
  root.dataset.motion = effectiveMode;
  root.dataset.windowState = windowState;
}

/** Establish deterministic attributes before React and the native settings load. */
export function initializeMotionRoot(mode: MotionMode = readBootstrapMotionMode()): void {
  const systemReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  applyMotionRootAttributes(
    mode,
    resolveEffectiveMotionMode(mode, systemReducedMotion),
    currentDocumentWindowState()
  );
}

export function motionModeAllowsTransform(mode: MotionMode): boolean {
  return mode === "full" || mode === "standard";
}

export function motionModeAllowsLayout(mode: MotionMode): boolean {
  return mode === "full" || mode === "standard";
}

export function motionModeAllowsContinuousMotion(mode: MotionMode): boolean {
  return mode === "full";
}

export function motionModeAllowsAnimation(mode: MotionMode): boolean {
  return mode !== "off";
}
