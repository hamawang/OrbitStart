import type { ItemKind, OrbitGroup, OrbitItem, OrbitItemInput } from "../../types";

export type ImportFilterCode = "uninstall" | "help" | "developer" | "system" | "auxiliary" | "script" | "duplicate";

export type ImportFilterReason = {
  code: ImportFilterCode;
  label: string;
};

const importFilterLabels: Record<ImportFilterCode, string> = {
  uninstall: "卸载/安装维护",
  help: "帮助/文档",
  developer: "开发/终端工具",
  system: "系统管理工具",
  auxiliary: "辅助组件",
  script: "脚本入口",
  duplicate: "重复入口"
};

const importFilterRules: Array<{ code: Exclude<ImportFilterCode, "duplicate">; pattern: RegExp }> = [
  {
    code: "uninstall",
    pattern: /\b(uninstall|uninstaller|unins\d*|remove|cleanup|repair|installer|installshield|setup wizard|modify installation)\b|卸载|安装维护|修复/
  },
  {
    code: "help",
    pattern: /\b(faq|help|documentation|manual|readme|guide|tutorial|examples?|sample|samples|docs?|user guide|getting started|revision history|release history|release notes|what'?s new|whatsnew|license|licence|changelog)\b|帮助|文档|说明|示例|手册|教程|常见问题|更新历史/
  },
  {
    code: "developer",
    pattern: /\b(application verifier|appverif|developer|debug|debuggable|sdk|windows kits?|compiler|command prompt|powershell|terminal|console|shell|cmd|visual studio.*tools|native tools|package manager|nuget|git bash|node\.js command prompt|x64 native|x86 native|cross tools|rtools|msys2?|mingw|ucrt64|bash|nvidia nsight|nsight|ncu-ui|nsys-ui|profiler|redistributable|tools for desktop apps|tools for uwp apps)\b|开发者|调试|编译器|命令提示符|终端/
  },
  {
    code: "system",
    pattern: /\b(disk defragmenter|defragment|dfrgui|event viewer|services|registry editor|regedit|odbc|component services|computer management|device manager|task scheduler|windows tools|system information|performance monitor|resource monitor|print management|memory diagnostic|recovery drive|recoverydrive)\b|磁盘碎片整理|事件查看器|注册表|任务计划|设备管理/
  },
  {
    code: "auxiliary",
    pattern: /\b(7-zip file manager|7zfm|database compare|spreadsheet compare|compare|telemetry|diagnostics?|feedback|support|configuration|configurator|configure|updater?|activation|license manager|language selector|language preferences|language settings|office language|setlang|import and export settings)\b|比较|诊断|反馈|支持|配置工具|更新程序|许可证|语言首选项|语言选项/
  }
];

function normalizeImportText(value: string): string {
  return value
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function importSearchText(item: OrbitItemInput): string {
  return normalizeImportText([item.title, item.subtitle, item.target, ...item.aliases].join(" "));
}

function importDuplicateKey(item: OrbitItemInput): string {
  return normalizeImportText(`${item.title}|${item.subtitle || item.target}`);
}

function shortcutWrapperLooksLowValue(text: string): ImportFilterCode | null {
  if (/(^|[\\/\s])(cmd|powershell|pwsh|wscript|cscript|bash|sh|msys2|mingw32|mingw64|ucrt64)\.exe\b/.test(text)) return "developer";
  if (/(^|[\\/\s])(appverif|ncu-ui|nsys-ui|nvvp|rtools|mingw32|mingw64|ucrt64)\.exe\b/.test(text)) return "developer";
  if (/(^|[\\/\s])(appvlp|dfrgui|mmc|control|rundll32|regedit|eventvwr|services|recoverydrive)\.exe\b/.test(text)) return "system";
  if (/(^|[\\/\s])(7zfm|setlang)\.exe\b/.test(text)) return "auxiliary";
  if (/\.(bat|cmd|ps1|vbs|ahk)(\s|$)/.test(text)) return "script";
  if (/\.(chm|hlp|pdf|txt|rtf|htm|html|url)(\s|$)/.test(text)) return "help";
  return null;
}

function shortcutImportFilterReason(item: OrbitItemInput): ImportFilterReason | null {
  const text = importSearchText(item);
  const wrapperCode = shortcutWrapperLooksLowValue(text);
  if (wrapperCode) return { code: wrapperCode, label: importFilterLabels[wrapperCode] };

  for (const rule of importFilterRules) {
    if (rule.pattern.test(text)) {
      return { code: rule.code, label: importFilterLabels[rule.code] };
    }
  }

  return null;
}

export function buildImportFilterReasons(kind: "shortcuts" | "bookmarks", items: OrbitItemInput[]): Map<number, ImportFilterReason> {
  const reasons = new Map<number, ImportFilterReason>();
  if (kind !== "shortcuts") return reasons;

  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = importDuplicateKey(item);
    const baseReason = shortcutImportFilterReason(item);
    const duplicateReason = key && seen.has(key) ? { code: "duplicate" as const, label: importFilterLabels.duplicate } : null;
    const reason = baseReason ?? duplicateReason;
    if (key) seen.add(key);
    if (reason) reasons.set(index, reason);
  });

  return reasons;
}

