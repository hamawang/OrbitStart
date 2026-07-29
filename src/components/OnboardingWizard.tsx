import { useState, useCallback, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, m, useIsPresent, type Transition, type Variants } from "motion/react";
import {
  Sparkles,
  ScanSearch,
  Bookmark,
  CheckCircle2,
  ChevronRight,
  ArrowRight,
  Zap,
  SkipForward
} from "lucide-react";
import {
  SCENARIO_TEMPLATES,
  type OnboardingState,
  type ScenarioTag,
  type ScenarioGroup,
  DEFAULT_ONBOARDING_STATE,
  completeOnboarding,
  skipOnboarding,
  selectTemplate,
  markShortcutScanDone,
  markBookmarkScanDone,
  areBothScansDone,
  loadOnboardingState
} from "../lib/onboarding";
import { useMotionPolicy, useMotionTransition } from "../motion";
import "./OnboardingWizard.motion.css";

const ONBOARDING_STEP_TITLE_ID = "onboarding-step-title";
const ONBOARDING_STEP_DESCRIPTION_ID = "onboarding-step-description";

interface OnboardingWizardProps {
  /** Called when user selects a template and tags are created. Receives the new tags and groups. */
  onTemplateSelected: (tags: ScenarioTag[], groups: ScenarioGroup[]) => void;
  /** Called when user clicks "scan shortcuts" button. */
  onScanShortcuts: () => void | Promise<void>;
  /** Called when user clicks "scan bookmarks" button. */
  onScanBookmarks: () => void | Promise<void>;
  /** Called when onboarding is fully completed or skipped. */
  onComplete: () => void;
  /** Whether the wizard is visible or hidden (e.g. during manual import filtering) */
  visible?: boolean;
}

function OnboardingStepPanel({
  className,
  panel,
  variants,
  motionDisabled,
  children
}: {
  className: string;
  panel: "template-select" | "tags-created";
  variants: Variants;
  motionDisabled: boolean;
  children: ReactNode;
}) {
  const isPresent = useIsPresent();
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (isPresent) panel.removeAttribute("inert");
    else panel.setAttribute("inert", "");
  }, [isPresent]);

  return (
    <m.div
      ref={panelRef}
      className={className}
      data-onboarding-step-panel={panel}
      data-presence={isPresent ? "present" : "exiting"}
      variants={variants}
      initial={motionDisabled ? false : "initial"}
      animate="enter"
      exit="exit"
      aria-hidden={!isPresent}
      style={{ pointerEvents: isPresent ? "auto" : "none" }}
    >
      {children}
    </m.div>
  );
}

/**
 * OnboardingWizard — Multi-step first-launch wizard.
 *
 * Step flow:
 *   template-select → [user picks scenario] → tags-created → [scans] → done
 *
 * The wizard renders as a full-screen overlay with backdrop.
 * A "skip" button is always available in the top-right.
 */
