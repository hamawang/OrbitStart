import {
  LazyMotion,
  MotionConfig,
  type Transition
} from "motion/react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { MotionMode } from "../types";
import {
  applyMotionRootAttributes,
  currentDocumentWindowState,
  motionModeAllowsAnimation,
  motionModeAllowsContinuousMotion,
  motionModeAllowsLayout,
  motionModeAllowsTransform,
  normalizeMotionMode,
  persistBootstrapMotionMode,
  resolveEffectiveMotionMode,
  type MotionWindowState
} from "./policy";
import {
  createMotionTransition,
  type MotionTransitionName
} from "./transitions";

const loadMotionFeatures = () => import("./motionFeatures").then((module) => module.default);

export interface MotionPolicy {
  requestedMode: MotionMode;
  effectiveMode: MotionMode;
  systemReducedMotion: boolean;
  windowState: MotionWindowState;
  isPaused: boolean;
  animationsEnabled: boolean;
  transformsEnabled: boolean;
  layoutAnimationsEnabled: boolean;
  continuousMotionEnabled: boolean;
}

const defaultPolicy: MotionPolicy = {
  requestedMode: "standard",
  effectiveMode: "standard",
  systemReducedMotion: false,
  windowState: "visible",
  isPaused: false,
  animationsEnabled: true,
  transformsEnabled: true,
  layoutAnimationsEnabled: true,
  continuousMotionEnabled: false
};

const MotionPolicyContext = createContext<MotionPolicy>(defaultPolicy);

function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

function useMotionWindowState(): MotionWindowState {
  const [documentState, setDocumentState] = useState<MotionWindowState>(currentDocumentWindowState);
  const [browserWindowFocused, setBrowserWindowFocused] = useState(() =>
    typeof document === "undefined" ? true : document.hasFocus()
  );
  const [nativeWindowVisible, setNativeWindowVisible] = useState(true);
  const [nativeWindowFocused, setNativeWindowFocused] = useState(true);

  useEffect(() => {
    const update = () => setDocumentState(currentDocumentWindowState());
    document.addEventListener("visibilitychange", update);
    update();
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const handleFocus = () => setBrowserWindowFocused(true);
    const handleBlur = () => setBrowserWindowFocused(false);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    setBrowserWindowFocused(document.hasFocus());
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;

    let disposed = false;
    const disposers: Array<() => void> = [];

    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        const update = async () => {
          try {
            const [visible, minimized, focused] = await Promise.all([
              appWindow.isVisible(),
              appWindow.isMinimized(),
              appWindow.isFocused()
            ]);
            if (!disposed) {
              setNativeWindowVisible(visible && !minimized);
              setNativeWindowFocused(focused);
            }
          } catch {
            // Page visibility remains the safe fallback in browser previews and
            // on platforms that cannot report a transient native window state.
          }
        };

        await update();
        const [unlistenFocus, unlistenResize] = await Promise.all([
          appWindow.onFocusChanged((event) => {
            if (!disposed) setNativeWindowFocused(event.payload);
            void update();
          }),
          appWindow.onResized(() => void update())
        ]);

        if (disposed) {
          unlistenFocus();
          unlistenResize();
        } else {
          disposers.push(unlistenFocus, unlistenResize);
        }
      })
      .catch(() => {
        // The Web build does not expose a Tauri window. No native listener is
        // needed there.
      });

    return () => {
      disposed = true;
      disposers.splice(0).forEach((dispose) => dispose());
    };
  }, []);

  return documentState === "visible" &&
    browserWindowFocused &&
    nativeWindowVisible &&
    nativeWindowFocused
    ? "visible"
    : "hidden";
}

export interface MotionProviderProps {
  children: ReactNode;
  mode?: MotionMode | string | null;
}

export function MotionProvider({ children, mode }: MotionProviderProps) {
  const requestedMode = normalizeMotionMode(mode);
  const systemReducedMotion = useSystemReducedMotion();
  const windowState = useMotionWindowState();
  const effectiveMode = resolveEffectiveMotionMode(requestedMode, systemReducedMotion);

  const policy = useMemo<MotionPolicy>(() => {
    const isPaused = windowState === "hidden";
    return {
      requestedMode,
      effectiveMode,
      systemReducedMotion,
      windowState,
      isPaused,
      animationsEnabled: motionModeAllowsAnimation(effectiveMode) && !isPaused,
      transformsEnabled: motionModeAllowsTransform(effectiveMode) && !isPaused,
      layoutAnimationsEnabled: motionModeAllowsLayout(effectiveMode) && !isPaused,
      continuousMotionEnabled:
        motionModeAllowsContinuousMotion(effectiveMode) && !isPaused
    };
  }, [effectiveMode, requestedMode, systemReducedMotion, windowState]);

  useEffect(() => {
    persistBootstrapMotionMode(requestedMode);
    applyMotionRootAttributes(requestedMode, effectiveMode, windowState);
  }, [effectiveMode, requestedMode, windowState]);

  const defaultTransition = useMemo<Transition>(
    () => createMotionTransition("base", policy.isPaused ? "off" : effectiveMode),
    [effectiveMode, policy.isPaused]
  );

  return (
    <MotionPolicyContext.Provider value={policy}>
      <LazyMotion features={loadMotionFeatures} strict>
        <MotionConfig
          reducedMotion={effectiveMode === "minimal" || effectiveMode === "off" ? "always" : "user"}
          transition={defaultTransition}
        >
          {children}
        </MotionConfig>
      </LazyMotion>
    </MotionPolicyContext.Provider>
  );
}

export function useMotionPolicy(): MotionPolicy {
  return useContext(MotionPolicyContext);
}

export function useEffectiveMotionMode(): MotionMode {
  return useMotionPolicy().effectiveMode;
}

export function useMotionTransition(name: MotionTransitionName = "base"): Transition {
  const { effectiveMode, isPaused } = useMotionPolicy();
  const mode = isPaused ? "off" : effectiveMode;
  return useMemo(() => createMotionTransition(name, mode), [mode, name]);
}
