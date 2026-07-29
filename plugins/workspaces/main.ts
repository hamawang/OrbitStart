import type { OrbitPlugin, OrbitPluginContext } from "./orbitstart-plugin-api";

let commandDisposers = [];
let activeWorkspaceLaunch = null;
let activeWorkspaceLaunchId = null;
let activeWorkspaceCancellation = null;
let workspaceClaimPending = false;
const WORKSPACE_LAUNCH_LEASE_MS = 8000;
const WORKSPACE_LAUNCH_LOCK_NAME = "orbitstart:workspaces:active-launch";
const WORKSPACE_COMMAND_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const workspaceRuntimeId =
  globalThis.crypto?.randomUUID?.() ||
  `runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function cancellationError() {
  const error = new Error("工作区启动已取消");
  error.code = "ORBIT_WORKSPACE_CANCELLED";
  return error;
}

function ownershipLostError() {
  const error = new Error("工作区启动所有权已转移");
  error.code = "ORBIT_WORKSPACE_OWNERSHIP_LOST";
  return error;
}

function assertNotCancelled(cancellation) {
  if (cancellation?.ownershipLost) throw ownershipLostError();
  if (cancellation?.requested) throw cancellationError();
}

async function requestWorkspaceLaunchLock(task) {
  const lockManager = globalThis.navigator?.locks;
  if (!lockManager?.request) {
    return { acquired: true, value: await task() };
  }

  return lockManager.request(
    WORKSPACE_LAUNCH_LOCK_NAME,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock) return { acquired: false, value: undefined };
      return { acquired: true, value: await task() };
    }
  );
}

async function delay(ms, cancellation = null) {
  const end = Date.now() + Math.max(0, ms);
  while (Date.now() < end) {
    assertNotCancelled(cancellation);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(100, Math.max(0, end - Date.now())))
    );
  }
  assertNotCancelled(cancellation);
}

async function waitForCondition(ctx, cond, cancellation) {
  const type = cond.type;
  const val = cond.value;
  const timeoutMs = cond.timeoutMs || 30000;
  const start = Date.now();

  ctx.ui.toast(`等待条件：${type} -> ${val} (超时：${timeoutMs / 1000}秒)...`);

  while (Date.now() - start < timeoutMs) {
    assertNotCancelled(cancellation);
    let met = false;
    try {
      if (type === "time") {
        const ms = parseInt(val) || 0;
        await delay(ms, cancellation);
        return true;
      } else if (type === "process") {
        met = await ctx.launcher.checkProcessRunning(val);
      } else if (type === "port") {
        met = await ctx.launcher.checkPortOpen(val);
      } else if (type === "path") {
        met = await ctx.launcher.checkPathExists(val);
      } else if (type === "url") {
        met = await ctx.launcher.checkUrlAccessible(val);
      }
    } catch (e) {
      // Keep polling on error
    }

    if (met) {
      return true;
    }
    await delay(1000, cancellation);
  }

  return false;
}

async function restoreWindowPositionBackground(ctx, title, windowLayout, cancellation) {
  if (!windowLayout) return;
  const start = Date.now();
  const maxWait = 10000;
  
  while (Date.now() - start < maxWait) {
    if (cancellation?.requested) return;
    try {
      const success = await ctx.launcher.applyWindowLayout(windowLayout);
      if (success) {
        ctx.ui.toast(`[窗口] 成功恢复「${title}」窗口位置`);
        return;
      }
    } catch (err) {
      // Continue polling
    }
    await delay(500, cancellation);
  }
}

async function runWorkspaceInternal(ctx, workspaceId, cancellation) {
  const startTime = Date.now();
  let heartbeatTimer = null;
  let launchSettled = false;
  let successSteps = 0;
  let failedSteps = 0;
  const errors = [];
  let launchSnapshot = {
    launchId: cancellation.launchId,
    ownerRuntimeId: workspaceRuntimeId,
    workspaceId,
    workspaceName: "",
    totalSteps: 0,
    currentStepIndex: 0,
    currentStepId: null,
    currentStepTitle: "初始化中...",
    completedStepIds: [],
    failedStepCount: 0,
    status: "running",
    result: null,
    startedAt: startTime,
    updatedAt: startTime,
    completedAt: null,
    errorMessage: null
  };
  const persistLaunch = async (patch) => {
    const sharedLaunch = await ctx.storage.get("active_launch");
    if (
      sharedLaunch?.status !== "running" ||
      sharedLaunch?.launchId !== cancellation.launchId ||
      sharedLaunch?.ownerRuntimeId !== workspaceRuntimeId
    ) {
      cancellation.ownershipLost = true;
      throw ownershipLostError();
    }
    launchSnapshot = { ...launchSnapshot, ...patch, updatedAt: Date.now() };
    await ctx.storage.set("active_launch", launchSnapshot);
  };
  
  try {
    assertNotCancelled(cancellation);
    const workspaces = (await ctx.storage.get("workspaces")) || [];
    const workspace = workspaces.find((ws) => ws.id === workspaceId);
    if (!workspace) {
      ctx.ui.toast(`未找到工作区：${workspaceId}`);
      await persistLaunch({
        currentStepId: null,
        currentStepTitle: "未找到工作区",
        status: "done",
        result: "error",
        completedAt: Date.now(),
        errorMessage: `未找到工作区：${workspaceId}`
      });
      return "error";
    }

    const allSteps = (await ctx.storage.get("steps")) || [];
    const steps = allSteps
      .filter((step) => step.workspaceId === workspaceId && step.enabled)
      .sort((a, b) => a.order - b.order);

    ctx.ui.toast(`正在启动工作区「${workspace.name}」...`);

    await persistLaunch({
      workspaceName: workspace.name,
      totalSteps: steps.length,
      status: "running"
    });
    heartbeatTimer = setInterval(() => {
      void (async () => {
        try {
          if (launchSettled) return;
          const control = await ctx.storage.get("launch_control");
          if (control?.launchId === cancellation.launchId) {
            cancellation.requested = true;
          }
          if (launchSettled) return;
          await persistLaunch({});
        } catch (error) {
          // A transient heartbeat write failure must not create an unhandled
          // rejection or replace the actual launch result.
          if (error?.code === "ORBIT_WORKSPACE_OWNERSHIP_LOST") {
            cancellation.ownershipLost = true;
            cancellation.requested = true;
          }
        }
      })();
    }, 2000);

    const stepStatuses = {};
    let currentIdx = 0;

    for (const step of steps) {
      assertNotCancelled(cancellation);
      if (step.dependsOn && step.dependsOn.length > 0) {
        const met = step.dependsOn.every((depId) => stepStatuses[depId] === true);
        if (!met) {
          stepStatuses[step.id] = "skipped";
          failedSteps++;
          errors.push({ stepTitle: step.title, errorMsg: "依赖步骤未满足，跳过步骤" });
          ctx.ui.toast(`依赖未满足，跳过步骤「${step.title}」`);
          currentIdx++;
          continue;
        }
      }

      await persistLaunch({
        currentStepIndex: currentIdx,
        currentStepId: step.id,
        currentStepTitle: step.delayMs ? `延迟中: ${step.title}` : `启动中: ${step.title}`,
        completedStepIds: Object.keys(stepStatuses).filter((stepId) => stepStatuses[stepId] === true),
        failedStepCount: failedSteps,
        status: "running"
      });

      if (step.delayMs && step.delayMs > 0) {
        ctx.ui.toast(`等待延迟 ${step.delayMs / 1000} 秒...`);
        await delay(step.delayMs, cancellation);
      }

      if (step.type === "wait" || step.waitCondition) {
        const cond = step.waitCondition || { type: "time", value: String(step.delayMs || 0) };
        const ok = await waitForCondition(ctx, cond, cancellation);
        if (!ok) {
          stepStatuses[step.id] = false;
          failedSteps++;
          errors.push({ stepTitle: step.title, errorMsg: `等待条件超时: ${cond.type} -> ${cond.value}` });
          ctx.ui.toast(`等待超时：${step.title}`);
          if (step.failurePolicy === "stop") {
            ctx.ui.toast(`启动中止：步骤「${step.title}」等待超时。`);
            break;
          }
          currentIdx++;
          continue;
        }
      }

      let success = false;
      let alreadyRunning = false;

      if (step.windowLayout && workspace.preventDuplicate !== false) {
        try {
          const applied = await ctx.launcher.applyWindowLayout(step.windowLayout);
          if (applied) {
            success = true;
            alreadyRunning = true;
            ctx.ui.toast(`[窗口] 检测到「${step.title}」已在运行，已直接移动到指定位置`);
          }
        } catch (e) {
          // Ignore and launch
        }
      }

      if (!alreadyRunning) {
        assertNotCancelled(cancellation);
        try {
          if (step.type === "script") {
            const cfg = step.scriptConfig || { type: "bat", content: "", useFile: false };
            success = await ctx.launcher.runScript(
              cfg.type,
              cfg.useFile ? cfg.filePath : null,
              cfg.useFile ? null : cfg.content
            );
          } else if (step.itemId) {
            if (step.arguments || step.workingDirectory) {
              success = await ctx.launcher.launchTarget(step.target, step.arguments, step.workingDirectory);
            } else {
              success = await ctx.launcher.launchItem(step.itemId);
            }
          } else if (step.target) {
            success = await ctx.launcher.launchTarget(step.target, step.arguments, step.workingDirectory);
          } else {
            success = true;
          }
        } catch (err) {
          errors.push({ stepTitle: step.title, errorMsg: String(err) });
        }
      }

      if (success) {
        stepStatuses[step.id] = true;
        successSteps++;
        if (step.windowLayout && !alreadyRunning) {
          restoreWindowPositionBackground(ctx, step.title, step.windowLayout, cancellation);
        }
      } else {
        stepStatuses[step.id] = false;
        failedSteps++;
        if (errors.filter((e) => e.stepTitle === step.title).length === 0) {
          errors.push({ stepTitle: step.title, errorMsg: "启动失败" });
        }
        ctx.ui.toast(`启动失败：${step.title}`);
        if (step.failurePolicy === "stop") {
          ctx.ui.toast(`启动被中止：步骤「${step.title}」执行失败。`);
          break;
        }
      }
      currentIdx++;
    }

    const updatedWorkspaces = workspaces.map((ws) => {
      if (ws.id === workspaceId) {
        return {
          ...ws,
          launchCount: (ws.launchCount || 0) + 1,
          lastLaunchedAt: new Date().toISOString(),
        };
      }
      return ws;
    });
    await ctx.storage.set("workspaces", updatedWorkspaces);

    const durationMs = Date.now() - startTime;
    const log = {
      id: "log_" + Math.random().toString(36).substr(2, 9),
      workspaceId,
      workspaceName: workspace.name,
      launchedAt: new Date().toISOString(),
      totalSteps: steps.length,
      successSteps,
      failedSteps,
      durationMs,
      status: failedSteps === 0 ? "success" : (successSteps > 0 ? "partial" : "failed"),
      errors
    };
    
    const existingLogs = (await ctx.storage.get("logs")) || [];
    await ctx.storage.set("logs", [log, ...existingLogs].slice(0, 100));

    const launchSucceeded = failedSteps === 0;
    await persistLaunch({
      currentStepIndex: steps.length,
      currentStepId: null,
      currentStepTitle: launchSucceeded ? "启动完成" : "启动完成，部分步骤失败",
      completedStepIds: Object.keys(stepStatuses).filter((stepId) => stepStatuses[stepId] === true),
      failedStepCount: failedSteps,
      status: "done",
      result: launchSucceeded ? "success" : "error",
      completedAt: Date.now(),
      errorMessage: launchSucceeded
        ? null
        : errors[0]?.errorMsg || "一个或多个启动步骤失败"
    });

    ctx.ui.toast(`工作区「${workspace.name}」启动完成！`);
    return launchSucceeded ? "success" : "error";
  } catch (error) {
    const ownershipLost =
      error?.code === "ORBIT_WORKSPACE_OWNERSHIP_LOST" ||
      cancellation.ownershipLost;
    if (ownershipLost) {
      ctx.ui.toast("工作区启动所有权已转移，旧任务已停止");
      return "cancelled";
    }
    const cancelled = error?.code === "ORBIT_WORKSPACE_CANCELLED";
    ctx.ui.toast(cancelled ? "工作区启动已取消" : `启动工作区失败：${String(error)}`);
    await persistLaunch({
      currentStepId: null,
      currentStepTitle: cancelled ? "启动已取消" : "启动失败",
      completedStepIds: launchSnapshot.completedStepIds || [],
      failedStepCount: cancelled ? failedSteps : Math.max(1, failedSteps),
      status: "done",
      result: cancelled ? "cancelled" : "error",
      completedAt: Date.now(),
      errorMessage: cancelled ? null : String(error)
    });
    return cancelled ? "cancelled" : "error";
  } finally {
    launchSettled = true;
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
    }
    const control = await ctx.storage.get("launch_control");
    if (control?.launchId === cancellation.launchId) {
      await ctx.storage.set("launch_control", null);
    }
  }
}

async function runWorkspace(ctx, workspaceId) {
  if (activeWorkspaceLaunch || workspaceClaimPending) {
    const message =
      activeWorkspaceLaunchId === workspaceId
        ? "该工作区正在启动，请勿重复提交"
        : "已有工作区正在启动，请等待当前任务完成";
    ctx.ui.toast(message);
    throw new Error(message);
  }

  workspaceClaimPending = true;
  activeWorkspaceLaunchId = workspaceId;
  try {
    const lockResult = await requestWorkspaceLaunchLock(async () => {
      const storedLaunch = await ctx.storage.get("active_launch");
      if (
        storedLaunch?.status === "running" &&
        Date.now() -
          Number(storedLaunch.updatedAt || storedLaunch.startedAt || 0) <
          WORKSPACE_LAUNCH_LEASE_MS
      ) {
        const message =
          storedLaunch.workspaceId === workspaceId
            ? "该工作区正在另一个窗口中启动，请勿重复提交"
            : "已有工作区正在另一个窗口中启动，请等待当前任务完成";
        ctx.ui.toast(message);
        throw new Error(message);
      }

      const launchId =
        globalThis.crypto?.randomUUID?.() ||
        `launch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const cancellation = {
        requested: false,
        ownershipLost: false,
        launchId
      };
      await ctx.storage.set("launch_control", null);
      const claimedAt = Date.now();
      await ctx.storage.set("active_launch", {
        launchId,
        ownerRuntimeId: workspaceRuntimeId,
        workspaceId,
        workspaceName: "",
        totalSteps: 0,
        currentStepIndex: 0,
        currentStepId: null,
        currentStepTitle: "初始化中...",
        completedStepIds: [],
        failedStepCount: 0,
        status: "running",
        result: null,
        startedAt: claimedAt,
        updatedAt: claimedAt,
        completedAt: null,
        errorMessage: null
      });
      const confirmedClaim = await ctx.storage.get("active_launch");
      if (
        confirmedClaim?.launchId !== launchId ||
        confirmedClaim?.ownerRuntimeId !== workspaceRuntimeId
      ) {
        throw ownershipLostError();
      }

      activeWorkspaceCancellation = cancellation;
      const launch = runWorkspaceInternal(ctx, workspaceId, cancellation);
      activeWorkspaceLaunch = launch;
      try {
        return await launch;
      } finally {
        if (activeWorkspaceLaunch === launch) {
          activeWorkspaceLaunch = null;
          activeWorkspaceCancellation = null;
        }
      }
    });

    if (!lockResult.acquired) {
      const message = "另一个窗口正在启动工作区，请等待当前任务完成";
      ctx.ui.toast(message);
      throw new Error(message);
    }
    return lockResult.value;
  } finally {
    workspaceClaimPending = false;
    if (!activeWorkspaceLaunch) {
      activeWorkspaceLaunchId = null;
    }
  }
}

