import { expect, test, type Locator, type Page } from "@playwright/test";

type MotionMode = "full" | "standard" | "minimal" | "off";

test.use({
  storageState: {
    cookies: [],
    origins: [
      {
        origin: "http://127.0.0.1:1422",
        localStorage: [
          {
            name: "orbitstart_onboarding_v1",
            value: JSON.stringify({ completed: true })
          }
        ]
      }
    ]
  }
});

async function seedMotionMode(page: Page, motionMode: MotionMode) {
  await page.addInitScript((mode) => {
    if (!window.localStorage.getItem("orbitstart.browser.snapshot")) {
      window.localStorage.setItem(
        "orbitstart.browser.snapshot",
        JSON.stringify({ settings: { motionMode: mode } })
      );
    }
  }, motionMode);
}

async function seedMotionItems(page: Page, items: Array<Record<string, unknown>>) {
  await page.addInitScript((seededItems) => {
    window.localStorage.setItem("orbitstart.browser.items", JSON.stringify(seededItems));
  }, items);
}

async function waitForMainWindow(page: Page) {
  await page.goto("/");
  await page.locator(".app-shell").waitFor({ state: "visible" });
}

async function dragBetween(page: Page, source: Locator, target: Locator) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const sourcePoint = {
    x: sourceBox!.x + sourceBox!.width / 2,
    y: sourceBox!.y + Math.min(sourceBox!.height / 2, 42)
  };
  const targetPoint = {
    x: targetBox!.x + targetBox!.width / 2,
    y: targetBox!.y + Math.min(targetBox!.height / 2, 64)
  };

  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.down();
  await page.mouse.move(sourcePoint.x + 12, sourcePoint.y + 2, { steps: 4 });
  await expect(source).toHaveClass(/placeholder/);
  await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 16 });
}

