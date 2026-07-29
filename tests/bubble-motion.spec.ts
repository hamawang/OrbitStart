import { expect, test } from "@playwright/test";

test.describe("floating bubble motion contracts", () => {
  test("Motion Off completes menu exits immediately and disables CSS animation", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "orbitstart.browser.snapshot",
        JSON.stringify({ settings: { motionMode: "off" } })
      );
    });
    await page.goto("/floating-bubble-menu.html");

    const menu = page.locator(".bubble-menu-shell");
    await expect(menu).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
    await expect
      .poll(() => menu.evaluate((element) => getComputedStyle(element).animationName))
      .toBe("none");

    const durations = await page.evaluate(async () => {
      const modulePath = "/src/components/FloatingBubble/FloatingBubble.tsx";
      const bubbleModule = await import(modulePath);
      return {
        menu: {
          off: bubbleModule.bubbleMenuExitDuration("off"),
          minimal: bubbleModule.bubbleMenuExitDuration("minimal"),
          standard: bubbleModule.bubbleMenuExitDuration("standard"),
        },
        snap: {
          off: bubbleModule.snapDurationForMode("off"),
          minimal: bubbleModule.snapDurationForMode("minimal"),
          standard: bubbleModule.snapDurationForMode("standard"),
        },
      };
    });
    expect(durations).toEqual({
      menu: { off: 0, minimal: 70, standard: 90 },
      snap: { off: 0, minimal: 0, standard: 160 },
    });
  });

  test("coalesces native writes and never overlaps setPosition calls", async ({ page }) => {
    await page.goto("/floating-bubble.html");

    const result = await page.evaluate(async () => {
      const modulePath = "/src/components/FloatingBubble/windowPositionAnimator.ts";
      const { WindowPositionAnimator } = await import(modulePath);
      const writes: Array<{ x: number; y: number }> = [];
      let activeWrites = 0;
      let maxActiveWrites = 0;

      const fakeWindow = {
        setPosition(position: { x: number; y: number }) {
          activeWrites += 1;
          maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
          writes.push({ x: position.x, y: position.y });
          return new Promise<void>((resolve) => {
            window.setTimeout(() => {
              activeWrites -= 1;
              resolve();
            }, 12);
          });
        },
      };

      const animator = new WindowPositionAnimator(() => undefined);
      animator.queueLatest(fakeWindow, 1, 1);
      animator.queueLatest(fakeWindow, 2, 2);
      animator.queueLatest(fakeWindow, 3, 3);
      await animator.waitForIdle();
      animator.dispose();

      return { writes, maxActiveWrites };
    });

    expect(result.maxActiveWrites).toBe(1);
    expect(result.writes).toEqual([
      { x: 1, y: 1 },
      { x: 3, y: 3 },
    ]);
  });

  test("a new snap cancels the previous snap and owns the final position", async ({ page }) => {
    await page.goto("/floating-bubble.html");

    const result = await page.evaluate(async () => {
      const modulePath = "/src/components/FloatingBubble/windowPositionAnimator.ts";
      const { WindowPositionAnimator } = await import(modulePath);
      const writes: Array<{ x: number; y: number }> = [];
      let activeWrites = 0;
      let maxActiveWrites = 0;

      const fakeWindow = {
        setPosition(position: { x: number; y: number }) {
          activeWrites += 1;
          maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
          writes.push({ x: position.x, y: position.y });
          return new Promise<void>((resolve) => {
            window.setTimeout(() => {
              activeWrites -= 1;
              resolve();
            }, 10);
          });
        },
      };

      const animator = new WindowPositionAnimator(() => undefined);
      const firstSnap = animator.animate(fakeWindow, 0, 0, 100, 0, 160);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 32));
      const secondSnap = animator.animate(fakeWindow, 0, 0, 20, 0, 40);
      const [firstCompleted, secondCompleted] = await Promise.all([firstSnap, secondSnap]);
      await animator.waitForIdle();
      animator.dispose();

      return {
        firstCompleted,
        secondCompleted,
        maxActiveWrites,
        finalPosition: writes[writes.length - 1],
      };
    });

    expect(result.firstCompleted).toBe(false);
    expect(result.secondCompleted).toBe(true);
    expect(result.maxActiveWrites).toBe(1);
    expect(result.finalPosition).toEqual({ x: 20, y: 0 });
  });
});
