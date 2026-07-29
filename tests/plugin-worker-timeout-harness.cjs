/**
 * Verifies that host-side Worker command requests honor the timeout declared
 * by the isolated plugin instead of the legacy fixed ten-second timeout.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const runtimePath = path.join(
  __dirname,
  "..",
  "src",
  "plugin",
  "workerRuntime.ts"
);
const source = fs.readFileSync(runtimePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  },
  fileName: runtimePath
}).outputText;

const LONG_COMMAND_DELAY_MS = 10_200;
const LONG_COMMAND_TIMEOUT_MS = 20_000;
const registeredCommands = new Map();
const runtimeEvents = [];

class FakeWorker {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
  }

  postMessage(message) {
    if (message.action === "activate") {
      setTimeout(() => {
        this.onmessage?.({
          data: {
            type: "register-command",
            command: {
              id: "long-plugin.wait",
              title: "Long command",
              subtitle: "Exceeds the legacy host timeout",
              pluginId: "long-plugin",
              icon: "Timer",
              keywords: ["long"],
              timeoutMs: LONG_COMMAND_TIMEOUT_MS
            }
          }
        });
        this.onmessage?.({
          data: {
            type: "response",
            requestId: message.requestId,
            ok: true,
            result: { activated: true }
          }
        });
      }, 0);
      return;
    }

    if (message.action === "run-command") {
      setTimeout(() => {
        if (this.terminated) return;
        this.onmessage?.({
          data: {
            type: "response",
            requestId: message.requestId,
            ok: true,
            result: "completed"
          }
        });
      }, LONG_COMMAND_DELAY_MS);
      return;
    }

    if (message.action === "deactivate") {
      setTimeout(() => {
        this.onmessage?.({
          data: {
            type: "response",
            requestId: message.requestId,
            ok: true,
            result: { deactivated: true }
          }
        });
      }, 0);
    }
  }

  terminate() {
    this.terminated = true;
  }
}

const originalWindow = globalThis.window;
const originalWorker = globalThis.Worker;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

globalThis.window = {
  setTimeout,
  clearTimeout,
  dispatchEvent() {}
};
globalThis.Worker = FakeWorker;
URL.createObjectURL = () => "blob:orbitstart-test-worker";
URL.revokeObjectURL = () => {};

const moduleRecord = { exports: {} };
new Function("require", "exports", "module", compiled)(
  (request) => {
    if (request === "../lib/native") {
      return {
        async readPluginRuntime() {
          return {
            id: "long-plugin",
            entry: "main.js",
            source: "export default { activate() {} };",
            permissions: []
          };
        },
        async recordPluginRuntimeEvent(pluginId, level, message) {
          runtimeEvents.push({ pluginId, level, message });
        },
        async openObsidianNote() {
          return true;
        },
        async searchObsidian() {
          return [];
        },
        async searchTrips() {
          return [];
        }
      };
    }
    if (request === "./capabilities") {
      return {
        capabilityRisk() {
          return "low";
        },
        requiredCapabilityForHostRequest() {
          return null;
        },
        resolvePluginCapabilities() {
          return {
            granted: new Set(),
            rejected: []
          };
        }
      };
    }
    if (request === "./storageEvents") {
      return { emitPluginStorageChanged() {} };
    }
    throw new Error(`Unexpected module request: ${request}`);
  },
  moduleRecord.exports,
  moduleRecord
);

const { WorkerPluginRuntime, normalizePluginExecutionTimeout } =
  moduleRecord.exports;
const context = {
  commands: {
    registerCommand(command) {
      registeredCommands.set(command.id, command);
      return () => registeredCommands.delete(command.id);
    }
  },
  search: {
    registerProvider() {
      return () => {};
    }
  },
  ui: {
    toast() {}
  }
};
const manifest = {
  id: "long-plugin",
  name: "Long Plugin",
  version: "0.0.0",
  description: "Worker timeout harness",
  enabled: true,
  builtin: false,
  permissions: [],
  contributes: {
    commands: 1,
    searchProviders: 0,
    themes: 0,
    views: 0
  }
};

(async () => {
  const runtime = new WorkerPluginRuntime(manifest, context);
  try {
    assert.equal(normalizePluginExecutionTimeout(undefined), 10_000);
    assert.equal(normalizePluginExecutionTimeout(50), 1000);
    assert.equal(
      normalizePluginExecutionTimeout(Number.MAX_SAFE_INTEGER),
      21_600_000
    );

    await runtime.start();
    const command = registeredCommands.get("long-plugin.wait");
    assert.ok(command, "worker command is registered with the host");

    const startedAt = Date.now();
    await command.run();
    const elapsedMs = Date.now() - startedAt;
    assert.ok(
      elapsedMs >= 10_000,
      `command must cross the legacy ten-second timeout (elapsed ${elapsedMs}ms)`
    );
    assert.equal(
      runtimeEvents.some(
        (event) =>
          event.level === "error" && event.message.includes("timed out")
      ),
      false,
      "the host does not report a false timeout"
    );
    console.log(
      "Worker command-specific timeout verification passed after crossing the legacy ten-second boundary."
    );
  } finally {
    runtime.terminate();
    globalThis.window = originalWindow;
    globalThis.Worker = originalWorker;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