async function registerWorkspaceCommands(ctx) {
  // Dispose previous workspace commands
  for (const dispose of commandDisposers) {
    try {
      dispose();
    } catch (e) {
      // Ignore
    }
  }
  commandDisposers = [];

  const workspaces = (await ctx.storage.get("workspaces")) || [];
  for (const ws of workspaces) {
    if (!ws.enabled) continue;
    const dispose = ctx.commands.registerCommand({
      id: `run-workspace-${sanitizeCommandId(ws.id)}`,
      title: `启动工作区：${ws.name}`,
      subtitle: ws.description || "一键启动工作区环境",
      icon: ws.icon || "Briefcase",
      keywords: ["workspace", "工作区", ws.name],
      timeoutMs: WORKSPACE_COMMAND_TIMEOUT_MS,
      run: () => runWorkspace(ctx, ws.id),
    });
    commandDisposers.push(dispose);
  }
}

// Helper to sanitize workspace ID to be a valid Command ID
function sanitizeCommandId(id) {
  return id.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
}

class WorkspacesPlugin {
  constructor() {
    this.searchProviderDisposer = null;
    this.reloadCommandDisposer = null;
    this.cancelCommandDisposer = null;
    this.recoveryTimer = null;
    this.recoveryCheckInFlight = false;
  }

