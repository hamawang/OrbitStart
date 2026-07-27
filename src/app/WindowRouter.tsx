import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { loadWindowAppearance } from "../lib/native";
import type { AppSettings, ThemeManifest } from "../types";

const FloatingBubble = lazy(async () => {
  const module = await import("../components/FloatingBubble/FloatingBubble");
  return { default: module.FloatingBubble };
});

const FloatingBubbleMenu = lazy(async () => {
  const module = await import("../components/FloatingBubble/FloatingBubble");
  return { default: module.FloatingBubbleMenu };
});

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

function useBubbleWindowAppearance() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [themes, setThemes] = useState<ThemeManifest[]>([]);

  useEffect(() => {
    let disposed = false;
    const disposers: Array<() => void> = [];
    loadWindowAppearance()
      .then((appearance) => {
        setSettings(appearance.settings);
        setThemes(appearance.themes);
      })
      .catch(console.error);

    if (!hasTauriInternals()) return;
    void Promise.all([
      listen<AppSettings>("orbit://bubble-settings-changed", (event) => {
        setSettings(event.payload);
      }),
      listen<AppSettings>("orbit://settings-updated", (event) => {
        setSettings(event.payload);
      })
    ])
      .then((nextDisposers) => {
        if (disposed) {
          nextDisposers.forEach((dispose) => dispose());
        } else {
          disposers.push(...nextDisposers);
        }
      })
      .catch(console.error);

    return () => {
      disposed = true;
      disposers.splice(0).forEach((dispose) => dispose());
    };
  }, []);

  return [settings, themes] as const;
}

function BubbleWindowTheme({ children }: { children: (settings: AppSettings | null) => ReactNode }) {
  const [settings, themes] = useBubbleWindowAppearance();
  const activeTheme = useMemo(
    () => themes.find((theme) => theme.id === settings?.activeThemeId) ?? themes[0],
    [settings?.activeThemeId, themes]
  );

  useEffect(() => {
    document.body.classList.add("bubble-body");
    document.documentElement.classList.add("bubble-html");
    return () => {
      document.body.classList.remove("bubble-body");
      document.documentElement.classList.remove("bubble-html");
    };
  }, []);

  useEffect(() => {
    if (!activeTheme) return;
    const root = document.documentElement;
    root.dataset.theme = activeTheme.id;
    if (activeTheme.id.startsWith("atelier-")) {
      root.dataset.themeStyle = "atelier";
    } else {
      delete root.dataset.themeStyle;
    }
    Object.entries(activeTheme.tokens).forEach(([key, value]) => root.style.setProperty(key, value));
  }, [activeTheme]);

  return <>{children(settings)}</>;
}

function FloatingBubbleWindow() {
  return (
    <BubbleWindowTheme>
      {(settings) => (
        <Suspense fallback={null}>
          <FloatingBubble settings={settings} />
        </Suspense>
      )}
    </BubbleWindowTheme>
  );
}

function FloatingBubbleMenuWindow() {
  return (
    <BubbleWindowTheme>
      {(settings) => (
        <Suspense fallback={null}>
          <FloatingBubbleMenu settings={settings} />
        </Suspense>
      )}
    </BubbleWindowTheme>
  );
}

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
  if (windowLabel === "floating-bubble") return <FloatingBubbleWindow />;
  if (windowLabel === "floating-bubble-menu") return <FloatingBubbleMenuWindow />;
  return <>{renderMain(windowLabel)}</>;
}
