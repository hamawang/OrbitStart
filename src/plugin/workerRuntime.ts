import { openObsidianNote, readPluginRuntime, recordPluginRuntimeEvent, searchObsidian, searchTrips } from "../lib/native";
import type { OrbitPluginManifest, SearchResult } from "../types";
import type { PluginContext, RegisteredCommand } from "./api";
import {
  capabilityRisk,
  requiredCapabilityForHostRequest,
  resolvePluginCapabilities,
  type PluginCapabilityId
} from "./capabilities";
import { emitPluginStorageChanged } from "./storageEvents";

type WorkerRuntimeMessage =
  | { type: "response"; requestId: string; ok: true; result?: unknown }
  | { type: "response"; requestId: string; ok: false; error: string }
  | { type: "host-request"; requestId: string; api: string; payload?: Record<string, unknown> }
  | { type: "register-command"; command: SerializableCommand }
  | { type: "unregister-command"; id: string }
  | { type: "register-search-provider"; id: string }
  | { type: "unregister-search-provider"; id: string }
  | { type: "ui-toast"; message: string }
  | { type: "runtime-log"; level: "info" | "warn" | "error"; message: string };

type SerializableCommand = Omit<RegisteredCommand, "run">;
type SerializableSearchResult = Omit<SearchResult, "run"> & { actionId?: string };

interface PendingRequest<T = unknown> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: number;
}

const DEFAULT_PLUGIN_EXECUTION_TIMEOUT_MS = 10_000;
const MAX_PLUGIN_EXECUTION_TIMEOUT_MS = 6 * 60 * 60 * 1000;

export function normalizePluginExecutionTimeout(
  value: unknown,
  fallback = DEFAULT_PLUGIN_EXECUTION_TIMEOUT_MS
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(
    MAX_PLUGIN_EXECUTION_TIMEOUT_MS,
    Math.max(1000, Math.round(parsed))
  );
}