test.describe("OrbitStart motion policy and interaction feedback", () => {
  test("persists the requested mode and applies effective root attributes", async ({ page }) => {
    await seedMotionMode(page, "standard");
    await waitForMainWindow(page);

    await expect(page.locator("html")).toHaveAttribute("data-motion-requested", "standard");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "standard");
    await expect(page.locator("html")).toHaveAttribute("data-window-state", "visible");

    await page.locator(".sidebar-cosmic-settings-btn").click();
    const select = page.getByTestId("motion-mode-select");
    await expect(select).toBeVisible();

    await select.selectOption("full");
    await expect(page.locator("html")).toHaveAttribute("data-motion-requested", "full");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = window.localStorage.getItem("orbitstart.browser.snapshot");
          return raw ? JSON.parse(raw).settings?.motionMode : null;
        })
      )
      .toBe("full");

    await select.selectOption("off");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
    const transitionDurations = await page
      .locator(".settings-modal-panel button")
      .first()
      .evaluate((button) => getComputedStyle(button).transitionDuration);
    expect(transitionDurations.split(",").every((duration) => duration.trim() === "0.001s")).toBe(true);

    await page.addInitScript(() => {
      const samples: string[] = [];
      const record = () => {
        const mode = document.documentElement.dataset.motion;
        if (mode) samples.push(mode);
      };
      const observer = new MutationObserver(record);
      const observeRoot = () => {
        if (!document.documentElement) return false;
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-motion"]
        });
        record();
        return true;
      };
      const rootObserver = new MutationObserver(() => {
        if (observeRoot()) rootObserver.disconnect();
      });
      if (!observeRoot()) {
        rootObserver.observe(document, { childList: true, subtree: true });
      }
      (
        window as typeof window & {
          __restartMotionAudit?: {
            observer: MutationObserver;
            rootObserver: MutationObserver;
            samples: string[];
          };
        }
      ).__restartMotionAudit = { observer, rootObserver, samples };
    });
    await page.reload();
    await page.locator(".app-shell").waitFor({ state: "visible" });
    const restartModes = await page.evaluate(() => {
      const audit = (
        window as typeof window & {
          __restartMotionAudit?: {
            observer: MutationObserver;
            rootObserver: MutationObserver;
            samples: string[];
          };
        }
      ).__restartMotionAudit;
      if (!audit) throw new Error("Restart motion audit was not installed");
      audit.observer.disconnect();
      audit.rootObserver.disconnect();
      return audit.samples;
    });
    expect(restartModes[0]).toBe("off");
    expect(restartModes).not.toContain("standard");
  });

  test("caps full motion at minimal when the operating system requests reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedMotionMode(page, "full");
    await page.addInitScript(() => {
      const samples: string[] = [];
      const record = () => {
        const value = document.documentElement.dataset.motion;
        if (value) samples.push(value);
      };
      const observer = new MutationObserver(record);
      const observeRoot = () => {
        if (!document.documentElement) return false;
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-motion"]
        });
        record();
        return true;
      };
      const rootObserver = new MutationObserver(() => {
        if (observeRoot()) rootObserver.disconnect();
      });
      if (!observeRoot()) {
        rootObserver.observe(document, { childList: true, subtree: true });
      }
      (
        window as typeof window & {
          __initialMotionModeAudit?: {
            observer: MutationObserver;
            rootObserver: MutationObserver;
            samples: string[];
          };
        }
      ).__initialMotionModeAudit = { observer, rootObserver, samples };
    });
    await waitForMainWindow(page);

    await expect(page.locator("html")).toHaveAttribute("data-motion-requested", "full");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "minimal");
    const initialMotionModes = await page.evaluate(() => {
      const audit = (
        window as typeof window & {
          __initialMotionModeAudit?: {
            observer: MutationObserver;
            rootObserver: MutationObserver;
            samples: string[];
          };
        }
      ).__initialMotionModeAudit;
      if (!audit) throw new Error("Initial motion-mode audit was not installed");
      audit.observer.disconnect();
      audit.rootObserver.disconnect();
      return audit.samples;
    });
    expect(initialMotionModes[0]).toBe("minimal");
    expect(initialMotionModes).not.toContain("standard");

    await page.evaluate(() => {
      type TransformSample = {
        scaleX: number;
        scaleY: number;
        translateX: number;
        translateY: number;
      };
      const samples: TransformSample[] = [];
      const samplePages = () => {
        document.querySelectorAll<HTMLElement>("[data-motion-page]").forEach((element) => {
          const transform = getComputedStyle(element).transform;
          const matrix =
            transform === "none"
              ? new DOMMatrixReadOnly()
              : new DOMMatrixReadOnly(transform);
          samples.push({
            scaleX: matrix.a,
            scaleY: matrix.d,
            translateX: matrix.m41,
            translateY: matrix.m42
          });
        });
      };
      const observer = new MutationObserver(samplePages);
      const stack = document.querySelector(".motion-page-stack");
      if (!stack) throw new Error("Motion page stack not found");
      observer.observe(stack, {
        attributes: true,
        attributeFilter: ["style"],
        childList: true,
        subtree: true
      });
      samplePages();
      (
        window as typeof window & {
          __reducedPageMotionAudit?: {
            observer: MutationObserver;
            samples: TransformSample[];
          };
        }
      ).__reducedPageMotionAudit = { observer, samples };
    });

    const railButtons = page.locator(".rail > .rail-button");
    const railCount = await railButtons.count();
    await railButtons.nth(railCount - 2).click();
    await expect(page.locator('[data-motion-page="logs"]')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __reducedPageMotionAudit?: { samples: unknown[] };
              }
            ).__reducedPageMotionAudit?.samples.length ?? 0
        )
      )
      .toBeGreaterThan(1);

    const transformSamples = await page.evaluate(() => {
      const audit = (
        window as typeof window & {
          __reducedPageMotionAudit?: {
            observer: MutationObserver;
            samples: Array<{
              scaleX: number;
              scaleY: number;
              translateX: number;
              translateY: number;
            }>;
          };
        }
      ).__reducedPageMotionAudit;
      if (!audit) throw new Error("Reduced-motion audit was not installed");
      audit.observer.disconnect();
      return audit.samples;
    });
    expect(transformSamples.length).toBeGreaterThan(1);
    expect(
      transformSamples.every(
        ({ scaleX, scaleY, translateX, translateY }) =>
          Math.abs(scaleX - 1) < 0.001 &&
          Math.abs(scaleY - 1) < 0.001 &&
          Math.abs(translateX) < 0.001 &&
          Math.abs(translateY) < 0.001
      )
    ).toBe(true);
  });

  test("mounts one tooltip on demand, opens focus immediately, and unmounts after exit", async ({ page }) => {
    await seedMotionMode(page, "standard");
    await waitForMainWindow(page);

    const tooltips = page.locator('[role="tooltip"]');
    const openTooltips = page.locator('[role="tooltip"][data-state="open"]');
    const settingsButton = page.locator(".sidebar-cosmic-settings-btn");
    const themeButton = page.getByRole("button", { name: "主题工作室" });

    await expect(tooltips).toHaveCount(0);
    await settingsButton.focus();
    await expect(openTooltips).toHaveCount(1);
    await expect(openTooltips).toHaveText("系统设置");

    await themeButton.focus();
    await expect(openTooltips).toHaveCount(1);
    await expect(openTooltips).toHaveText("主题工作室");
    await expect(tooltips).toHaveCount(1);

    await themeButton.blur();
    await expect(tooltips).toHaveCount(0);

    await themeButton.hover();
    await page.waitForTimeout(120);
    await expect(openTooltips).toHaveCount(0);
    await expect(openTooltips).toHaveCount(1, { timeout: 500 });
    await page.mouse.move(0, 0);
    await expect(tooltips).toHaveCount(0);
  });

  test("keeps the 240ms hover intent delay in minimal mode and removes displacement", async ({ page }) => {
    await seedMotionMode(page, "minimal");
    await waitForMainWindow(page);

    const settingsButton = page.locator(".sidebar-cosmic-settings-btn");
    const openTooltip = page.locator('[role="tooltip"][data-state="open"]');
    await settingsButton.hover();
    await page.waitForTimeout(160);
    await expect(openTooltip).toHaveCount(0);
    await expect(openTooltip).toHaveCount(1, { timeout: 400 });
    await expect(openTooltip).toHaveText("系统设置");
    const minimalTransform = await openTooltip.evaluate((tooltip) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(tooltip).transform);
      const placement = tooltip.getAttribute("data-placement");
      return {
        placement,
        translateX: matrix.m41,
        translateY: matrix.m42,
        width: (tooltip as HTMLElement).offsetWidth,
        height: (tooltip as HTMLElement).offsetHeight
      };
    });
    expect(Math.abs(minimalTransform.translateX + minimalTransform.width / 2)).toBeLessThan(0.75);
    expect(
      Math.abs(
        minimalTransform.translateY +
          (minimalTransform.placement === "top" ? minimalTransform.height : 0)
      )
    ).toBeLessThan(0.75);

    await page.mouse.move(page.viewportSize()!.width / 2, page.viewportSize()!.height / 2);
    await expect(page.locator('[role="tooltip"]')).toHaveCount(0);
    await settingsButton.evaluate((button) => {
      const element = button as HTMLElement;
      element.style.position = "fixed";
      element.style.left = "0";
      element.style.top = "0";
      element.style.zIndex = "30000";
    });
    await settingsButton.focus();
    await expect(openTooltip).toHaveAttribute("data-placement", "bottom");
    const tooltipBounds = await openTooltip.boundingBox();
    expect(tooltipBounds).not.toBeNull();
    expect(tooltipBounds!.x).toBeGreaterThanOrEqual(0);
    expect(tooltipBounds!.y).toBeGreaterThanOrEqual(0);
    expect(tooltipBounds!.x + tooltipBounds!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width
    );
  });

  test("keeps the shell stable while page content and command surfaces change", async ({ page }) => {
    await seedMotionMode(page, "standard");
    await waitForMainWindow(page);

    await expect(page.locator('[data-motion-page="dashboard"]')).toBeVisible();
    const railButtons = page.locator(".rail > .rail-button");
    const railCount = await railButtons.count();
    expect(railCount).toBeGreaterThanOrEqual(2);
    await railButtons.nth(railCount - 2).click();
    await expect(page.locator('[data-motion-page="logs"]')).toBeVisible();
    await expect(page.locator(".sidebar")).toBeVisible();

    await page.keyboard.press("Control+K");
    const paletteLayer = page.locator(".motion-presence-layer", {
      has: page.locator(".command-palette")
    });
    await expect(paletteLayer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(paletteLayer).toHaveCount(0);
  });

  test("keeps a closing overlay mounted and inert through its exit phase", async ({ page }) => {
    await seedMotionMode(page, "standard");
    await waitForMainWindow(page);

    await page.keyboard.press("Control+K");
    const paletteLayer = page.locator(".motion-presence-layer", {
      has: page.locator(".command-palette")
    });
    await expect(paletteLayer).toHaveAttribute("data-presence", "present");

    await page.evaluate(() => {
      const layer = document.querySelector<HTMLElement>(".motion-presence-layer:has(.command-palette)");
      if (!layer) throw new Error("Command palette presence layer not found");

      type PresenceSample = {
        connected: boolean;
        inert: boolean;
        pointerEvents: string;
        presence: string | null;
        time: number;
      };
      const samples: PresenceSample[] = [];
      const sample = () => {
        samples.push({
          connected: layer.isConnected,
          inert: layer.hasAttribute("inert"),
          pointerEvents: layer.isConnected ? getComputedStyle(layer).pointerEvents : "",
          presence: layer.getAttribute("data-presence"),
          time: performance.now()
        });
      };
      const observer = new MutationObserver(sample);
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["data-presence", "inert", "style"],
        childList: true,
        subtree: true
      });
      sample();
      (
        window as typeof window & {
          __motionPresenceAudit?: { observer: MutationObserver; samples: PresenceSample[] };
        }
      ).__motionPresenceAudit = { observer, samples };
    });

    await page.keyboard.press("Escape");
    await expect(paletteLayer).toHaveCount(0);

    const samples = await page.evaluate(() => {
      const audit = (
        window as typeof window & {
          __motionPresenceAudit?: {
            observer: MutationObserver;
            samples: Array<{
              connected: boolean;
              inert: boolean;
              pointerEvents: string;
              presence: string | null;
              time: number;
            }>;
          };
        }
      ).__motionPresenceAudit;
      if (!audit) throw new Error("Presence audit was not installed");
      audit.observer.disconnect();
      return audit.samples;
    });

    const exitingIndex = samples.findIndex(
      (sample) => sample.connected && sample.presence === "exiting"
    );
    const removedIndex = samples.findIndex(
      (sample, index) => index > exitingIndex && !sample.connected
    );
    expect(exitingIndex).toBeGreaterThanOrEqual(0);
    expect(removedIndex).toBeGreaterThan(exitingIndex);
    expect(samples[removedIndex].time).toBeGreaterThan(samples[exitingIndex].time);
    expect(
      samples
        .slice(exitingIndex, removedIndex)
        .some((sample) => sample.inert && sample.pointerEvents === "none")
    ).toBe(true);
  });

  test("does not leave an interactive backdrop after rapid open and close cycles", async ({ page }) => {
    await seedMotionMode(page, "standard");
    await waitForMainWindow(page);

    const paletteInput = page.locator(".command-palette .palette-input input");
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.keyboard.press("Control+K");
      await expect(paletteInput).toBeVisible();
      await page.keyboard.press("Escape");
    }

    await expect(page.locator(".motion-presence-layer", {
      has: page.locator(".command-palette")
    })).toHaveCount(0);
    await expect(page.locator(".palette-backdrop")).toHaveCount(0);
    await expect(page.locator('.motion-presence-layer[data-presence="exiting"]')).toHaveCount(0);

    const catalogueSearch = page.locator(".hero-strip .search-shell input");
    await catalogueSearch.click();
    await expect(catalogueSearch).toBeFocused();
  });

  test("keeps command-palette focus, selection and nearest scrolling in sync", async ({ page }) => {
    await seedMotionMode(page, "standard");
    await seedMotionItems(
      page,
      Array.from({ length: 24 }, (_, index) => ({
        id: `motion-palette-${index}`,
        title: `Motion Palette Item ${String(index).padStart(2, "0")}`,
        subtitle: "Keyboard navigation fixture",
        kind: "app",
        group: "apps",
        target: `C:\\Motion\\palette-${index}.exe`,
        aliases: [],
        tags: ["motion-palette"],
        subTag: "",
        icon: "AppWindow",
        accent: "#5cc8ff",
        favorite: false,
        launchCount: 0
      }))
    );
    await page.addInitScript(() => {
      type ScrollCall = {
        behavior?: ScrollBehavior;
        block?: ScrollLogicalPosition;
        index: string | null;
      };
      const calls: ScrollCall[] = [];
      const nativeScrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function scrollIntoView(
        options?: boolean | ScrollIntoViewOptions
      ) {
        const normalized = typeof options === "object" ? options : undefined;
        calls.push({
          behavior: normalized?.behavior,
          block: normalized?.block,
          index:
            this.getAttribute("data-palette-result-index") ??
            this.getAttribute("data-command-bar-result-index")
        });
        nativeScrollIntoView.call(this, options);
      };
      (
        window as typeof window & {
          __motionScrollIntoViewCalls?: ScrollCall[];
        }
      ).__motionScrollIntoViewCalls = calls;
    });
    await waitForMainWindow(page);

    await page.keyboard.press("Control+K");
    const paletteInput = page.locator(".command-palette .palette-input input");
    await expect(paletteInput).toBeFocused();
    await paletteInput.fill("Motion Palette Item");
    await expect(page.locator("[data-palette-result-index]")).toHaveCount(16);
    await page.evaluate(() => {
      const auditWindow = window as typeof window & {
        __motionScrollIntoViewCalls?: unknown[];
      };
      if (auditWindow.__motionScrollIntoViewCalls) {
        auditWindow.__motionScrollIntoViewCalls.length = 0;
      }
    });

    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press("ArrowDown");
    }

    const selectedResult = page.locator('[data-palette-result-index="12"]');
    await expect(selectedResult).toHaveClass(/result-selected/);
    await expect(page.locator(".palette-results .result-selected")).toHaveCount(1);
    await expect(paletteInput).toBeFocused();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const calls = (
            window as typeof window & {
              __motionScrollIntoViewCalls?: Array<{
                behavior?: ScrollBehavior;
                block?: ScrollLogicalPosition;
                index: string | null;
              }>;
            }
          ).__motionScrollIntoViewCalls;
          return Boolean(
            calls?.some(
              (call) =>
                call.index === "12" &&
                call.block === "nearest" &&
                call.behavior === "auto"
            )
          );
        })
      )
      .toBe(true);

    const selectedBounds = await selectedResult.evaluate((result) => {
      const container = result.parentElement;
      if (!container) throw new Error("Palette result container not found");
      const resultRect = result.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return {
        bottom: resultRect.bottom,
        containerBottom: containerRect.bottom,
        containerTop: containerRect.top,
        top: resultRect.top
      };
    });
    expect(selectedBounds.top).toBeGreaterThanOrEqual(selectedBounds.containerTop - 1);
    expect(selectedBounds.bottom).toBeLessThanOrEqual(selectedBounds.containerBottom + 1);
  });

  test("completes onboarding through state and presence events without a fixed wait", async ({ page }) => {
    await seedMotionMode(page, "standard");
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "orbitstart_onboarding_v1",
        JSON.stringify({
          step: "tags-created",
          selectedTemplateId: "general",
          shortcutScanDone: true,
          bookmarkScanDone: true,
          skipped: false,
          completed: false
        })
      );
    });
    await waitForMainWindow(page);

    const onboardingLayer = page.locator(".motion-presence-layer", {
      has: page.locator(".onboarding-backdrop")
    });
    const finishButton = page.locator('[data-onboarding-action="finish"]');
    await expect(onboardingLayer).toHaveAttribute("data-presence", "present");
    await expect(finishButton).toBeVisible();
    await finishButton.click();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = window.localStorage.getItem("orbitstart_onboarding_v1");
          return raw ? JSON.parse(raw).completed : false;
        })
      )
      .toBe(true);
    await expect(onboardingLayer).toHaveCount(0);
    await expect(page.locator(".app-shell")).toBeVisible();
  });

  test("moves onboarding from template selection to the created-tags step through presence state", async ({ page }) => {
    await seedMotionMode(page, "standard");
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "orbitstart_onboarding_v1",
        JSON.stringify({
          step: "template-select",
          selectedTemplateId: null,
          shortcutScanDone: false,
          bookmarkScanDone: false,
          skipped: false,
          completed: false
        })
      );
    });
    await waitForMainWindow(page);

    const templatePanel = page.locator(
      '[data-onboarding-step-panel="template-select"]'
    );
    const createdTagsPanel = page.locator(
      '[data-onboarding-step-panel="tags-created"]'
    );
    await expect(templatePanel).toBeVisible();
    await page.locator('[data-template-id="general"]').dblclick();

    await expect(templatePanel).toHaveCount(0);
    await expect(createdTagsPanel).toBeVisible();
    await expect(page.locator(".onboarding-backdrop")).toHaveAttribute(
      "data-onboarding-step",
      "tags-created"
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = window.localStorage.getItem("orbitstart_onboarding_v1");
          if (!raw) return null;
          const state = JSON.parse(raw) as {
            selectedTemplateId?: string;
            step?: string;
          };
          return `${state.step}:${state.selectedTemplateId}`;
        })
      )
      .toBe("tags-created:general");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const items = JSON.parse(
            window.localStorage.getItem("orbitstart.browser.items") ?? "[]"
          ) as Array<{ title?: string }>;
          return ["记事本", "文件资源管理器", "系统设置"].map(
            (title) => items.filter((item) => item.title === title).length
          );
        })
      )
      .toEqual([1, 1, 1]);
  });

  test("persists a resource drop without adding an outer-card transform animation", async ({ page }) => {
    await seedMotionMode(page, "standard");
    await seedMotionItems(page, [
      {
        id: "motion-dnd-source",
        title: "Motion DnD Source",
        subtitle: "Move this resource",
        kind: "app",
        group: "apps",
        target: "C:\\Motion\\source.exe",
        aliases: [],
        tags: ["motion-dnd"],
        subTag: "",
        icon: "AppWindow",
        accent: "#5cc8ff",
        favorite: false,
        launchCount: 0
      },
      {
        id: "motion-dnd-target",
        title: "Motion DnD Target",
        subtitle: "Target directory marker",
        kind: "app",
        group: "apps",
        target: "C:\\Motion\\target.exe",
        aliases: [],
        tags: ["motion-dnd"],
        subTag: "Motion Folder",
        icon: "AppWindow",
        accent: "#37d6bf",
        favorite: false,
        launchCount: 0
      }
    ]);
    await waitForMainWindow(page);

    const source = page.locator(
      '.resource-panel [data-resource-id="motion-dnd-source"]'
    );
    const targetDirectory = page.locator(
      '#droppable-subtag-wrapper-Motion\\ Folder'
    );
    await expect(source).toBeVisible();
    await expect(targetDirectory).toBeVisible();

    await dragBetween(page, source, targetDirectory);
    const duringDrag = await source.evaluate((row) => ({
      animationName: getComputedStyle(row).animationName,
      inlineTransform: (row as HTMLElement).style.transform
    }));
    expect(duringDrag.inlineTransform).toMatch(/(?:translate|scale)/);
    expect(duringDrag.animationName).toBe("none");
    await page.mouse.up();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const items = JSON.parse(
            window.localStorage.getItem("orbitstart.browser.items") ?? "[]"
          ) as Array<{ id?: string; subTag?: string }>;
          return items.find((item) => item.id === "motion-dnd-source")?.subTag;
        })
      )
      .toBe("Motion Folder");
    await expect(
      targetDirectory.locator('[data-resource-id="motion-dnd-source"]')
    ).toBeVisible();

    await page.mouse.move(0, 0);
    const settledTransform = await targetDirectory
      .locator('[data-resource-id="motion-dnd-source"]')
      .evaluate((row) => ({
        animationName: getComputedStyle(row).animationName,
        computedTransform: getComputedStyle(row).transform,
        inlineTransform: (row as HTMLElement).style.transform
      }));
    expect(settledTransform.inlineTransform).toBe("none");
    expect(settledTransform.computedTransform).toBe("none");
    expect(settledTransform.animationName).toBe("none");
  });

  test("persists same-directory resource order after a real dnd-kit reorder", async ({ page }) => {
    await seedMotionMode(page, "minimal");
    await seedMotionItems(
      page,
      ["first", "second", "third"].map((suffix, index) => ({
        id: `motion-reorder-${suffix}`,
        title: `Motion Reorder ${index + 1}`,
        subtitle: "Same-directory reorder fixture",
        kind: "app",
        group: "apps",
        target: `C:\\Motion\\reorder-${index + 1}.exe`,
        aliases: [],
        tags: ["motion-reorder"],
        subTag: "",
        icon: "AppWindow",
        accent: "#5cc8ff",
        favorite: false,
        launchCount: 0
      }))
    );
    await waitForMainWindow(page);

    const source = page.locator(
      '.resource-panel [data-resource-id="motion-reorder-first"]'
    );
    const target = page.locator(
      '.resource-panel [data-resource-id="motion-reorder-third"]'
    );
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();

    await dragBetween(page, source, target);
    const dragOwnership = await source.evaluate((row) => ({
      animationName: getComputedStyle(row).animationName,
      transformOwner: row.getAttribute("data-motion-transform"),
      inlineTransform: (row as HTMLElement).style.transform
    }));
    expect(dragOwnership.inlineTransform).toMatch(/(?:translate|scale)/);
    expect(dragOwnership.animationName).toBe("none");
    expect(dragOwnership.transformOwner).toBe("dnd");
    const displacedTarget = await target.evaluate((row) => ({
      computedTransform: getComputedStyle(row).transform,
      transitionDuration: getComputedStyle(row).transitionDuration,
      transformOwner: row.getAttribute("data-motion-transform")
    }));
    expect(displacedTarget.transformOwner).toBe("dnd");
    expect(displacedTarget.computedTransform).not.toBe("none");
    expect(
      displacedTarget.transitionDuration
        .split(",")
        .every((duration) => duration.trim() === "0s")
    ).toBe(true);
    await page.mouse.up();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const items = JSON.parse(
            window.localStorage.getItem("orbitstart.browser.items") ?? "[]"
          ) as Array<{ id?: string }>;
          return items
            .map((item) => item.id)
            .filter((id) => id?.startsWith("motion-reorder-"))
            .join(",");
        })
      )
      .toBe(
        "motion-reorder-second,motion-reorder-third,motion-reorder-first"
      );

    const renderedOrder = await page
      .locator('.resource-panel [data-resource-id^="motion-reorder-"]')
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-resource-id")).join(",")
      );
    expect(renderedOrder).toBe(
      "motion-reorder-second,motion-reorder-third,motion-reorder-first"
    );
  });

  test("does not restore a stale running workspace overlay and recovers when cancellation is unavailable", async ({ page }) => {
    await seedMotionMode(page, "standard");
    await page.addInitScript(() => {
      const staleAt = Date.now() - 120_000;
      window.localStorage.setItem(
        "orbitstart.plugin.workspaces.storage.active_launch",
        JSON.stringify({
          workspaceId: "stale-workspace",
          workspaceName: "Stale Workspace",
          totalSteps: 1,
          currentStepIndex: 0,
          currentStepId: "stale-step",
          currentStepTitle: "Interrupted before reload",
          completedStepIds: [],
          failedStepCount: 0,
          status: "running",
          result: null,
          startedAt: staleAt,
          updatedAt: staleAt,
          completedAt: null,
          errorMessage: null
        })
      );
    });
    await waitForMainWindow(page);

    const launchPanel = page.locator(".workspace-launch-progress-overlay");
    await expect(launchPanel).toHaveCount(0);

    const now = Date.now();
    await page.evaluate((startedAt) => {
      const key = "orbitstart.plugin.workspaces.storage.active_launch";
      const launch = {
        workspaceId: "live-without-runtime",
        workspaceName: "Unavailable Runtime",
        totalSteps: 2,
        currentStepIndex: 0,
        currentStepId: "step-one",
        currentStepTitle: "Starting",
        completedStepIds: [],
        failedStepCount: 0,
        status: "running",
        result: null,
        startedAt,
        updatedAt: startedAt,
        completedAt: null,
        errorMessage: null
      };
      window.localStorage.setItem(key, JSON.stringify(launch));
      window.dispatchEvent(
        new CustomEvent("orbit:plugin-storage-changed", {
          detail: {
            pluginId: "workspaces",
            namespace: "storage",
            key: "active_launch",
            storageKey: key,
            value: launch,
            removed: false
          }
        })
      );
    }, now);

    await expect(launchPanel).toHaveAttribute("data-motion-launch-state", "running");
    await launchPanel
      .locator('[data-workspace-launch-action="cancel"]')
      .click();
    await expect(launchPanel).toHaveAttribute("data-motion-launch-state", "error");
    const dismiss = launchPanel.locator('[data-workspace-launch-action="dismiss"]');
    await expect(dismiss).toBeEnabled();
    await dismiss.click();
    await expect(launchPanel).toHaveCount(0);
  });

  test("renders one event-driven workspace launch panel through running and completion", async ({ page }) => {
    await seedMotionMode(page, "standard");
    await waitForMainWindow(page);

    const storageKey =
      "orbitstart.plugin.workspaces.storage.active_launch";
    const publishLaunch = async (
      launch: Record<string, unknown>
    ): Promise<void> => {
      await page.evaluate(
        ({ key, value }) => {
          window.localStorage.setItem(key, JSON.stringify(value));
          window.dispatchEvent(
            new CustomEvent("orbit:plugin-storage-changed", {
              detail: {
                pluginId: "workspaces",
                namespace: "storage",
                key: "active_launch",
                storageKey: key,
                value,
                removed: false
              }
            })
          );
        },
        { key: storageKey, value: launch }
      );
    };

    const launchStartedAt = Date.now();
    await publishLaunch({
      workspaceId: "motion-workspace",
      workspaceName: "Motion Workspace",
      totalSteps: 2,
      currentStepIndex: 1,
      currentStepId: "motion-workspace-step-2",
      currentStepTitle: "启动中: Browser",
      completedStepIds: ["motion-workspace-step-1"],
      failedStepCount: 0,
      status: "running",
      result: null,
      startedAt: launchStartedAt,
      updatedAt: launchStartedAt,
      completedAt: null,
      errorMessage: null
    });

    const launchPanel = page.locator(".workspace-launch-progress-overlay");
    await expect(launchPanel).toHaveAttribute(
      "data-motion-launch-state",
      "running"
    );
    await expect(launchPanel).toContainText("Motion Workspace");
    await expect(page.locator(".workspace-launch-feedback")).toHaveCount(0);

    await publishLaunch({
      workspaceId: "motion-workspace",
      workspaceName: "Motion Workspace",
      totalSteps: 2,
      currentStepIndex: 2,
      currentStepId: null,
      currentStepTitle: "启动完成",
      completedStepIds: [
        "motion-workspace-step-1",
        "motion-workspace-step-2"
      ],
      failedStepCount: 0,
      status: "done",
      result: "success",
      startedAt: launchStartedAt,
      updatedAt: Date.now(),
      completedAt: Date.now(),
      errorMessage: null
    });

    await expect(launchPanel).toHaveAttribute(
      "data-motion-launch-state",
      "success"
    );
    await expect(launchPanel).toContainText("工作区启动完成");
    await expect(launchPanel).toHaveCount(0, { timeout: 2_500 });
  });

  test("reports launch state on one resource without blocking the catalogue", async ({ page }) => {
    await seedMotionMode(page, "standard");
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "orbitstart.browser.items",
        JSON.stringify([
          {
            id: "motion-launch-resource",
            title: "Motion Launch Resource",
            subtitle: "Browser fallback",
            kind: "app",
            group: "apps",
            target: "C:\\Motion\\launch.exe",
            aliases: [],
            tags: ["motion-test"],
            subTag: "",
            icon: "AppWindow",
            accent: "#5cc8ff",
            favorite: false,
            launchCount: 0
          },
          {
            id: "motion-neighbor-resource",
            title: "Motion Neighbor Resource",
            subtitle: "Must remain interactive",
            kind: "app",
            group: "apps",
            target: "C:\\Motion\\neighbor.exe",
            aliases: [],
            tags: ["motion-test"],
            subTag: "",
            icon: "AppWindow",
            accent: "#37d6bf",
            favorite: false,
            launchCount: 0
          }
        ])
      );
    });
    await waitForMainWindow(page);

    const launchedRow = page.locator('[data-resource-id="motion-launch-resource"]');
    const neighborRow = page.locator('[data-resource-id="motion-neighbor-resource"]');
    await launchedRow.locator(".resource-launch").click();
    await expect(launchedRow).toHaveAttribute("data-launch-state", "success");
    await expect(neighborRow.locator(".resource-launch")).toBeEnabled();
    await expect(launchedRow).toHaveAttribute("data-launch-state", "idle", { timeout: 2_000 });
  });

  test("degrades bulk selection effects and removes batch-deleted rows immediately", async ({ page }) => {
    await seedMotionMode(page, "standard");
    await seedMotionItems(
      page,
      ["alpha", "beta"].map((suffix, index) => ({
        id: `motion-batch-${suffix}`,
        title: `Motion Batch ${index + 1}`,
        subtitle: "Batch deletion fixture",
        kind: "app",
        group: "apps",
        target: `C:\\Motion\\batch-${index + 1}.exe`,
        aliases: [],
        tags: ["motion-batch"],
        subTag: "",
        icon: "AppWindow",
        accent: "#5cc8ff",
        favorite: false,
        launchCount: 0
      }))
    );
    await waitForMainWindow(page);

    await page.getByRole("button", { name: "批量管理", exact: true }).click();
    const batchToolbar = page.locator(".batch-toolbar");
    await expect(batchToolbar).toBeVisible();
    await batchToolbar.getByRole("button", { name: "全选当前", exact: true }).click();

    const rows = page.locator('[data-resource-id^="motion-batch-"]');
    await expect(rows).toHaveCount(2);
    const selectedEffects = await rows.first().evaluate((row) => ({
      boxShadow: getComputedStyle(row).boxShadow,
      transitionDuration: getComputedStyle(row).transitionDuration
    }));
    expect(selectedEffects.boxShadow).toBe("none");
    expect(
      selectedEffects.transitionDuration
        .split(",")
        .every((duration) => duration.trim() === "0s")
    ).toBe(true);

    await batchToolbar.locator(".danger-action").click();
    const dialog = page.locator(".dialog-panel", {
      has: page.getByRole("heading", { name: "批量删除", exact: true })
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "删除", exact: true }).click();

    await expect(rows).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const items = JSON.parse(
            window.localStorage.getItem("orbitstart.browser.items") ?? "[]"
          ) as Array<{ id?: string }>;
          return items.filter((item) => item.id?.startsWith("motion-batch-")).length;
        })
      )
      .toBe(0);
  });

  test("applies the same requested/effective policy to the lightweight bubble entry", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedMotionMode(page, "full");
    await page.goto("/floating-bubble.html");

    await expect(page.locator(".main-bubble")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-motion-requested", "full");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "minimal");
    await expect(page.locator("html")).toHaveAttribute("data-window-state", "visible");
  });
});
