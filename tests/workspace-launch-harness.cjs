const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const sourcePath = path.join(
  __dirname,
  "..",
  "plugins",
  "workspaces",
  "main.ts"
);
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  },
  fileName: sourcePath
}).outputText;

function loadPlugin() {
  const moduleRecord = { exports: {} };
  new Function("require", "exports", "module", compiled)(
    require,
    moduleRecord.exports,
    moduleRecord
  );
  return moduleRecord.exports.default;
}

const storage = new Map();
const toasts = [];

storage.set("active_launch", {
  launchId: "interrupted-launch",
  ownerRuntimeId: "interrupted-runtime",
  workspaceId: "interrupted",
  workspaceName: "Interrupted workspace",
  currentStepIndex: 0,
  totalSteps: 1,
  currentStepId: "interrupted-step",
  currentStepTitle: "Running before restart",
  completedStepIds: [],
  failedStepCount: 0,
  status: "running",
  result: null,
  startedAt: Date.now() - 10_000,
  updatedAt: Date.now() - 10_000,
  completedAt: null,
  errorMessage: null
});
storage.set("workspaces", [
  {
    id: "launch-one",
    name: "Launch One",
    enabled: true,
    launchCount: 0
  },
  {
    id: "launch-two",
    name: "Launch Two",
    enabled: true,
    launchCount: 0
  }
]);
storage.set("steps", [
  {
    id: "wait-one",
    workspaceId: "launch-one",
    order: 1,
    type: "wait",
    title: "Wait one",
    enabled: true,
    delayMs: 0,
    waitCondition: { type: "time", value: "5000", timeoutMs: 7000 },
    failurePolicy: "stop"
  },
  {
    id: "wait-two",
    workspaceId: "launch-two",
    order: 1,
    type: "wait",
    title: "Wait two",
    enabled: true,
    delayMs: 0,
    waitCondition: { type: "time", value: "5000", timeoutMs: 7000 },
    failurePolicy: "stop"
  }
]);
storage.set("logs", []);

function createContext() {
  const commands = new Map();
  const providers = new Map();
  return {
    commands,
    providers,
    context: {
      commands: {
        registerCommand(command) {
          commands.set(command.id, command);
          return () => commands.delete(command.id);
        }
      },
      search: {
        registerProvider(id, provider) {
          providers.set(id, provider);
          return () => providers.delete(id);
        }
      },
      storage: {
        async get(key) {
          return storage.get(key);
        },
        async set(key, value) {
          storage.set(key, value);
        }
      },
      ui: {
        toast(message) {
          toasts.push(message);
        }
      },
      launcher: {
        async applyWindowLayout() {
          return false;
        },
        async checkPathExists() {
          return false;
        },
        async checkPortOpen() {
          return false;
        },
        async checkProcessRunning() {
          return false;
        },
        async checkUrlAccessible() {
          return false;
        },
        async launchItem() {
          return true;
        },
        async launchTarget() {
          return true;
        },
        async runScript() {
          return true;
        }
      }
    },
  };
}

async function waitUntil(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for workspace launch state");
}

(async () => {
  const primaryPlugin = loadPlugin();
  const secondaryPlugin = loadPlugin();
  const primary = createContext();
  const secondary = createContext();

  try {
    await primaryPlugin.activate(primary.context);

    const recovered = storage.get("active_launch");
    assert.equal(recovered.status, "done");
    assert.equal(recovered.result, "cancelled");
    assert.match(recovered.currentStepTitle, /应用重启/);

    const runOne = primary.commands.get("run-workspace-launch-one");
    const runTwo = primary.commands.get("run-workspace-launch-two");
    assert.ok(runOne, "first workspace command is registered");
    assert.ok(runTwo, "second workspace command is registered");
    assert.ok(
      runOne.timeoutMs > 10_000,
      "workspace launch commands declare a long-running worker timeout"
    );

    const firstLaunch = runOne.run();
    await waitUntil(() => storage.get("active_launch")?.status === "running");
    const liveLaunch = storage.get("active_launch");
    assert.ok(liveLaunch.launchId, "a live launch has a stable launch id");
    assert.ok(
      liveLaunch.ownerRuntimeId,
      "a live launch records the owning renderer runtime"
    );

    await assert.rejects(
      () => runTwo.run(),
      /已有工作区正在启动/,
      "the owner renderer cannot start a second workspace"
    );

    await secondaryPlugin.activate(secondary.context);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const afterSecondaryActivation = storage.get("active_launch");
    assert.equal(
      afterSecondaryActivation.status,
      "running",
      "opening another renderer does not recover a fresh live lease"
    );
    assert.equal(
      afterSecondaryActivation.launchId,
      liveLaunch.launchId,
      "another renderer cannot replace the active launch record"
    );

    const secondaryRunTwo = secondary.commands.get(
      "run-workspace-launch-two"
    );
    const secondaryCancel = secondary.commands.get("cancel-active-launch");
    assert.ok(secondaryRunTwo, "secondary renderer registers workspace commands");
    assert.ok(secondaryCancel, "secondary renderer registers cancellation");
    assert.ok(
      secondaryRunTwo.timeoutMs > 10_000,
      "secondary renderer preserves the long-running command contract"
    );
    await assert.rejects(
      () => secondaryRunTwo.run(),
      /另一个窗口|正在启动/,
      "a second renderer respects the shared launch lease"
    );

    const externallySettledAt = Date.now();
    const externallySettled = {
      ...storage.get("active_launch"),
      currentStepId: null,
      currentStepTitle: "Lease supervisor fenced the old owner",
      status: "done",
      result: "cancelled",
      updatedAt: externallySettledAt,
      completedAt: externallySettledAt,
      errorMessage: null
    };
    storage.set("active_launch", externallySettled);
    await firstLaunch;
    const afterFence = storage.get("active_launch");
    assert.equal(afterFence.status, "done");
    assert.equal(afterFence.result, "cancelled");
    assert.equal(
      afterFence.currentStepTitle,
      "Lease supervisor fenced the old owner",
      "a fenced owner cannot resurrect its stale running snapshot"
    );

    const startedAt = Date.now();
    const cancellableLaunch = runOne.run();
    await waitUntil(() => storage.get("active_launch")?.status === "running");
    const cancellableSnapshot = storage.get("active_launch");
    await assert.rejects(
      () => secondaryRunTwo.run(),
      /另一个窗口|正在启动/,
      "the shared lease also fences a later launch"
    );
    await secondaryCancel.run();
    const control = storage.get("launch_control");
    assert.equal(
      control.launchId,
      cancellableSnapshot.launchId,
      "a non-owner renderer forwards cancellation to the owner"
    );

    await cancellableLaunch;
    const cancelled = storage.get("active_launch");
    assert.equal(cancelled.status, "done");
    assert.equal(cancelled.result, "cancelled");
    assert.equal(cancelled.currentStepId, null);
    assert.ok(
      Date.now() - startedAt < 3500,
      "cross-renderer cancellation interrupts before the five-second wait ends"
    );
    assert.equal(storage.get("launch_control"), null);
    assert.ok(cancelled.updatedAt >= cancelled.startedAt);
    assert.ok(toasts.some((message) => message.includes("启动已取消")));

    console.log(
      "Workspace restart recovery, live lease, multi-renderer concurrency, heartbeat, and cross-renderer cancellation verification passed."
    );
  } finally {
    secondaryPlugin.deactivate();
    primaryPlugin.deactivate();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
