import React, { useEffect, useState, type ComponentType } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import type { AppSettings } from "../types";
import { installFrontendErrorReporting } from "../bootstrap/frontendErrorReporting";
import { DEFAULT_BUBBLE_SETTINGS, hasTauriBridge, loadBubbleSettings } from "./appearance";
import { readBootstrapMotionMode } from "../motion/policy";
import "./bubbleWindow.css";

type BubbleComponent = ComponentType<{ settings: AppSettings | null }>;

function BubbleWindow({ Bubble }: { Bubble: BubbleComponent }) {
  const [settings, setSettings] = useState<AppSettings>(() => ({
    ...DEFAULT_BUBBLE_SETTINGS,
    motionMode: readBootstrapMotionMode()
  }));

  useEffect(() => {
    let disposed = false;
    const disposers: Array<() => void> = [];

    void loadBubbleSettings()
      .then((nextSettings) => {
        if (!disposed) setSettings(nextSettings);
      })
      .catch((error) => console.error("Failed to load floating window settings", error));

    if (hasTauriBridge()) {
      void Promise.all([
        listen<AppSettings>("orbit://bubble-settings-changed", (event) => setSettings(event.payload)),
        listen<AppSettings>("orbit://settings-updated", (event) => setSettings(event.payload))
      ])
        .then((nextDisposers) => {
          if (disposed) {
            nextDisposers.forEach((dispose) => dispose());
          } else {
            disposers.push(...nextDisposers);
          }
        })
        .catch((error) => console.error("Failed to listen for floating window settings", error));
    }

    return () => {
      disposed = true;
      disposers.splice(0).forEach((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    document.body.classList.add("bubble-body");
    document.documentElement.classList.add("bubble-html");
    return () => {
      document.body.classList.remove("bubble-body");
      document.documentElement.classList.remove("bubble-html");
    };
  }, []);

  return <Bubble settings={settings} />;
}

export function mountBubbleWindow(Bubble: BubbleComponent) {
  installFrontendErrorReporting();
  const root = document.getElementById("root");
  if (!root) throw new Error("OrbitStart floating window root is missing");

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <BubbleWindow Bubble={Bubble} />
    </React.StrictMode>
  );
}
