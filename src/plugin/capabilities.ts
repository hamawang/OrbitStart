/**
 * The plugin runtime accepts only the capabilities in this registry.  Keep the
 * registry deliberately small: a manifest permission is not a wildcard and an
 * unknown permission never grants access to a host API.
 */
export type PluginCapabilityRisk = "low" | "medium" | "high" | "critical";

export interface PluginCapabilityDefinition {
  description: string;
  risk: PluginCapabilityRisk;
}

export const PLUGIN_CAPABILITIES = {
  "ui:toast": {
    description: "Show a transient notification in the OrbitStart window.",
    risk: "low"
  },
  "storage:plugin": {
    description: "Read and write storage scoped to this plugin id.",
    risk: "low"
  },
  "settings:plugin": {
    description: "Read and write settings scoped to this plugin id.",
    risk: "low"
  },
  "trips:read": {
    description: "Search and open OrbitStart Tip notes through the host bridge.",
    risk: "medium"
  },
  "obsidian:read": {
    description: "Search the indexed Obsidian task data and request an open action.",
    risk: "medium"
  },
  "catalog:read": {
    description: "Read the current OrbitStart catalog snapshot.",
    risk: "low"
  },
  "launcher:item": {
    description: "Launch an existing OrbitStart catalog item by id.",
    risk: "low"
  },
  "launcher:target": {
    description: "Launch a target path or URL supplied by the plugin.",
    risk: "high"
  },
  "filesystem:exists": {
    description: "Check whether a local path exists.",
    risk: "medium"
  },
  "network:probe": {
    description: "Probe a configured TCP port or URL through the host bridge.",
    risk: "medium"
  },
  "process:read": {
    description: "Check whether a named process is running.",
    risk: "medium"
  },
  "window:layout": {
    description: "Apply a saved desktop window layout.",
    risk: "high"
  },
  "shell:script-file": {
    description: "Run a script from an existing local file.",
    risk: "high"
  },
  "shell:inline-script": {
    description: "Run inline script content supplied by the plugin.",
    risk: "critical"
  }
} as const satisfies Record<string, PluginCapabilityDefinition>;

export type PluginCapabilityId = keyof typeof PLUGIN_CAPABILITIES;

export interface CapabilityResolution {
  granted: Set<PluginCapabilityId>;
  rejected: string[];
}

const HOST_API_CAPABILITIES: Readonly<Record<string, PluginCapabilityId>> = {
  "storage:get": "storage:plugin",
  "storage:set": "storage:plugin",
  "storage:remove": "storage:plugin",
  "storage:list": "storage:plugin",
  "settings:get": "settings:plugin",
  "settings:set": "settings:plugin",
  "trips:search": "trips:read",
  "trips:open": "trips:read",
  "obsidian:search": "obsidian:read",
  "obsidian:open": "obsidian:read",
  "catalog:get_snapshot": "catalog:read",
  "launcher:launch_item": "launcher:item",
  "launcher:launch_target": "launcher:target",
  "launcher:check_process_running": "process:read",
  "launcher:check_port_open": "network:probe",
  "launcher:check_path_exists": "filesystem:exists",
  "launcher:check_url_accessible": "network:probe",
  "launcher:apply_window_layout": "window:layout"
};

function normalizedPermissionIds(permissions: Iterable<string>) {
  return new Set(
    Array.from(permissions, (permission) => permission.trim()).filter(Boolean)
  );
}

function isPluginCapabilityId(value: string): value is PluginCapabilityId {
  return Object.prototype.hasOwnProperty.call(PLUGIN_CAPABILITIES, value);
}

/**
 * A runtime receives a capability only when both the catalog manifest and the
 * runtime file declare the same allowlisted id. This prevents a plugin file
 * changed after catalog loading from silently adding privileges.
 */
export function resolvePluginCapabilities(
  manifestPermissions: Iterable<string>,
  runtimePermissions: Iterable<string>
): CapabilityResolution {
  const manifest = normalizedPermissionIds(manifestPermissions);
  const runtime = normalizedPermissionIds(runtimePermissions);
  const granted = new Set<PluginCapabilityId>();
  const rejected: string[] = [];

  for (const permission of runtime) {
    if (!isPluginCapabilityId(permission)) {
      rejected.push(`${permission} (unknown capability)`);
      continue;
    }
    if (!manifest.has(permission)) {
      rejected.push(`${permission} (not present in the loaded manifest)`);
      continue;
    }
    granted.add(permission);
  }

  for (const permission of manifest) {
    if (isPluginCapabilityId(permission) && !runtime.has(permission)) {
      rejected.push(`${permission} (not present in the runtime manifest)`);
    }
  }

  return { granted, rejected };
}

/**
 * Returns the single capability required for an allowlisted host request.
 * `launcher:run_script` is intentionally resolved from its payload so file
 * scripts and inline scripts cannot share a broad shell permission.
 */
export function requiredCapabilityForHostRequest(
  api: string,
  payload: Record<string, unknown>
): PluginCapabilityId {
  if (api === "launcher:run_script") {
    const path = typeof payload.path === "string" ? payload.path.trim() : "";
    const hasPath = path.length > 0;
    const hasInlineContent = payload.content !== null && payload.content !== undefined;
    if (hasPath === hasInlineContent) {
      throw new Error("launcher:run_script requires exactly one of path or inline content");
    }
    return hasPath ? "shell:script-file" : "shell:inline-script";
  }

  const capability = HOST_API_CAPABILITIES[api];
  if (!capability) {
    throw new Error(`Plugin host API is not allowlisted: ${api}`);
  }
  return capability;
}

export function capabilityRisk(capability: PluginCapabilityId): PluginCapabilityRisk {
  return PLUGIN_CAPABILITIES[capability].risk;
}