const WORKER_BOOTSTRAP = String.raw`
let pluginManifest = null;
let permissionSet = new Set();
let commandLimit = 0;
let searchProviderLimit = 0;
let commandCount = 0;
let searchProviderCount = 0;
let requestSeq = 0;
let actionSeq = 0;
let activePlugin = null;
const commandHandlers = new Map();
const searchProviders = new Map();
const searchActions = new Map();
const hostPending = new Map();

function toErrorMessage(error) {
  return error && error.message ? String(error.message) : String(error);
}

function hasPermission(permission) {
  return permissionSet.has(permission);
}

function postRuntimeLog(level, message) {
  self.postMessage({ type: "runtime-log", level, message });
}

function assertPermission(permission) {
  if (!hasPermission(permission)) {
    throw new Error("Permission denied: " + permission);
  }
}

function normalizeScopedId(id) {
  const raw = String(id || "").trim();
  if (!raw) throw new Error("Plugin registration id cannot be empty");
  const prefix = pluginManifest.id + ".";
  return raw.startsWith(prefix) ? raw : prefix + raw;
}

function sanitizeText(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function normalizeExecutionTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10000;
  return Math.min(21600000, Math.max(1000, Math.round(parsed)));
}

function hostRequest(api, payload) {
  const requestId = "worker-" + (++requestSeq);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      hostPending.delete(requestId);
      reject(new Error("Host API timed out: " + api));
    }, 8000);
    hostPending.set(requestId, { resolve, reject, timer });
    self.postMessage({ type: "host-request", requestId, api, payload });
  });
}

function sendResponse(requestId, ok, result, error) {
  self.postMessage(ok
    ? { type: "response", requestId, ok: true, result }
    : { type: "response", requestId, ok: false, error });
}

function denyRuntimeApi(name) {
  return function runtimeApiBlocked() {
    throw new Error(name + " is disabled in OrbitStart plugin workers");
  };
}

function lockRuntimeApi(name, replacement) {
  try {
    Object.defineProperty(self, name, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: replacement
    });
  } catch (_) {
    // WebView implementations can expose a non-configurable inherited API.
    // The host still rejects every privileged bridge request below.
    try { self[name] = replacement; } catch (_) {}
  }
}

function installRuntimeGuards() {
  // Plugins use explicit host APIs for probes. Direct network and script
  // loading stay unavailable even when a plugin receives network:probe.
  lockRuntimeApi("fetch", () => Promise.reject(new Error("fetch is disabled in OrbitStart plugin workers")));
  lockRuntimeApi("WebSocket", denyRuntimeApi("WebSocket"));
  lockRuntimeApi("EventSource", denyRuntimeApi("EventSource"));
  lockRuntimeApi("XMLHttpRequest", denyRuntimeApi("XMLHttpRequest"));
  lockRuntimeApi("importScripts", denyRuntimeApi("importScripts"));
  // A plugin must never discover a generic Tauri bridge from its worker. The
  // host owns native calls and exposes only the request allowlist below.
  lockRuntimeApi("__TAURI__", undefined);
  lockRuntimeApi("__TAURI_INTERNALS__", undefined);
}

function createPluginContext() {
  return {
    commands: {
      registerCommand(command) {
        if (!command || typeof command.run !== "function") {
          throw new Error("ctx.commands.registerCommand requires a command with run()");
        }
        if (commandCount >= commandLimit) {
          throw new Error("Command contribution limit exceeded for " + pluginManifest.id);
        }
        const id = normalizeScopedId(command.id);
        commandCount += 1;
        commandHandlers.set(id, command.run);
        self.postMessage({
          type: "register-command",
          command: {
            id,
            title: sanitizeText(command.title, id),
            subtitle: sanitizeText(command.subtitle, pluginManifest.description || "OrbitStart plugin command"),
            pluginId: pluginManifest.id,
            icon: sanitizeText(command.icon, "Puzzle"),
            keywords: Array.isArray(command.keywords) ? command.keywords.map(String) : [],
            timeoutMs: normalizeExecutionTimeout(command.timeoutMs)
          }
        });
        return () => {
          if (commandHandlers.delete(id)) {
            commandCount = Math.max(0, commandCount - 1);
            self.postMessage({ type: "unregister-command", id });
          }
        };
      }
    },
    search: {
      registerProvider(id, provider) {
        if (typeof provider !== "function") {
          throw new Error("ctx.search.registerProvider requires a provider function");
        }
        if (searchProviderCount >= searchProviderLimit) {
          throw new Error("Search provider contribution limit exceeded for " + pluginManifest.id);
        }
        const providerId = normalizeScopedId(id);
        searchProviderCount += 1;
        searchProviders.set(providerId, provider);
        self.postMessage({ type: "register-search-provider", id: providerId });
        return () => {
          if (searchProviders.delete(providerId)) {
            searchProviderCount = Math.max(0, searchProviderCount - 1);
            self.postMessage({ type: "unregister-search-provider", id: providerId });
          }
        };
      }
    },
    ui: {
      toast(message) {
        assertPermission("ui:toast");
        self.postMessage({ type: "ui-toast", message: String(message ?? "") });
      }
    },
    settings: {
      get(key, fallbackValue) {
        return hostRequest("settings:get", { key, fallbackValue });
      },
      set(key, value) {
        return hostRequest("settings:set", { key, value });
      }
    },
    storage: {
      get(key, fallbackValue) {
        return hostRequest("storage:get", { key, fallbackValue });
      },
      set(key, value) {
        return hostRequest("storage:set", { key, value });
      },
      remove(key) {
        return hostRequest("storage:remove", { key });
      },
      list() {
        return hostRequest("storage:list", {});
      }
    },
    trips: {
      search(query) {
        return hostRequest("trips:search", { query });
      },
      open(itemId, tripId) {
        return hostRequest("trips:open", { itemId, tripId });
      }
    },
    obsidian: {
      search(query) {
        return hostRequest("obsidian:search", { query });
      },
      open(vaultId, relativePath, lineNumber) {
        return hostRequest("obsidian:open", { vaultId, relativePath, lineNumber });
      }
    },
    catalog: {
      getSnapshot() {
        return hostRequest("catalog:get_snapshot", {});
      }
    },
    launcher: {
      launchItem(id) {
        return hostRequest("launcher:launch_item", { id });
      },
      launchTarget(target, arguments) {
        return hostRequest("launcher:launch_target", { target, arguments });
      },
      runScript(scriptType, path, content) {
        return hostRequest("launcher:run_script", { scriptType, path, content });
      },
      checkProcessRunning(processName) {
        return hostRequest("launcher:check_process_running", { processName });
      },
      checkPortOpen(address) {
        return hostRequest("launcher:check_port_open", { address });
      },
      checkPathExists(path) {
        return hostRequest("launcher:check_path_exists", { path });
      },
      checkUrlAccessible(url) {
        return hostRequest("launcher:check_url_accessible", { url });
      },
      applyWindowLayout(layout) {
        return hostRequest("launcher:apply_window_layout", { layout });
      }
    }
  };
}

async function activatePlugin(payload) {
  pluginManifest = payload.plugin;
  permissionSet = new Set(payload.permissions || []);
  commandLimit = Number(pluginManifest.contributes && pluginManifest.contributes.commands) || 0;
  searchProviderLimit = Number(pluginManifest.contributes && pluginManifest.contributes.searchProviders) || 0;
  installRuntimeGuards();

  const ctx = createPluginContext();
  const exports = {};
  if (typeof __orbit_plugin_factory !== "function") {
    throw new Error("Plugin worker factory is unavailable");
  }
  activePlugin = __orbit_plugin_factory(exports);
  if (!activePlugin || typeof activePlugin.activate !== "function") {
    throw new Error("Plugin default export must provide activate(ctx)");
  }
  await activePlugin.activate(ctx);
}

async function queryProvider(payload) {
  const provider = searchProviders.get(payload.providerId);
  if (!provider) return [];
  const rawResults = await provider(String(payload.query || ""));
  const results = Array.isArray(rawResults) ? rawResults : [];
  return results.map((result, index) => {
    const source = result && typeof result === "object" ? result : {};
    const run = source.run;
    const actionId = typeof run === "function"
      ? pluginManifest.id + ":action:" + (++actionSeq)
      : undefined;
    if (actionId) searchActions.set(actionId, run);
    return {
      id: sanitizeText(source.id, payload.providerId + ":" + index),
      title: sanitizeText(source.title, pluginManifest.name),
      subtitle: sanitizeText(source.subtitle, pluginManifest.description || ""),
      icon: sanitizeText(source.icon, "Puzzle"),
      source: sanitizeText(source.source, pluginManifest.id),
      actionLabel: sanitizeText(source.actionLabel, "执行"),
      timeoutMs: normalizeExecutionTimeout(source.timeoutMs),
      actionId
    };
  });
}

async function handleRequest(message) {
  try {
    let result;
    switch (message.action) {
      case "activate":
        await activatePlugin(message.payload);
        result = { activated: true };
        break;
      case "run-command": {
        const handler = commandHandlers.get(message.payload.commandId);
        if (!handler) throw new Error("Command not found: " + message.payload.commandId);
        result = await handler();
        break;
      }
      case "query-provider":
        result = await queryProvider(message.payload);
        break;
      case "run-search-action": {
        const action = searchActions.get(message.payload.actionId);
        if (!action) throw new Error("Search action not found: " + message.payload.actionId);
        result = await action();
        break;
      }
      case "deactivate":
        if (activePlugin && typeof activePlugin.deactivate === "function") {
          await activePlugin.deactivate();
        }
        result = { deactivated: true };
        break;
      default:
        throw new Error("Unknown worker action: " + message.action);
    }
    sendResponse(message.requestId, true, result);
  } catch (error) {
    const messageText = toErrorMessage(error);
    postRuntimeLog("error", messageText);
    sendResponse(message.requestId, false, undefined, messageText);
  }
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === "host-response") {
    const pending = hostPending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    hostPending.delete(message.requestId);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error || "Host API failed"));
    return;
  }
  if (message.type === "request") {
    void handleRequest(message);
  }
};
`;

