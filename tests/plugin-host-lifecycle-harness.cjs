/**
 * Verifies the host-side plugin activation lifecycle without requiring Tauri
 * IPC or a real Web Worker. Query-only bundled plugins must remain dormant
 * until the command palette explicitly activates deferred runtimes.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const apiPath = path.join(__dirname, "..", "src", "plugin", "api.ts");
const apiSource = fs.readFileSync(apiPath, "utf8");
const compiled = ts.transpileModule(apiSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  },
  fileName: apiPath
}).outputText;

class FakeWorkerPluginRuntime {
  static instances = [];

  constructor(plugin) {
    this.plugin = plugin;
    this.startCalls = 0;
    this.disposeCalls = 0;
    FakeWorkerPluginRuntime.instances.push(this);
  }

  start() {
    this.startCalls += 1;
  }

  dispose() {
    this.disposeCalls += 1;
  }
}

const moduleRecord = { exports: {} };
const loadApi = new Function("require", "exports", "module", compiled);
loadApi(
  (request) => {
    if (request === "./workerRuntime") return { WorkerPluginRuntime: FakeWorkerPluginRuntime };
    throw new Error(`Unexpected module request: ${request}`);
  },
  moduleRecord.exports,
  moduleRecord
);

const { PluginContext, createOrbitPluginHost } = moduleRecord.exports;

class FakeRuntime {
  constructor() {
    this.startCalls = 0;
    this.disposeCalls = 0;
  }

  start() {
    this.startCalls += 1;
  }

  dispose() {
    this.disposeCalls += 1;
  }
}

function manifest(id) {
  return {
    id,
    name: id,
    version: "0.0.0",
    description: "test plugin",
    enabled: true,
    builtin: false,
    permissions: [],
    contributes: { commands: 0, searchProviders: 0, themes: 0, views: 0 }
  };
}

const context = new PluginContext();
const eagerRuntime = new FakeRuntime();
const deferredRuntime = new FakeRuntime();
context.addRuntime(eagerRuntime);
context.addRuntime(deferredRuntime, { deferStart: true });
context.start();
assert.equal(eagerRuntime.startCalls, 1, "eager runtime starts with the host");
assert.equal(deferredRuntime.startCalls, 0, "deferred runtime stays dormant at startup");
context.start();
assert.equal(eagerRuntime.startCalls, 1, "host startup remains idempotent");
context.startDeferredRuntimes();
assert.equal(deferredRuntime.startCalls, 1, "deferred runtime starts on demand");
context.startDeferredRuntimes();
assert.equal(deferredRuntime.startCalls, 1, "deferred runtime starts only once");
context.dispose();
assert.equal(eagerRuntime.disposeCalls, 1, "eager runtime is disposed");
assert.equal(deferredRuntime.disposeCalls, 1, "deferred runtime is disposed even if never activated");

FakeWorkerPluginRuntime.instances.length = 0;
const host = createOrbitPluginHost([manifest("tips-search"), manifest("workspaces")]);
host.start();
const tipsRuntime = FakeWorkerPluginRuntime.instances.find((runtime) => runtime.plugin.id === "tips-search");
const workspacesRuntime = FakeWorkerPluginRuntime.instances.find((runtime) => runtime.plugin.id === "workspaces");
assert.ok(tipsRuntime, "tips-search runtime is registered");
assert.ok(workspacesRuntime, "workspaces runtime is registered");
assert.equal(tipsRuntime.startCalls, 0, "query-only tips-search is deferred");
assert.equal(workspacesRuntime.startCalls, 1, "workspaces remains eager for direct launches");
host.startDeferredRuntimes();
assert.equal(tipsRuntime.startCalls, 1, "tips-search starts when the command palette opens");
host.dispose();

console.log("Plugin host lifecycle verification passed.");
