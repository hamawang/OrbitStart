import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../types";

type TauriInternals = {
  invoke?: unknown;
};

type WindowAppearance = {
  settings: AppSettings;
};

export const DEFAULT_BUBBLE_SETTINGS: AppSettings = {
  activeThemeId: "local-galaxy",
  safeMode: false,
  density: "comfortable",
  globalHotkey: "Ctrl+Alt+Space",
  closeBehavior: "tray",
  dataDir: "local-preview",
  autoPinnedMode: false,
  displayMode: "simple",
  resourceMode: "single",
  workbenchVisible: true,
  workbenchShowStatus: true,
  workbenchShowWorkspaces: true,
  workbenchShowActions: true,
  hotkeyBehavior: "command_bar",
  bubbleEnabled: false,
  bubbleShowWhenMainHidden: true,
  bubbleAlwaysOnTop: true,
  bubbleSize: 64,
  bubbleOpacity: 1,
  bubbleSnapToEdge: true,
  bubbleExpandOnHover: true,
  bubbleExpandDelayMs: 200,
  bubbleAvoidFullscreen: false
};

export function hasTauriBridge(): boolean {
  if (typeof window === "undefined") return false;
  const internals = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function";
}

function browserBubbleSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem("orbitstart.browser.snapshot");
    if (!raw) return DEFAULT_BUBBLE_SETTINGS;
    const parsed = JSON.parse(raw) as { settings?: Partial<AppSettings> };
    return { ...DEFAULT_BUBBLE_SETTINGS, ...parsed.settings };
  } catch {
    return DEFAULT_BUBBLE_SETTINGS;
  }
}

/**
 * A deliberately small version of the window-appearance call. Importing the
 * main native facade would pull the catalogue/browser fallback into bubble
 * windows even though they only need the floating-window settings.
 */
export async function loadBubbleSettings(): Promise<AppSettings> {
  if (!hasTauriBridge()) return browserBubbleSettings();
  const appearance = await invoke<WindowAppearance>("window_appearance");
  return appearance.settings;
}
