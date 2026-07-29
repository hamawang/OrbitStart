import { PhysicalPosition } from "@tauri-apps/api/dpi";

export interface PositionableWindow {
  setPosition(position: PhysicalPosition): Promise<void>;
}

interface PositionRequest {
  appWindow: PositionableWindow;
  x: number;
  y: number;
}

interface ActiveAnimation {
  token: number;
  appWindow: PositionableWindow;
  endX: number;
  endY: number;
  frameId: number | null;
  resolve: (completed: boolean) => void;
}

type PositionErrorHandler = (error: unknown) => void;

/**
 * Serializes every WebviewWindow.setPosition call made by the bubble.
 *
 * Pointer events can arrive faster than WebView2/Tauri can move the native
 * window. Keeping only the latest queued coordinate prevents an ever-growing
 * backlog while guaranteeing that no two native position writes are in flight.
 */
export class WindowPositionAnimator {
  private readonly onError: PositionErrorHandler;
  private inFlight: Promise<void> | null = null;
  private queued: PositionRequest | null = null;
  private idleResolvers = new Set<() => void>();
  private animationToken = 0;
  private activeAnimation: ActiveAnimation | null = null;
  private disposed = false;

  constructor(onError: PositionErrorHandler) {
    this.onError = onError;
  }

  queueLatest(appWindow: PositionableWindow, x: number, y: number) {
    if (this.disposed) return;
    this.queued = {
      appWindow,
      x: Math.round(x),
      y: Math.round(y),
    };
    this.flush();
  }

  async moveTo(appWindow: PositionableWindow, x: number, y: number) {
    this.queueLatest(appWindow, x, y);
    await this.waitForIdle();
  }

  waitForIdle(): Promise<void> {
    if (this.disposed || (!this.inFlight && !this.queued)) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.idleResolvers.add(resolve);
    });
  }

  animate(
    appWindow: PositionableWindow,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    durationMs: number
  ): Promise<boolean> {
    this.cancelAnimation();

    if (this.disposed) return Promise.resolve(false);
    if (durationMs <= 0 || (startX === endX && startY === endY)) {
      return this.moveTo(appWindow, endX, endY).then(() => !this.disposed);
    }

    const token = ++this.animationToken;
    const startTime = performance.now();

    return new Promise<boolean>((resolve) => {
      const active: ActiveAnimation = {
        token,
        appWindow,
        endX,
        endY,
        frameId: null,
        resolve,
      };
      this.activeAnimation = active;

      const tick = (now: number) => {
        if (this.disposed || this.activeAnimation !== active || active.token !== this.animationToken) {
          return;
        }

        const elapsed = now - startTime;
        const progress = Math.min(elapsed / durationMs, 1);
        const easedProgress = progress * (2 - progress);
        const currentX = startX + (endX - startX) * easedProgress;
        const currentY = startY + (endY - startY) * easedProgress;

        this.queueLatest(appWindow, currentX, currentY);

        if (progress < 1) {
          active.frameId = window.requestAnimationFrame(tick);
          return;
        }

        active.frameId = null;
        void this.waitForIdle().then(() => {
          if (this.disposed || this.activeAnimation !== active || active.token !== this.animationToken) {
            return;
          }
          this.activeAnimation = null;
          active.resolve(true);
        });
      };

      active.frameId = window.requestAnimationFrame(tick);
    });
  }

  /**
   * Complete the current snap at its target without playing hidden frames.
   * Used when the WebView becomes hidden so saved geometry remains exact.
   */
  finishAnimation() {
    const active = this.activeAnimation;
    if (!active || this.disposed) return;

    if (active.frameId !== null) {
      window.cancelAnimationFrame(active.frameId);
      active.frameId = null;
    }

    this.queued = null;
    this.queueLatest(active.appWindow, active.endX, active.endY);
    void this.waitForIdle().then(() => {
      if (this.disposed || this.activeAnimation !== active || active.token !== this.animationToken) {
        return;
      }
      this.activeAnimation = null;
      active.resolve(true);
    });
  }

  /**
   * A new drag/snap invalidates the previous snap. An already-issued native
   * write cannot be aborted, but no stale queued frame is allowed to follow it.
   */
  cancelAnimation() {
    const active = this.activeAnimation;
    if (!active) return;

    this.animationToken += 1;
    this.activeAnimation = null;
    this.queued = null;
    if (active.frameId !== null) {
      window.cancelAnimationFrame(active.frameId);
    }
    active.resolve(false);
    this.resolveIdleWaitersIfIdle();
  }

  dispose() {
    this.cancelAnimation();
    this.disposed = true;
    this.queued = null;
    this.idleResolvers.forEach((resolve) => resolve());
    this.idleResolvers.clear();
  }

  private flush() {
    if (this.disposed || this.inFlight || !this.queued) return;

    const request = this.queued;
    this.queued = null;
    this.inFlight = Promise.resolve()
      .then(() => request.appWindow.setPosition(new PhysicalPosition(request.x, request.y)))
      .catch((error) => {
        try {
          this.onError(error);
        } catch {
          // Error reporting must not break the single-flight queue.
        }
      })
      .finally(() => {
        this.inFlight = null;
        if (this.queued) {
          this.flush();
        } else {
          this.resolveIdleWaitersIfIdle();
        }
      });
  }

  private resolveIdleWaitersIfIdle() {
    if (this.inFlight || this.queued) return;
    this.idleResolvers.forEach((resolve) => resolve());
    this.idleResolvers.clear();
  }
}
