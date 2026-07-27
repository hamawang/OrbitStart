import { useEffect, useState, type ReactNode } from "react";

type TauriWindowMetadata = {
  metadata?: {
    currentWindow?: {
      label?: string;
    };
  };
};

function hasTauriInternals(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function getWindowLabelFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const label = params.get("label");
  if (label) return label;
  return params.get("panel") === "todo" ? "todo-panel" : null;
}

function getTauriWindowLabel(): string | null {
  if (typeof window === "undefined") return null;
  const internals = (window as Window & { __TAURI_INTERNALS__?: TauriWindowMetadata }).__TAURI_INTERNALS__;
  return internals?.metadata?.currentWindow?.label ?? null;
}

/** Routes only full-size application windows. Floating windows have dedicated HTML entries. */
export function WindowRouter({ renderMain }: { renderMain: (windowLabel: string) => ReactNode }) {
  const [windowLabel, setWindowLabel] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let attempts = 0;

    const check = () => {
      if (!active) return;
      if (hasTauriInternals()) {
        setWindowLabel(getWindowLabelFromUrl() || getTauriWindowLabel() || "main");
        return;
      }

      attempts += 1;
      if (attempts < 150) {
        setTimeout(check, 10);
      } else {
        setWindowLabel(getWindowLabelFromUrl() || "main");
      }
    };

    check();
    return () => {
      active = false;
    };
  }, []);

  if (windowLabel === null) return null;
  return <>{renderMain(windowLabel)}</>;
}