export function OnboardingWizard({
  onTemplateSelected,
  onScanShortcuts,
  onScanBookmarks,
  onComplete,
  visible = true
}: OnboardingWizardProps) {
  const [state, setState] = useState<OnboardingState>(() => loadOnboardingState() ?? DEFAULT_ONBOARDING_STATE);
  const completionRequestedRef = useRef(false);
  const templateSelectionRequestedRef = useRef(false);
  const motionPolicy = useMotionPolicy();
  const baseTransition = useMotionTransition("base");
  const fastTransition = useMotionTransition("fast");
  const sharedExitTransition = useMotionTransition("stepExit");
  const motionDisabled = !motionPolicy.animationsEnabled;
  const transformEnabled = motionPolicy.transformsEnabled;
  const enterTransition: Transition = motionDisabled
    ? { duration: 0 }
    : motionPolicy.effectiveMode === "minimal"
      ? fastTransition
      : baseTransition;
  const actionTransition: Transition = motionDisabled ? { duration: 0 } : fastTransition;
  const exitTransition: Transition = motionDisabled ? { duration: 0 } : sharedExitTransition;
  const progressTransition: Transition = motionPolicy.layoutAnimationsEnabled
    ? enterTransition
    : { duration: 0 };
  const stepVariants: Variants = {
    initial: {
      opacity: motionDisabled ? 1 : 0,
      y: transformEnabled ? 6 : 0
    },
    enter: {
      opacity: 1,
      y: 0,
      transition: enterTransition
    },
    exit: {
      opacity: motionDisabled ? 1 : 0,
      y: transformEnabled ? -4 : 0,
      transition: exitTransition
    }
  };
  const actionVariants: Variants = {
    initial: { opacity: motionDisabled ? 1 : 0 },
    enter: { opacity: 1, transition: actionTransition },
    exit: { opacity: motionDisabled ? 1 : 0, transition: exitTransition }
  };

  /** Handle template card selection */
  const handleSelectTemplate = useCallback((templateId: string) => {
    if (templateSelectionRequestedRef.current) return;
    templateSelectionRequestedRef.current = true;
    const result = selectTemplate(templateId);
    setState(result);
    onTemplateSelected(result.newTags, result.newGroups);
  }, [onTemplateSelected]);

  /** Handle skip */
  const handleSkip = useCallback(() => {
    if (completionRequestedRef.current) return;
    completionRequestedRef.current = true;
    skipOnboarding();
    onComplete();
  }, [onComplete]);

  /** Handle scan shortcuts click */
  const handleScanShortcuts = useCallback(async () => {
    await onScanShortcuts();
    const updated = markShortcutScanDone();
    setState(updated);
  }, [onScanShortcuts]);

  /** Handle scan bookmarks click */
  const handleScanBookmarks = useCallback(async () => {
    await onScanBookmarks();
    const updated = markBookmarkScanDone();
    setState(updated);
  }, [onScanBookmarks]);

  /** Handle finish (both scans done) */
  const handleFinish = useCallback(() => {
    if (completionRequestedRef.current) return;
    completionRequestedRef.current = true;
    completeOnboarding();
    onComplete();
  }, [onComplete]);

  // ---- Render helpers ----

  const step = state.step;
  const bothDone = areBothScansDone(state);

  return (
    <section
      className="onboarding-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={ONBOARDING_STEP_TITLE_ID}
      aria-describedby={ONBOARDING_STEP_DESCRIPTION_ID}
      aria-hidden={visible === false}
      data-onboarding-step={step}
      data-onboarding-visible={visible === false ? "false" : "true"}
      style={{ display: visible === false ? "none" : "flex" }}
    >
      <div className="onboarding-wizard" data-motion-mode={motionPolicy.effectiveMode}>
        {/* Header — always visible */}
        <div className="onboarding-header">
          <div className="onboarding-brand">
            <Sparkles size={22} aria-hidden="true" />
            <span>欢迎使用 OrbitStart</span>
          </div>
          <button
            type="button"
            className="onboarding-skip"
            onClick={handleSkip}
            data-onboarding-action="skip"
          >
            <SkipForward size={15} aria-hidden="true" />
            跳过引导
          </button>
        </div>

        {/* Progress dots */}
        <div
          className="onboarding-progress"
          role="progressbar"
          aria-label="首次使用引导进度"
          aria-valuemin={1}
          aria-valuemax={2}
          aria-valuenow={step === "template-select" ? 1 : 2}
        >
          <m.span
            className={step === "template-select" ? "active" : state.selectedTemplateId ? "done" : ""}
            data-progress-step="template-select"
            data-progress-state={step === "template-select" ? "active" : state.selectedTemplateId ? "done" : "pending"}
            animate={{ scaleX: step === "template-select" ? 1 : 0.7 }}
            transition={progressTransition}
            aria-hidden="true"
          />
          <m.span
            className={(step === "tags-created" || bothDone) && state.selectedTemplateId ? "active" : state.selectedTemplateId ? "done" : ""}
            data-progress-step="tags-created"
            data-progress-state={(step === "tags-created" || bothDone) && state.selectedTemplateId ? "active" : state.selectedTemplateId ? "done" : "pending"}
            animate={{
              scaleX:
                (step === "tags-created" || bothDone) &&
                state.selectedTemplateId
                  ? 1
                  : 0.7
            }}
            transition={progressTransition}
            aria-hidden="true"
          />
        </div>

        <AnimatePresence initial={false} mode="wait">
          {step === "template-select" ? (
            <OnboardingStepPanel
              key="template-select"
              className="onboarding-step step-template-select"
              panel="template-select"
              variants={stepVariants}
              motionDisabled={motionDisabled}
            >
              <h2 id={ONBOARDING_STEP_TITLE_ID}>选择一个资源导航模板</h2>
              <p id={ONBOARDING_STEP_DESCRIPTION_ID}>第一次打开 OrbitStart 时，先建立一组适合你的资源目录。模板会在左侧资源导航中创建目录，并放入少量示例资源。</p>

              <div className="template-grid">
                {SCENARIO_TEMPLATES.map((tpl) => (
                  <button
                    type="button"
                    key={tpl.id}
                    className="template-card"
                    onClick={() => handleSelectTemplate(tpl.id)}
                    style={{
                      borderColor: `${tpl.accent}33`,
                      "--onboarding-template-border": `${tpl.accent}66`
                    } as CSSProperties}
                    data-template-id={tpl.id}
                  >
                    <span className="template-icon" style={{ color: tpl.accent }} aria-hidden="true">
                      {/* Simple emoji/icon placeholder per category — using first letter + icon */}
                      {tpl.id === "student" && "🎓"}
                      {tpl.id === "editor" && "🎬"}
                      {tpl.id === "developer" && "💻"}
                      {tpl.id === "researcher" && "🔬"}
                      {tpl.id === "data-analyst" && "📊"}
                      {tpl.id === "general" && "✨"}
                    </span>
                    <div className="template-info">
                      <strong>{tpl.title}</strong>
                      <small>{tpl.subtitle}</small>
                    </div>
                    <span className="template-arrow" aria-hidden="true"><ChevronRight size={16} /></span>
                  </button>
                ))}
              </div>

              <p className="onboarding-hint">不知道选哪个？「我只是想整理电脑」适合大多数人</p>
            </OnboardingStepPanel>
          ) : (
            <OnboardingStepPanel
              key="tags-created"
              className="onboarding-step step-tags-created"
              panel="tags-created"
              variants={stepVariants}
              motionDisabled={motionDisabled}
            >
              <div className="success-badge" role="status">
                <CheckCircle2 size={20} aria-hidden="true" />
                <span>资源目录已创建</span>
              </div>

              <h2 id={ONBOARDING_STEP_TITLE_ID}>接下来，把真实资源放入目录</h2>
              <p id={ONBOARDING_STEP_DESCRIPTION_ID}>扫描本地程序和浏览器书签后，资源会先进入对应的应用、网站或未分类目录；你可以稍后在资源导航中拖拽整理。</p>

              <div className="scan-steps">
                <button
                  type="button"
                  className={`scan-btn ${state.shortcutScanDone ? "done" : ""}`}
                  onClick={handleScanShortcuts}
                  disabled={state.shortcutScanDone}
                  data-scan-kind="shortcuts"
                  data-scan-state={state.shortcutScanDone ? "done" : "idle"}
                >
                  <span className="scan-icon-wrap" aria-hidden="true">
                    <ScanSearch size={22} />
                  </span>
                  <div className="scan-info">
                    <strong aria-live="polite">{state.shortcutScanDone ? "已完成扫描" : "开始扫描本地程序"}</strong>
                    <small>从桌面和开始菜单导入快捷方式</small>
                  </div>
                  {state.shortcutScanDone && (
                    <span className="check-icon-motion" data-scan-check="shortcuts" aria-hidden="true">
                      <CheckCircle2 className="check-icon" size={18} />
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  className={`scan-btn ${state.bookmarkScanDone ? "done" : ""}`}
                  onClick={handleScanBookmarks}
                  disabled={state.bookmarkScanDone}
                  data-scan-kind="bookmarks"
                  data-scan-state={state.bookmarkScanDone ? "done" : "idle"}
                >
                  <span className="scan-icon-wrap" aria-hidden="true">
                    <Bookmark size={22} />
                  </span>
                  <div className="scan-info">
                    <strong aria-live="polite">{state.bookmarkScanDone ? "已完成扫描" : "开始扫描浏览器书签"}</strong>
                    <small>从 Edge / Chrome 导入书签</small>
                  </div>
                  {state.bookmarkScanDone && (
                    <span className="check-icon-motion" data-scan-check="bookmarks" aria-hidden="true">
                      <CheckCircle2 className="check-icon" size={18} />
                    </span>
                  )}
                </button>
              </div>

              <AnimatePresence initial={false} mode="wait">
                {bothDone ? (
                  <m.button
                    key="finish"
                    type="button"
                    className="primary-action finish-btn onboarding-action-swap"
                    onClick={handleFinish}
                    data-onboarding-action="finish"
                    variants={actionVariants}
                    initial={motionDisabled ? false : "initial"}
                    animate="enter"
                    exit="exit"
                  >
                    <Zap size={18} aria-hidden="true" />
                    开始使用 OrbitStart
                    <ArrowRight size={16} aria-hidden="true" />
                  </m.button>
                ) : (
                  <m.p
                    key="scan-hint"
                    className="onboarding-hint onboarding-action-swap"
                    variants={actionVariants}
                    initial={motionDisabled ? false : "initial"}
                    animate="enter"
                    exit="exit"
                  >
                    也可以先跳过扫描，进入资源中心后手动添加或拖拽资源。
                  </m.p>
                )}
              </AnimatePresence>
            </OnboardingStepPanel>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