  async recoverInterruptedLaunchIfStale(ctx) {
    if (this.recoveryCheckInFlight) return;
    this.recoveryCheckInFlight = true;
    try {
      await requestWorkspaceLaunchLock(async () => {
        const interruptedLaunch = await ctx.storage.get("active_launch");
        if (interruptedLaunch?.status !== "running") return;
        if (
          interruptedLaunch.ownerRuntimeId === workspaceRuntimeId &&
          activeWorkspaceCancellation?.launchId === interruptedLaunch.launchId
        ) {
          return;
        }

        const lastHeartbeatAt = Number(
          interruptedLaunch.updatedAt || interruptedLaunch.startedAt || 0
        );
        if (Date.now() - lastHeartbeatAt < WORKSPACE_LAUNCH_LEASE_MS) return;

        // The exclusive Web Lock fences this read/write sequence from a new
        // launch claim in every renderer that shares the OrbitStart origin.
        const latestLaunch = await ctx.storage.get("active_launch");
        const latestHeartbeatAt = Number(
          latestLaunch?.updatedAt || latestLaunch?.startedAt || 0
        );
        if (
          latestLaunch?.status !== "running" ||
          latestLaunch?.launchId !== interruptedLaunch.launchId ||
          Date.now() - latestHeartbeatAt < WORKSPACE_LAUNCH_LEASE_MS
        ) {
          return;
        }

        const recoveredAt = Date.now();
        await ctx.storage.set("active_launch", {
          ...latestLaunch,
          currentStepId: null,
          currentStepTitle: "上一次启动已因应用重启而停止",
          status: "done",
          result: "cancelled",
          updatedAt: recoveredAt,
          completedAt: recoveredAt,
          errorMessage: null
        });
      });
    } finally {
      this.recoveryCheckInFlight = false;
    }
  }

