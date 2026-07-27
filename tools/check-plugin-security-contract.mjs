import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function readText(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function readJson(relativePath) {
  try {
    return JSON.parse(readText(relativePath));
  } catch (error) {
    failures.push(`Cannot parse ${relativePath}: ${error.message}`);
    return null;
  }
}

function parseCapabilityRisks(source) {
  const capabilityBlock = source.match(
    /export const PLUGIN_CAPABILITIES = \{([\s\S]*?)\} as const satisfies Record<string, PluginCapabilityDefinition>;/
  )?.[1];
  if (!capabilityBlock) {
    failures.push("Cannot locate PLUGIN_CAPABILITIES in src/plugin/capabilities.ts");
    return new Map();
  }

  const risks = new Map();
  const entryPattern = /^\s*"([^"]+)": \{\r?\n\s*description: "[^"\r\n]*",\r?\n\s*risk: "(low|medium|high|critical)"\r?\n\s*\},?/gm;
  for (const match of capabilityBlock.matchAll(entryPattern)) {
    risks.set(match[1], match[2]);
  }
  if (risks.size === 0) {
    failures.push("Cannot parse capability risk entries from src/plugin/capabilities.ts");
  }
  return risks;
}

const capabilityRisks = parseCapabilityRisks(readText("src/plugin/capabilities.ts"));
const pluginDirectories = readdirSync(resolve(root, "plugins"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const pluginDirectory of pluginDirectories) {
  const manifestPath = `plugins/${pluginDirectory}/plugin.json`;
  const manifest = readJson(manifestPath);
  if (!manifest) continue;

  expect(typeof manifest.id === "string" && manifest.id.length > 0, `${manifestPath} is missing a plugin id`);
  expect(Array.isArray(manifest.permissions), `${manifestPath} must contain a permissions array`);
  if (!Array.isArray(manifest.permissions)) continue;

  for (const permission of manifest.permissions) {
    const expectedRisk = capabilityRisks.get(permission?.id);
    expect(
      typeof expectedRisk === "string",
      `${manifestPath} requests unsupported capability: ${String(permission?.id)}`
    );
    if (expectedRisk) {
      expect(
        permission?.risk === expectedRisk,
        `${manifestPath} assigns ${String(permission?.id)} risk ${String(permission?.risk)}, expected ${expectedRisk}`
      );
    }
  }
}

const workspacesManifest = readJson("plugins/workspaces/plugin.json");
if (workspacesManifest?.permissions) {
  const workspacePermissions = new Map(workspacesManifest.permissions.map((permission) => [permission.id, permission.risk]));
  expect(
    workspacePermissions.get("shell:script-file") === "high",
    "workspaces must declare shell:script-file as high risk when it can execute a script file"
  );
  expect(
    workspacePermissions.get("shell:inline-script") === "critical",
    "workspaces must declare shell:inline-script as critical risk when it can execute inline script content"
  );
}

const staticCatalog = readText("src/data/catalog.ts");
expect(
  !/id:\s*["']shell:open["']/.test(staticCatalog),
  "src/data/catalog.ts must not advertise the legacy broad shell:open capability"
);

const securityDocument = readText("docs/PLUGIN_SECURITY.md");
expect(
  /`shell:inline-script`\s*\|\s*严重/.test(securityDocument),
  "docs/PLUGIN_SECURITY.md must classify shell:inline-script as 严重"
);
expect(
  securityDocument.includes("唯一来源"),
  "docs/PLUGIN_SECURITY.md must document the single source of capability risk levels"
);

if (failures.length > 0) {
  console.error("Plugin security contract check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Plugin security contract check passed for ${pluginDirectories.length} plugin manifests and ${capabilityRisks.size} capabilities.`);
}