export function buildDefaultImportSelection(kind: "shortcuts" | "bookmarks", items: OrbitItemInput[]): Set<number> {
  const filteredReasons = buildImportFilterReasons(kind, items);
  const selected = new Set<number>();
  items.forEach((_, index) => {
    if (!filteredReasons.has(index)) selected.add(index);
  });
  return selected;
}

export function normalizeList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function listToText(value: string[]): string {
  return value.join(", ");
}

export function uniqueList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function splitGroupIds(value: string): string[] {
  return uniqueList(value.split(","));
}

export function joinGroupIds(values: string[]): string {
  return uniqueList(values).join(",");
}

export function mergeGroupValues(...values: string[]): string {
  return joinGroupIds(values.flatMap(splitGroupIds));
}

export function normalizeGroupValue(value: string, fallback = ""): string {
  const normalized = joinGroupIds(splitGroupIds(value));
  return normalized || fallback;
}

export function normalizeDroppedResourceGroup(groupId?: string | null): string | undefined {
  const normalized = String(groupId ?? "").trim();
  return normalized && normalized !== "all" ? normalized : undefined;
}

export function itemHasGroup(item: Pick<OrbitItem, "group">, groupId: string): boolean {
  return splitGroupIds(item.group).includes(groupId);
}

export function groupLabelsForItem(item: Pick<OrbitItem, "group">, groups: OrbitGroup[]): Array<{ id: string; title: string }> {
  const titleById = new Map(groups.map((group) => [group.id, group.title]));
  return splitGroupIds(item.group).map((id) => ({ id, title: titleById.get(id) ?? id }));
}

export function cleanSubTagSegment(value: string): string {
  return value.trim().replace(/[\\/]+/g, " ").replace(/\s+/g, " ");
}

export function cleanSubTag(value?: string | null): string {
  return String(value ?? "")
    .split(/[\\/]/)
    .map(cleanSubTagSegment)
    .filter(Boolean)
    .join("/");
}

export function subTagParts(value?: string | null): string[] {
  const cleaned = cleanSubTag(value);
  return cleaned ? cleaned.split("/") : [];
}

export function subTagLeafName(value: string): string {
  const parts = subTagParts(value);
  return parts[parts.length - 1] ?? value;
}

export function subTagDisplayName(value?: string | null): string {
  return subTagParts(value).join(" / ");
}

export type SubTagNode = {
  path: string;
  name: string;
  items: OrbitItem[];
  children: SubTagNode[];
};

export function buildSubTagTree(sourceItems: OrbitItem[], subTagOrder: string[] = []): SubTagNode[] {
  const nodeMap = new Map<string, SubTagNode>();
  const ensureNode = (path: string) => {
    const cleanPath = cleanSubTag(path);
    let node = nodeMap.get(cleanPath);
    if (!node) {
      node = { path: cleanPath, name: subTagLeafName(cleanPath), items: [], children: [] };
      nodeMap.set(cleanPath, node);
    }
    return node;
  };

  for (const item of sourceItems) {
    const parts = subTagParts(item.subTag);
    if (parts.length === 0) continue;
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      ensureNode(currentPath);
    }
    ensureNode(parts.join("/")).items.push(item);
  }

  const roots: SubTagNode[] = [];
  for (const node of nodeMap.values()) {
    const parentPath = subTagParts(node.path).slice(0, -1).join("/");
    if (!parentPath) {
      roots.push(node);
    } else {
      ensureNode(parentPath).children.push(node);
    }
  }

  const sortNodes = (nodes: SubTagNode[]) => {
    nodes.sort((a, b) => {
      const idxA = subTagOrder.indexOf(a.path);
      const idxB = subTagOrder.indexOf(b.path);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.name.localeCompare(b.name, "zh-Hans-CN");
    });
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(roots);
  return roots;
}

export function subTagNodeTotal(node: SubTagNode): number {
  return node.items.length + node.children.reduce((sum, child) => sum + subTagNodeTotal(child), 0);
}

export function visibleSubTagItems(nodes: SubTagNode[], collapsedPaths: readonly string[]): OrbitItem[] {
  const collapsed = new Set(collapsedPaths);
  const items: OrbitItem[] = [];

  const visit = (node: SubTagNode) => {
    if (collapsed.has(node.path)) return;
    items.push(...node.items);
    node.children.forEach(visit);
  };

  nodes.forEach(visit);
  return items;
}

export function inputFromItem(item: OrbitItem): OrbitItemInput {
  return {
    title: item.title,
    subtitle: item.subtitle,
    kind: item.kind,
    group: item.group,
    target: item.target,
    arguments: item.arguments ?? "",
    aliases: item.aliases,
    tags: item.tags,
    subTag: item.subTag ?? "",
    icon: item.icon,
    accent: item.accent,
    favorite: item.favorite ?? false
  };
}