  async activate(ctx) {
    await this.recoverInterruptedLaunchIfStale(ctx);
    this.recoveryTimer = setInterval(() => {
      void this.recoverInterruptedLaunchIfStale(ctx);
    }, Math.max(2000, Math.floor(WORKSPACE_LAUNCH_LEASE_MS / 2)));

    // 1. Register workspaces reload command (so the UI can trigger command list update)
    this.reloadCommandDisposer = ctx.commands.registerCommand({
      id: "reload",
      title: "重新加载工作区配置",
      subtitle: "从存储载入最新的工作区启动项",
      icon: "RefreshCw",
      keywords: ["reload", "refresh", "sync", "同步"],
      run: async () => {
        await registerWorkspaceCommands(ctx);
        ctx.ui.toast("工作区启动命令已同步");
      },
    });

    this.cancelCommandDisposer = ctx.commands.registerCommand({
      id: "cancel-active-launch",
      title: "取消当前工作区启动",
      subtitle: "停止尚未执行的工作区步骤",
      icon: "X",
      keywords: ["cancel", "workspace", "取消", "工作区"],
      run: async () => {
        const currentLaunch = await ctx.storage.get("active_launch");
        if (currentLaunch?.status !== "running") {
          ctx.ui.toast("当前没有正在启动的工作区");
          return;
        }
        if (
          activeWorkspaceCancellation &&
          activeWorkspaceCancellation.launchId === currentLaunch.launchId
        ) {
          activeWorkspaceCancellation.requested = true;
        } else if (currentLaunch.launchId) {
          await ctx.storage.set("launch_control", {
            launchId: currentLaunch.launchId,
            requestedAt: Date.now(),
            requestedByRuntimeId: workspaceRuntimeId
          });
        } else {
          ctx.ui.toast("当前启动记录缺少任务标识，无法安全取消");
          return;
        }
        ctx.ui.toast("正在取消工作区启动...");
      }
    });

    // 2. Register initial workspace commands
    await registerWorkspaceCommands(ctx);

    // 3. Register Command Bar Search Provider
    this.searchProviderDisposer = ctx.search.registerProvider(
      "search-workspaces",
      async (query) => {
        const queryLower = query.toLowerCase().trim();
        if (!queryLower) return [];

        const workspaces = (await ctx.storage.get("workspaces")) || [];
        return workspaces
          .filter((ws) => ws.enabled && ws.name.toLowerCase().includes(queryLower))
          .map((ws) => ({
            id: `workspace-${ws.id}`,
            title: `启动工作区：${ws.name}`,
            subtitle: ws.description || "一键启动工作区环境",
            icon: ws.icon || "Briefcase",
            source: "workspaces",
            actionLabel: "启动工作区",
            timeoutMs: WORKSPACE_COMMAND_TIMEOUT_MS,
            run: () => runWorkspace(ctx, ws.id),
          }));
      }
    );
  }

  deactivate() {
    if (this.recoveryTimer !== null) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    if (activeWorkspaceCancellation) {
      activeWorkspaceCancellation.requested = true;
    }
    for (const dispose of commandDisposers) {
      try {
        dispose();
      } catch (e) {
        // Ignore
      }
    }
    commandDisposers = [];

    if (this.searchProviderDisposer) {
      try {
        this.searchProviderDisposer();
      } catch (e) {
        // Ignore
      }
      this.searchProviderDisposer = null;
    }

    if (this.reloadCommandDisposer) {
      try {
        this.reloadCommandDisposer();
      } catch (e) {
        // Ignore
      }
      this.reloadCommandDisposer = null;
    }

    if (this.cancelCommandDisposer) {
      try {
        this.cancelCommandDisposer();
      } catch (e) {
        // Ignore
      }
      this.cancelCommandDisposer = null;
    }
  }
}

const workspacesPlugin = new WorkspacesPlugin();
export default workspacesPlugin;