function createWorkerUrl(pluginFactorySource: string) {
  return URL.createObjectURL(
    new Blob([WORKER_BOOTSTRAP, "\n", pluginFactorySource], { type: "text/javascript" })
  );
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function preparePluginSource(source: string, entry: string) {
  let next = source.replace(/^\s*import\s+type\s+[^;]+;\s*/gm, "");
  if (/^\s*import\s+(?!type\b)/m.test(next)) {
    throw new Error("Plugin runtime does not support static imports yet. Bundle the plugin or keep main.ts self-contained.");
  }
  if (/\bimport\s*\(/.test(next)) {
    throw new Error("Plugin runtime does not support dynamic imports. Keep main.ts self-contained.");
  }
  if (/\bimportScripts\s*\(/.test(next)) {
    throw new Error("Plugin runtime cannot load additional scripts with importScripts().");
  }
  next = next
    .replace(/^\s*export\s+\{\s*\};?\s*$/gm, "")
    .replace(/\s+satisfies\s+OrbitPlugin\b/g, "")
    .replace(/:\s*OrbitPlugin\b/g, "")
    .replace(/:\s*OrbitPluginContext\b/g, "")
    .replace(/export\s+default\s+/g, "__orbit_exports.default = ");
  // `sourceURL` is only a debugging aid. Keep it on one line so a malicious
  // runtime manifest cannot append code that executes while the worker loads,
  // before `installRuntimeGuards()` has run.
  const safeEntryLabel = String(entry).replace(/[\r\n\u2028\u2029]/g, "_");
  return [
    "function __orbit_plugin_factory(__orbit_exports) {",
    '"use strict";',
    next,
    "return __orbit_exports.default;",
    "}",
    `//# sourceURL=orbit-plugin://${safeEntryLabel}`
  ].join("\n");
}

function scopedStoragePrefix(pluginId: string, namespace: "settings" | "storage") {
  return `orbitstart.plugin.${pluginId}.${namespace}.`;
}

function encodeStorageKey(key: unknown) {
  const text = String(key ?? "").trim();
  if (!text) throw new Error("Storage key cannot be empty");
  if (text.length > 128) throw new Error("Storage key is too long");
  return encodeURIComponent(text);
}

function readJsonValue(raw: string | null, fallbackValue: unknown) {
  if (raw === null) return fallbackValue ?? null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fallbackValue ?? null;
  }
}

export class WorkerPluginRuntime {
  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private disposed = false;
  private requestSeq = 0;
  private commandDisposers = new Map<string, () => void>();
  private providerDisposers = new Map<string, () => void>();
  private pending = new Map<string, PendingRequest>();
  private permissionIds = new Set<PluginCapabilityId>();
  private readonly manifestPermissionIds: string[];

  constructor(
    private readonly plugin: OrbitPluginManifest,
    private readonly ctx: PluginContext
  ) {
    this.manifestPermissionIds = plugin.permissions.map((permission) => permission.id);
  }

  async start() {
    if (this.disposed || this.plugin.builtin || !this.plugin.enabled) return;
    try {
      const runtime = await readPluginRuntime(this.plugin.id);
      if (!runtime) {
        await this.log("warn", "Plugin has no main.js or main.ts runtime entry.");
        return;
      }

      const capabilityResolution = resolvePluginCapabilities(this.manifestPermissionIds, runtime.permissions);
      this.permissionIds = capabilityResolution.granted;
      if (capabilityResolution.rejected.length > 0) {
        await this.log(
          "warn",
          `Denied undeclared or unsupported plugin capabilities: ${capabilityResolution.rejected.join(", ")}`
        );
      }
      const elevatedCapabilities = Array.from(this.permissionIds).filter(
        (capability) => ["high", "critical"].includes(capabilityRisk(capability))
      );
      if (elevatedCapabilities.length > 0) {
        await this.log(
          "warn",
          `Plugin enabled with elevated capabilities: ${elevatedCapabilities.join(", ")}`
        );
      }

      const source = preparePluginSource(runtime.source, runtime.entry);
      this.workerUrl = createWorkerUrl(source);
      this.worker = new Worker(this.workerUrl, { name: `OrbitStart:${this.plugin.id}` });
      this.worker.onmessage = (event) => void this.handleMessage(event.data as WorkerRuntimeMessage);
      this.worker.onerror = (event) => {
        void this.log("error", event.message || "Plugin worker crashed.");
      };
      await this.request(
        "activate",
        {
          plugin: this.plugin,
          permissions: Array.from(this.permissionIds)
        },
        8000
      );
      await this.log("info", `Worker runtime activated from ${runtime.entry}.`);
    } catch (error) {
      await this.log("error", `Worker activation failed: ${toErrorMessage(error)}`);
      this.terminate();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.commandDisposers.values()) dispose();
    for (const dispose of this.providerDisposers.values()) dispose();
    this.commandDisposers.clear();
    this.providerDisposers.clear();
    if (this.worker) {
      void this.request("deactivate", {}, 1000).finally(() => this.terminate());
      window.setTimeout(() => this.terminate(), 1200);
    }
  }

  private terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.workerUrl) {
      URL.revokeObjectURL(this.workerUrl);
      this.workerUrl = null;
    }
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error("Plugin worker stopped."));
    }
    this.pending.clear();
  }

  private request<T = unknown>(action: string, payload: unknown, timeoutMs = 5000): Promise<T> {
    if (!this.worker) return Promise.reject(new Error("Plugin worker is not running."));
    const requestId = `${this.plugin.id}:${++this.requestSeq}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Plugin worker timed out during ${action}.`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.worker?.postMessage({ type: "request", requestId, action, payload });
    });
  }

  private async handleMessage(message: WorkerRuntimeMessage) {
    if (message.type === "response") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      window.clearTimeout(pending.timer);
      this.pending.delete(message.requestId);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error));
      return;
    }

    if (message.type === "register-command") {
      await this.registerCommand(message.command);
      return;
    }
    if (message.type === "unregister-command") {
      this.commandDisposers.get(message.id)?.();
      this.commandDisposers.delete(message.id);
      return;
    }
    if (message.type === "register-search-provider") {
      await this.registerSearchProvider(message.id);
      return;
    }
    if (message.type === "unregister-search-provider") {
      this.providerDisposers.get(message.id)?.();
      this.providerDisposers.delete(message.id);
      return;
    }
    if (message.type === "ui-toast") {
      if (this.hasPermission("ui:toast")) {
        this.ctx.ui.toast(message.message);
      } else {
        await this.log("warn", "Blocked ui.toast because ui:toast permission is missing.");
      }
      return;
    }
    if (message.type === "runtime-log") {
      await this.log(message.level, message.message);
      return;
    }
    if (message.type === "host-request") {
      await this.handleHostRequest(message.requestId, message.api, message.payload ?? {});
    }
  }

  private async registerCommand(command: SerializableCommand) {
    if (!command || typeof command.id !== "string") {
      await this.log("warn", "Blocked malformed command registration from plugin worker.");
      return;
    }
    if (!this.isOwnedContributionId(command.id)) {
      await this.log("warn", `Blocked command registration outside plugin namespace: ${String(command.id)}`);
      return;
    }
    if (!this.commandDisposers.has(command.id) && this.commandDisposers.size >= this.contributionLimit("commands")) {
      await this.log("warn", `Blocked command registration above manifest limit: ${command.id}`);
      return;
    }
    if (this.commandDisposers.has(command.id)) {
      this.commandDisposers.get(command.id)?.();
    }
    const dispose = this.ctx.commands.registerCommand({
      ...command,
      pluginId: this.plugin.id,
      run: async () => {
        await this.request(
          "run-command",
          { commandId: command.id },
          normalizePluginExecutionTimeout(command.timeoutMs)
        );
      }
    });
    this.commandDisposers.set(command.id, dispose);
  }

  private async registerSearchProvider(providerId: string) {
    if (typeof providerId !== "string") {
      await this.log("warn", "Blocked malformed search provider registration from plugin worker.");
      return;
    }
    if (!this.isOwnedContributionId(providerId)) {
      await this.log("warn", `Blocked search provider registration outside plugin namespace: ${String(providerId)}`);
      return;
    }
    if (!this.providerDisposers.has(providerId) && this.providerDisposers.size >= this.contributionLimit("searchProviders")) {
      await this.log("warn", `Blocked search provider registration above manifest limit: ${providerId}`);
      return;
    }
    if (this.providerDisposers.has(providerId)) {
      this.providerDisposers.get(providerId)?.();
    }
    const dispose = this.ctx.search.registerProvider(providerId, async (query) => {
      const results = await this.request<SerializableSearchResult[]>(
        "query-provider",
        { providerId, query },
        3500
      );
      return results.map((result) => ({
        ...result,
        run: async () => {
          if (result.actionId) {
            await this.request(
              "run-search-action",
              { actionId: result.actionId },
              normalizePluginExecutionTimeout(result.timeoutMs)
            );
          } else {
            this.ctx.ui.toast(result.title);
          }
        }
      }));
    });
    this.providerDisposers.set(providerId, dispose);
  }

  private async handleHostRequest(requestId: string, api: string, payload: Record<string, unknown>) {
    try {
      const result = await this.resolveHostRequest(api, payload);
      this.worker?.postMessage({ type: "host-response", requestId, ok: true, result });
    } catch (error) {
      this.worker?.postMessage({
        type: "host-response",
        requestId,
        ok: false,
        error: toErrorMessage(error)
      });
      await this.log("warn", `Host API blocked or failed: ${api} (${toErrorMessage(error)})`);
    }
  }

  private async resolveHostRequest(api: string, payload: Record<string, unknown>) {
    if (typeof api !== "string") throw new Error("Plugin host API name must be a string");
    this.requirePermission(requiredCapabilityForHostRequest(api, payload));

    if (api === "storage:get") return this.readScopedValue("storage", payload.key, payload.fallbackValue);
    if (api === "storage:set") return this.writeScopedValue("storage", payload.key, payload.value);
    if (api === "storage:remove") return this.removeScopedValue("storage", payload.key);
    if (api === "storage:list") return this.listScopedValues("storage");
    if (api === "settings:get") return this.readScopedValue("settings", payload.key, payload.fallbackValue);
    if (api === "settings:set") return this.writeScopedValue("settings", payload.key, payload.value);
    if (api === "trips:search") return searchTrips(String(payload.query ?? ""));
    if (api === "trips:open") {
      window.dispatchEvent(new CustomEvent("orbit-open-trip", {
        detail: {
          itemId: String(payload.itemId ?? ""),
          tripId: String(payload.tripId ?? "")
        }
      }));
      return true;
    }
    if (api === "obsidian:search") return searchObsidian(String(payload.query ?? ""));
    if (api === "obsidian:open") {
      const vaultId = String(payload.vaultId ?? "");
      const relativePath = String(payload.relativePath ?? "");
      const rawLine = Number(payload.lineNumber);
      const lineNumber = Number.isFinite(rawLine) && rawLine > 0 ? rawLine : undefined;
      if (!vaultId || !relativePath) {
        window.dispatchEvent(new CustomEvent("orbit-open-obsidian"));
        return true;
      }
      return openObsidianNote(vaultId, relativePath, lineNumber);
    }
    if (api === "catalog:get_snapshot") {
      return import("@tauri-apps/api/core").then(({ invoke }) => invoke("catalog_snapshot"));
    }
    if (api === "launcher:launch_item") {
      const id = String(payload.id ?? "");
      return import("@tauri-apps/api/core").then(({ invoke }) => invoke("launch_item", { id }));
    }
    if (api === "launcher:launch_target") {
      const target = String(payload.target ?? "");
      const arguments_ = payload.arguments ? String(payload.arguments) : null;
      const workingDirectory = payload.workingDirectory ? String(payload.workingDirectory) : null;
      return import("@tauri-apps/api/core").then(({ invoke }) => invoke("launch_target_with_args", { target, arguments: arguments_, workingDirectory }));
    }
    if (api === "launcher:run_script") {
      const scriptType = String(payload.scriptType ?? "");
      // Mirror the capability resolver exactly: a non-empty string path means
      // a script file, while every non-null inline value (including "") is
      // inline content. This avoids silently changing the mode after it has
      // been permission-checked.
      const path = typeof payload.path === "string" && payload.path.trim()
        ? payload.path
        : null;
      const content = payload.content === null || payload.content === undefined
        ? null
        : String(payload.content);
      return import("@tauri-apps/api/core").then(({ invoke }) => invoke("run_script", { scriptType, path, content }));
    }
    if (api === "launcher:check_process_running") {
      const processName = String(payload.processName ?? "");
      return import("@tauri-apps/api/core").then(({ invoke }) => invoke("check_process_running", { processName }));
    }
    if (api === "launcher:check_port_open") {
      const address = String(payload.address ?? "");
      return import("@tauri-apps/api/core").then(({ invoke }) => invoke("check_port_open", { address }));
    }
    if (api === "launcher:check_path_exists") {
      const path = String(payload.path ?? "");
      return import("@tauri-apps/api/core").then(({ invoke }) => invoke("check_path_exists", { path }));
    }
    if (api === "launcher:check_url_accessible") {
      const url = String(payload.url ?? "");
      return import("@tauri-apps/api/core").then(({ invoke }) => invoke("check_url_accessible", { url }));
    }
    if (api === "launcher:apply_window_layout") {
      const layout = payload.layout;
      return import("@tauri-apps/api/core").then(({ invoke }) => invoke("workspaces_apply_window_layout", { layout }));
    }
    throw new Error(`Unknown host API: ${api}`);
  }

  private readScopedValue(namespace: "settings" | "storage", key: unknown, fallbackValue: unknown) {
    const storageKey = scopedStoragePrefix(this.plugin.id, namespace) + encodeStorageKey(key);
    return readJsonValue(window.localStorage.getItem(storageKey), fallbackValue);
  }

  private writeScopedValue(namespace: "settings" | "storage", key: unknown, value: unknown) {
    const encodedKey = encodeStorageKey(key);
    const storageKey = scopedStoragePrefix(this.plugin.id, namespace) + encodedKey;
    window.localStorage.setItem(storageKey, JSON.stringify(value));
    emitPluginStorageChanged({
      pluginId: this.plugin.id,
      namespace,
      key: decodeURIComponent(encodedKey),
      storageKey,
      value,
      removed: false
    });
    return true;
  }

  private removeScopedValue(namespace: "settings" | "storage", key: unknown) {
    const encodedKey = encodeStorageKey(key);
    const storageKey = scopedStoragePrefix(this.plugin.id, namespace) + encodedKey;
    window.localStorage.removeItem(storageKey);
    emitPluginStorageChanged({
      pluginId: this.plugin.id,
      namespace,
      key: decodeURIComponent(encodedKey),
      storageKey,
      value: null,
      removed: true
    });
    return true;
  }

  private listScopedValues(namespace: "settings" | "storage") {
    const prefix = scopedStoragePrefix(this.plugin.id, namespace);
    const entries: Array<{ key: string; value: unknown }> = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const storageKey = window.localStorage.key(index);
      if (!storageKey?.startsWith(prefix)) continue;
      const key = decodeURIComponent(storageKey.slice(prefix.length));
      entries.push({ key, value: readJsonValue(window.localStorage.getItem(storageKey), null) });
    }
    return entries;
  }

  private isOwnedContributionId(id: unknown) {
    return typeof id === "string" && id.startsWith(`${this.plugin.id}.`);
  }

  private contributionLimit(kind: "commands" | "searchProviders") {
    const rawLimit = this.plugin.contributes?.[kind];
    return Number.isFinite(rawLimit) ? Math.max(0, Math.floor(rawLimit)) : 0;
  }

  private hasPermission(permission: PluginCapabilityId) {
    return this.permissionIds.has(permission);
  }

  private requirePermission(permission: PluginCapabilityId) {
    if (!this.hasPermission(permission)) throw new Error(`Permission denied: ${permission}`);
  }

  private async log(level: "info" | "warn" | "error", message: string) {
    await recordPluginRuntimeEvent(this.plugin.id, level, message);
  }
}
