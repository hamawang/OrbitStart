import type { OrbitItem, ResourcePathStatusReport } from "../../types";

export type ResourcePathRepairPreviewEntry = {
  item: OrbitItem;
  report?: ResourcePathStatusReport;
  replacementTarget?: string;
  eligible: boolean;
  reason?: string;
};

const repairableKinds = new Set<OrbitItem["kind"]>(["app", "file", "folder", "script"]);

export function isLocalPathResource(item: OrbitItem): boolean {
  return repairableKinds.has(item.kind);
}

/**
 * Prefix repair intentionally applies only to legacy absolute local paths.
 * Relative paths already carry a portable base and changing them would require
 * a different migration policy rather than a string replacement.
 */
export function isPathPrefixRepairable(item: OrbitItem): boolean {
  return isLocalPathResource(item) && (item.pathMode ?? "absolute") === "absolute";
}

function isDriveAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value);
}

function isUncPath(value: string): boolean {
  if (value.startsWith("\\\\?\\") || value.startsWith("\\\\.\\")) return false;
  return /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(value);
}

function trimTrailingSeparators(value: string): string {
  if (/^[a-zA-Z]:[\\/]+$/.test(value)) {
    return `${value[0]}:\\`;
  }
  if (/^\\\\[^\\/]+\\[^\\/]+\\?$/.test(value)) {
    return value.endsWith("\\") ? value : `${value}\\`;
  }
  return value.replace(/[\\/]+$/, "");
}

function hasTraversalSegment(value: string): boolean {
  return value.split(/[\\/]+/).some((segment) => segment === "." || segment === "..");
}

/**
 * Normalizes only the separator and outer whitespace for preview comparisons.
 * It deliberately does not resolve symlinks, canonicalize case, or touch the
 * filesystem; the user remains responsible for choosing the replacement root.
 */
export function normalizeAbsolutePathPrefix(value: string): string | null {
  const normalized = value.trim().replace(/\//g, "\\");
  if ((!isDriveAbsolutePath(normalized) && !isUncPath(normalized)) || hasTraversalSegment(normalized)) return null;
  return trimTrailingSeparators(normalized);
}

export function replaceAbsolutePathPrefix(
  target: string,
  oldPrefix: string,
  newPrefix: string
): string | null {
  const normalizedTarget = target.trim().replace(/\//g, "\\");
  const normalizedOldPrefix = normalizeAbsolutePathPrefix(oldPrefix);
  const normalizedNewPrefix = normalizeAbsolutePathPrefix(newPrefix);
  if (!normalizedOldPrefix || !normalizedNewPrefix || !isDriveAbsolutePath(normalizedTarget) && !isUncPath(normalizedTarget)) {
    return null;
  }

  const targetLower = normalizedTarget.toLocaleLowerCase();
  const oldLower = normalizedOldPrefix.toLocaleLowerCase();
  if (targetLower === oldLower) return normalizedNewPrefix;

  const boundaryPrefix = normalizedOldPrefix.endsWith("\\")
    ? normalizedOldPrefix
    : `${normalizedOldPrefix}\\`;
  if (!targetLower.startsWith(boundaryPrefix.toLocaleLowerCase())) return null;

  const suffix = normalizedTarget.slice(boundaryPrefix.length);
  return `${normalizedNewPrefix.replace(/[\\/]+$/, "")}\\${suffix}`;
}

export function buildResourcePathRepairPreview(
  items: readonly OrbitItem[],
  reportsById: Readonly<Record<string, ResourcePathStatusReport | undefined>>,
  oldPrefix: string,
  newPrefix: string
): ResourcePathRepairPreviewEntry[] {
  return items
    .filter(isLocalPathResource)
    .map((item) => {
      const report = reportsById[item.id];
      if (!report) {
        return { item, eligible: false, reason: "尚未检查" };
      }
      if (!isPathPrefixRepairable(item)) {
        return {
          item,
          report,
          eligible: false,
          reason: "相对路径保留其数据目录或工作区根目录，不使用前缀替换"
        };
      }
      if (report.status !== "missing") {
        return {
          item,
          report,
          eligible: false,
          reason: report.status === "network-unavailable"
            ? "网络路径暂不可用，暂不自动替换"
            : report.status === "available"
              ? "路径仍可用，无需修复"
              : "路径状态不适合自动前缀替换"
        };
      }

      const replacementTarget = replaceAbsolutePathPrefix(item.target, oldPrefix, newPrefix);
      if (!replacementTarget) {
        return {
          item,
          report,
          eligible: false,
          reason: oldPrefix.trim() && newPrefix.trim()
            ? "路径不匹配旧前缀，或前缀不是受支持的绝对路径"
            : "填写旧路径和新路径后生成预览"
        };
      }
      if (replacementTarget.toLocaleLowerCase() === item.target.trim().replace(/\//g, "\\").toLocaleLowerCase()) {
        return { item, report, eligible: false, reason: "新旧路径相同，无需修复" };
      }
      return { item, report, replacementTarget, eligible: true };
    });
}
