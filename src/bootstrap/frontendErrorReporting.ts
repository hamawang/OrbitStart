import { invoke } from "@tauri-apps/api/core";
import { hasTauriBridge } from "../bubble/appearance";

let installed = false;

function report(message: string) {
  console.error(message);
  if (!hasTauriBridge()) return;
  void invoke("log_frontend_error", { message }).catch(() => undefined);
}

/** Installs one error reporter for each independently bootstrapped WebView. */
export function installFrontendErrorReporting() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    report(`JS Error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    report(`Unhandled Rejection: ${String(event.reason)}`);
  });
}
