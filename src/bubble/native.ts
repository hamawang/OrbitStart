import { invoke } from "@tauri-apps/api/core";
import { hasTauriBridge } from "./appearance";

/**
 * Bubble windows must not import the broad main-window native facade: that
 * facade includes the browser catalogue fallback and would defeat entry-point
 * isolation. Keep this command bridge intentionally narrow.
 */
export async function exitFloatingModeAndShowMain(action?: string): Promise<void> {
  if (!hasTauriBridge()) return;
  await invoke<void>("exit_floating_mode_and_show_main", { action });
}
