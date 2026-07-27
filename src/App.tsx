import {
  AppWindow,
  Briefcase,
  Blocks,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
  CircleDot,
  Command,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  FolderKanban,
  FolderOpen,
  FolderSearch,
  Gem,
  Globe,
  Grid3X3,
  Hammer,
  Import,
  Info,
  Image,
  LayoutDashboard,
  Lightbulb,
  NotebookText,
  Palette,
  PanelsTopLeft,
  Pencil,
  Pin,
  PinOff,
  PlusCircle,
  Power,
  Puzzle,
  RefreshCcw,
  Save,
  ScanSearch,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  TerminalSquare,
  Trash2,
  Upload,
  Workflow,
  X,
  SlidersHorizontal,
  Keyboard,
  Play,
  GripVertical
} from "lucide-react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DndContext, closestCenter, pointerWithin, rectIntersection, MouseSensor, TouchSensor, useSensor, useSensors, DragEndEvent, DragStartEvent, DragOverlay, useDroppable } from "@dnd-kit/core";
import { createPortal } from "react-dom";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable, horizontalListSortingStrategy, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { emit, listen } from "@tauri-apps/api/event";

class SmartMouseSensor extends MouseSensor {
  static activators = [
    {
      eventName: "onMouseDown" as const,
      handler: (event: any, options: any) => {
        const element = event.target as HTMLElement;
        const isSubTagHeader = element.closest(".subtag-resource-head");
        if (isSubTagHeader) {
          options.activationConstraint = {
            delay: 250,
            tolerance: 8,
          };
        } else {
          options.activationConstraint = {
            distance: 8,
          };
        }
        return MouseSensor.activators[0].handler(event, options);
      }
    }
  ];
}

class SmartTouchSensor extends TouchSensor {
  static activators = [
    {
      eventName: "onTouchStart" as const,
      handler: (event: any, options: any) => {
        const element = event.target as HTMLElement;
        const isSubTagHeader = element.closest(".subtag-resource-head");
        if (isSubTagHeader) {
          options.activationConstraint = {
            delay: 250,
            tolerance: 8,
          };
        } else {
          options.activationConstraint = {
            delay: 250,
            tolerance: 8,
          };
        }
        return TouchSensor.activators[0].handler(event, options);
      }
    }
  ];
}

import { LocalGalaxyBackdrop } from "./components/LocalGalaxyBackdrop";
import { WindowResizeEdges } from "./components/layout/WindowResizeEdges";
import { APP_VERSION } from "./appVersion";
import {
  contextMenuFromEvent,
  copyText,
  editableElementFrom,
  type ContextMenuState,
  runEditMenuCommand,
  type EditMenuCommand
} from "./desktop/contextMenu";
import { installDesktopShell } from "./desktop/desktopShell";
import { closeWindow, getAppWindow, minimizeWindow, toggleMaximizeWindow } from "./desktop/windowControls";
import { buildSortedResults, matchesItemEnhanced as scoreMatchesItem, matchesCommandEnhanced as scoreMatchesCommand, scoreItem, getPinyinInitials, recencyBonus } from "./lib/searchEngine";
import { removeItemById, upsertItemById, upsertItemsById } from "./lib/catalogState";
import { WindowRouter } from "./app/WindowRouter";
import {
  DroppableRootSection,
  SortableGroupTab,
  SortableResourceRow,
  SortableSubTagSection
} from "./features/catalog/ResourceList";
import {
  buildDefaultImportSelection,
  buildImportFilterReasons,
  buildSubTagTree,
  cleanSubTag,
  groupLabelsForItem,
  inputFromItem,
  itemHasGroup,
  joinGroupIds,
  listToText,
  mergeGroupValues,
  normalizeDroppedResourceGroup,
  normalizeGroupValue,
  normalizeList,
  splitGroupIds,
  subTagDisplayName,
  subTagNodeTotal,
  subTagParts,
  uniqueList,
  visibleSubTagItems,
  type SubTagNode
} from "./features/catalog/model";
import { tripCategoryLabels } from "./lib/tripTemplates";
import {
  shouldShowOnboarding,
  completeOnboarding,
  skipOnboarding
} from "./lib/onboarding";
import {
  addObsidianVault,
  createItem,
  createItemsFromPaths,
  createGroup,
  createCustomGroup,
  deleteGroup,
  createPluginTemplate,
  deleteItem,
  exportCatalogJson,
  importCatalogJson,
  listObsidianNoteTasks,
  listObsidianNotes,
  listObsidianTasks,
  listObsidianVaults,
  loadSnapshot,
  openObsidianNote,
  openObsidianTodoWindow,
  openAuxWindow,
  openDataDirectory,
  resetSoftware,
  pickIconImage,
  pickObsidianVaultPath,
  pickResourceInput,
  revealTarget,
  removeObsidianVault,
  scanBrowserBookmarks,
  scanObsidianVault,
  scanShortcuts,
  updateGlobalHotkey,
  previewScanShortcuts,
  previewScanBrowserBookmarks,
  importScannedItems,
  hydrateShortcutIcons,
  searchTrips,
  setTodoWindowAlwaysOnTop,
  toggleObsidianTaskCompletion,
  setActiveTheme,
  setCloseBehavior,
  setDensity,
  setPluginEnabled,
  setSafeMode,
  setAutoPinnedMode,
  setDisplayMode,
  setHotkeyBehavior,
  toggleObsidianNoteFavorite,
  tripCountForItems,
  updateItem,
  launchItem,
  getAutostartEnabled,
  setAutostartEnabled,
  reorderItems,
  reorderGroups,
  getGroupHotkeys,
  updateGroupHotkey,
  getSubTagHotkeys,
  updateSubTagHotkey,
  launchTarget,
  setBubbleSetting
} from "./lib/native";
import { createOrbitPluginHost } from "./plugin/api";
import { localGalaxyAssets } from "./theme/localGalaxyAssets";
import type {
  AppSettings,
  ItemKind,
  ObsidianNoteIndex,
  ObsidianTask,
  ObsidianVaultConfig,
  OrbitCommand,
  OrbitGroup,
  OrbitItem,
  OrbitItemInput,
  OrbitPluginManifest,
  PluginLog,
  SearchResult,
  ThemeManifest,
  TripSearchResult
} from "./types";
import type { ScenarioTag, ScenarioGroup } from "./lib/onboarding";

const appIconSrc = new URL("../design/app-icons/orbitstart-first-icon-ui.png", import.meta.url).href;
const RESOURCE_RENDER_PAGE_SIZE = 120;
const IMPORT_PREVIEW_PAGE_SIZE = 100;

const Workspaces = lazy(async () => {
  const module = await import("./components/Workspaces/Workspaces");
  return { default: module.Workspaces };
});
const TripPanel = lazy(async () => {
  const module = await import("./components/TripPanel");
  return { default: module.TripPanel };
});
const OnboardingWizard = lazy(async () => {
  const module = await import("./components/OnboardingWizard");
  return { default: module.OnboardingWizard };
});
const tripStatusLabels: Record<string, string> = {
  todo: "待处理",
  "in-progress": "进行中",
  done: "已完成",
  "needs-update": "需更新"
};

type ViewId = "dashboard" | "trips" | "obsidian" | "workspaces" | "settings" | "logs";
type SettingsSection = "general" | "workbench" | "plugins" | "themes" | "obsidian" | "dev" | "data" | "about" | "bubble";
type AuxPanel = "settings" | "plugins" | "themes" | "about";
type TodoPanelPayload = {
  noteId: string;
  vaultId?: string;
  vaultName?: string;
  relativePath?: string;
  title?: string;
};
type AppDialogState =
  | { type: "group"; value: string }
  | { type: "delete-item"; item: OrbitItem }
  | { type: "batch-delete" }
  | { type: "batch-move"; groupId: string }
  | { type: "template"; value: string }
  | { type: "group-hotkey"; groupId: string; value: string }
  | { type: "app-update"; version: string; body: string; pendingUpdate: any }
  | { type: "reset-confirm" }
  | { type: "create-subtag"; value: string; itemIds: string[] }
  | { type: "subtag-rename"; oldPath: string; value: string }
  | { type: "subtag-hotkey"; subtagPath: string; value: string }
  | { type: "subtag-delete-confirm"; subtagPath: string }
  | { type: "batch-remove-tag"; tagId: string };

function getInitialView(): ViewId {
  if (typeof window === "undefined") return "dashboard";
  const requestedView = new URLSearchParams(window.location.search).get("view") ?? window.location.hash.replace("#", "");
  return requestedView === "settings" || requestedView === "logs" || requestedView === "trips" || requestedView === "obsidian" ? requestedView : "dashboard";
}

function getAuxPanel(): AuxPanel | null {
  if (typeof window === "undefined") return null;
  const panel = new URLSearchParams(window.location.search).get("panel");
  if (panel === "settings" || panel === "plugins" || panel === "themes" || panel === "about") return panel;
  const label = getAppWindow()?.label;
  return label === "settings" || label === "plugins" || label === "themes" || label === "about" ? label : null;
}

function getTodoPanelPayload(): TodoPanelPayload | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const panel = params.get("panel");
  const label = getAppWindow()?.label;
  if (panel !== "todo" && label !== "todo-panel") return null;
  return {
    noteId: params.get("noteId") ?? "",
    vaultId: params.get("vaultId") ?? undefined,
    vaultName: params.get("vaultName") ?? undefined,
    relativePath: params.get("relativePath") ?? undefined,
    title: params.get("title") ?? undefined
  };
}

function sectionFromPanel(panel: AuxPanel | null): SettingsSection {
  if (panel === "plugins" || panel === "themes" || panel === "about") return panel;
  return "general";
}

const iconMap = {
  AppWindow,
  Blocks,
  Bookmark,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  FolderKanban,
  FolderOpen,
  FolderSearch,
  Gem,
  Globe,
  Grid3X3,
  Hammer,
  Import,
  NotebookText,
  Palette,
  PanelsTopLeft,
  PlusCircle,
  Puzzle,
  RefreshCcw,
  Save,
  ScanSearch,
  Search,
  Sparkles,
  TerminalSquare,
  Upload,
  Workflow
};

const baseKindOptions: Array<{ value: ItemKind; label: string; icon: string; group: string; accent: string; pluginId?: string }> = [
  { value: "app", label: "应用", icon: "AppWindow", group: "apps", accent: "#5cc8ff" },
  { value: "file", label: "文件", icon: "FileText", group: "work", accent: "#f6b95b" },
  { value: "folder", label: "文件夹", icon: "FolderOpen", group: "work", accent: "#8bd450" },
  { value: "website", label: "网址", icon: "Globe", group: "web", accent: "#37d6bf", pluginId: "core-websites" },
  { value: "script", label: "脚本", icon: "TerminalSquare", group: "scripts", accent: "#41e0a8" },
  { value: "action_chain", label: "动作链", icon: "Workflow", group: "work", accent: "#ff7a90", pluginId: "core-actions" }
];

type EditorState =
  | {
      mode: "create";
      input: OrbitItemInput;
    }
  | {
      mode: "edit";
      item: OrbitItem;
      input: OrbitItemInput;
    };

function Icon({ name, size = 22 }: { name: string; size?: number }) {
  if (name.startsWith("data:image/")) {
    return <img src={name} alt="" width={size} height={size} />;
  }
  const Component = iconMap[name as keyof typeof iconMap] ?? CircleDot;
  return <Component size={size} strokeWidth={1.8} />;
}

function makeEmptyInput(kind: ItemKind = "app"): OrbitItemInput {
  const option = baseKindOptions.find((candidate) => candidate.value === kind) ?? baseKindOptions[0];
  return {
    title: "",
    subtitle: "",
    kind,
    group: option.group,
    target: "",
    arguments: "",
    aliases: [],
    tags: [],
    subTag: "",
    icon: option.icon,
    accent: option.accent,
    favorite: false
  };
}

function dropGroupIdFromElement(target: EventTarget | Element | null) {
  const element = target instanceof Element ? target : null;
  return element?.closest<HTMLElement>("[data-resource-drop-group-id]")?.dataset.resourceDropGroupId ?? null;
}

function dropGroupIdAtPoint(x: number, y: number) {
  return dropGroupIdFromElement(document.elementFromPoint(x, y));
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function matchesItem(item: OrbitItem, query: string) {
  return scoreMatchesItem(item, query);
}

function matchesCommand(command: OrbitCommand, query: string) {
  return scoreMatchesCommand(command, query);
}

function lastLaunchedText(item: OrbitItem) {
  if (!item.lastLaunchedAt) return "未启动";
  const seconds = Number(item.lastLaunchedAt);
  if (!Number.isFinite(seconds)) return item.lastLaunchedAt;
  const delta = Math.max(0, Math.floor(Date.now() / 1000 - seconds));
  if (delta < 60) return "刚刚";
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} 小时前`;
  return `${Math.floor(delta / 86400)} 天前`;
}

function pluginDetail(plugin: OrbitPluginManifest) {
  const samples: Record<string, { author: string; features: string[]; demo: string }> = {
    "core-shortcuts": {
      author: "OrbitStart Core",
      features: ["扫描桌面和开始菜单", "解析 .lnk 目标", "提取应用图标", "保留快捷方式启动路径"],
      demo: "扫描后首页会出现带真实图标的软件卡片。"
    },
    "core-themes": {
      author: "OrbitStart Core",
      features: ["主题 token", "实时切换", "本地主题包", "主题 JSON 复制"],
      demo: "选择任意主题后，界面会即时应用对应的颜色、层级和密度变量。"
    },
    "core-plugin-dev": {
      author: "OrbitStart Core",
      features: ["插件模板", "manifest 校验", "本地打包", "开发文档"],
      demo: "创建 Hello Command 后会在插件目录生成 plugin.json 和 main.ts。"
    },
    "hello-command": {
      author: "Local Plugin Template",
      features: ["命令注册", "搜索结果展示", "通知反馈"],
      demo: "在命令面板搜索 hello，可看到本地插件命令。"
    },
    "tips-search": {
      author: "OrbitStart Local Plugin",
      features: ["Tip 内容搜索", "命令面板入口", "打开资源 TipPanel"],
      demo: "在命令面板输入 Tip 内容关键词，可直接跳到对应资源提示。"
    }
  };

  return samples[plugin.id] ?? {
    author: plugin.builtin ? "OrbitStart Core" : "Local plugin author",
    features: [
      `${plugin.contributes.commands} commands`,
      `${plugin.contributes.searchProviders} search providers`,
      `${plugin.contributes.themes} themes`,
      `${plugin.contributes.views} views`
    ],
    demo: plugin.description
  };
}

function debounce<T extends (...args: any[]) => void>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: number | null = null;
  return (...args: Parameters<T>) => {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = window.setTimeout(() => {
      func(...args);
    }, wait);
  };
}

interface SortableKpiCardProps {
  id: string;
  children: React.ReactNode;
}

function SortableKpiCard({ id, children }: SortableKpiCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: id,
  });

  const style: CSSProperties = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: "grab",
    userSelect: "none",
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`kpi-card workbench-kpi-card ${isDragging ? "dragging" : ""}`}
      {...attributes}
      {...listeners}
    >
      {children}
    </article>
  );
}

interface SortableActionButtonProps {
  id: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

function SortableActionButton({ id, onClick, disabled, children }: SortableActionButtonProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: id,
  });

  const style: CSSProperties = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: "grab",
    userSelect: "none",
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      className={`wide-command ${isDragging ? "dragging" : ""}`}
      onClick={(e) => {
        if (isDragging) return;
        onClick();
      }}
      disabled={disabled}
      {...attributes}
      {...listeners}
    >
      {children}
    </button>
  );
}

export default function App() {
  return <WindowRouter renderMain={(windowLabel) => <MainApp windowLabel={windowLabel} />} />;
}

interface MainAppProps {
  windowLabel: string;
}

export function MainApp({ windowLabel }: MainAppProps) {
  const auxPanel = useMemo(() => {
    const panel = new URLSearchParams(window.location.search).get("panel");
    if (panel === "settings" || panel === "plugins" || panel === "themes" || panel === "about") return panel;
    return windowLabel === "settings" || windowLabel === "plugins" || windowLabel === "themes" || windowLabel === "about" ? windowLabel : null;
  }, [windowLabel]);

  const isAuxWindow = Boolean(auxPanel);

  const initialTodoPanelPayload = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const panel = params.get("panel");
    if (panel !== "todo" && windowLabel !== "todo-panel") return null;
    return {
      noteId: params.get("noteId") ?? "",
      vaultId: params.get("vaultId") ?? undefined,
      vaultName: params.get("vaultName") ?? undefined,
      relativePath: params.get("relativePath") ?? undefined,
      title: params.get("title") ?? undefined
    };
  }, [windowLabel]);

  const isTodoPanelWindow = Boolean(initialTodoPanelPayload);
  const isBubbleWindow = false;
  const [items, setItems] = useState<OrbitItem[]>([]);
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [groups, setGroups] = useState<OrbitGroup[]>([]);
  const [commands, setCommands] = useState<OrbitCommand[]>([]);
  const [plugins, setPlugins] = useState<OrbitPluginManifest[]>([]);
  const [themes, setThemes] = useState<ThemeManifest[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [bubbleOpacityDraft, setBubbleOpacityDraft] = useState<number | null>(null);
  const [logs, setLogs] = useState<PluginLog[]>([]);
  const [activeView, setActiveView] = useState<ViewId>(getInitialView);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() => sectionFromPanel(auxPanel));
  const [activeGroup, setActiveGroup] = useState("all");
  const [collapsedSubTagPaths, setCollapsedSubTagPaths] = useState<string[]>([]);
  const [hideWorkbench, setHideWorkbench] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("orbitstart.dashboard.hide_workbench") === "true";
  });
  const [query, setQuery] = useState("");
  const [resourceRenderLimit, setResourceRenderLimit] = useState(RESOURCE_RENDER_PAGE_SIZE);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [pluginResults, setPluginResults] = useState<SearchResult[]>([]);
  const [paletteSelectedIndex, setPaletteSelectedIndex] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(() => shouldShowOnboarding());
  const [toast, setToast] = useState("OrbitStart：正在加载本地工作台状态");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupJson, setBackupJson] = useState("");
  const [backupPath, setBackupPath] = useState("");
  const [dialog, setDialog] = useState<AppDialogState | null>(null);
  const [subTagSelectModal, setSubTagSelectModal] = useState<{
    isOpen: boolean;
    currentValue: string;
    onSelect: (tag: string) => void;
  } | null>(null);
  const [subTagSelectSearch, setSubTagSelectSearch] = useState("");

  const [subTagOrder, setSubTagOrder] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("storedSubTagOrder");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("storedSubTagOrder", JSON.stringify(subTagOrder));
  }, [subTagOrder]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    listen<string>("orbit://bubble-error", (event) => {
      setToast(event.payload);
    }).then((dispose) => {
      unlisten = dispose;
    }).catch(console.error);
    return () => unlisten?.();
  }, []);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updatingState, setUpdatingState] = useState<"idle" | "downloading" | "applying">("idle");
  const [isCheckingForUpdate, setIsCheckingForUpdate] = useState(false);
  const [localAuxPanel, setLocalAuxPanel] = useState<AuxPanel | null>(null);
  const [busy, setBusy] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [batchGroup, setBatchGroup] = useState("apps");
  const [selectedPlugin, setSelectedPlugin] = useState<OrbitPluginManifest | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [externalDropGroupId, setExternalDropGroupId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [autostartState, setAutostartState] = useState(false);
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [commandBarQuery, setCommandBarQuery] = useState("");
  const [commandBarSelectedIndex, setCommandBarSelectedIndex] = useState(0);
  const [isRecordingHotkey, setIsRecordingHotkey] = useState(false);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [tripCounts, setTripCounts] = useState<Record<string, number>>({});
  const [tripPanelItem, setTripPanelItem] = useState<OrbitItem | null>(null);
  const [tripPanelHighlightId, setTripPanelHighlightId] = useState<string | null>(null);
  const [tripsQuery, setTripsQuery] = useState("");
  const [tripSearchResults, setTripSearchResults] = useState<TripSearchResult[]>([]);
  const [obsidianVaults, setObsidianVaults] = useState<ObsidianVaultConfig[]>([]);
  const [obsidianTasks, setObsidianTasks] = useState<ObsidianTask[]>([]);
  const [obsidianNotes, setObsidianNotes] = useState<ObsidianNoteIndex[]>([]);
  const [activeObsidianVault, setActiveObsidianVault] = useState("all");
  const [obsidianQuery, setObsidianQuery] = useState("");
  const [obsidianScanningId, setObsidianScanningId] = useState<string | null>(null);
  const [todoPanelPayload, setTodoPanelPayload] = useState<TodoPanelPayload>(initialTodoPanelPayload ?? { noteId: "" });
  const [todoPanelTasks, setTodoPanelTasks] = useState<ObsidianTask[]>([]);
  const [todoPanelPinned, setTodoPanelPinned] = useState(false);
  const [todoPanelLoading, setTodoPanelLoading] = useState(false);

  const [workbenchStatisticsOrder, setWorkbenchStatisticsOrder] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("storedWorkbenchStatisticsOrder");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length === 4) return parsed;
      }
    } catch {}
    return ["items_count", "enabled_plugins", "active_theme", "safe_mode"];
  });

  const [workbenchActionsOrder, setWorkbenchActionsOrder] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("storedWorkbenchActionsOrder");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length === 5) return parsed;
      }
    } catch {}
    return ["new_group", "scan_programs", "import_bookmarks", "export_backup", "open_command_panel"];
  });

  useEffect(() => {
    localStorage.setItem("storedWorkbenchStatisticsOrder", JSON.stringify(workbenchStatisticsOrder));
  }, [workbenchStatisticsOrder]);

  useEffect(() => {
    localStorage.setItem("storedWorkbenchActionsOrder", JSON.stringify(workbenchActionsOrder));
  }, [workbenchActionsOrder]);

  const hotkeyInputRef = useRef<HTMLInputElement>(null);

  const [importPreview, setImportPreview] = useState<{
    kind: "shortcuts" | "bookmarks";
    items: OrbitItemInput[];
    selectedIndices: Set<number>;
    searchQuery: string;
    visibleCount: number;
    onClose?: () => void;
  } | null>(null);
  const [pluginHostRevision, setPluginHostRevision] = useState(0);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const commandBarInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLElement>(null);
  const contextEditTargetRef = useRef<HTMLElement | null>(null);
  const lastPointerRef = useRef({ x: 24, y: 24 });
  const dropInProgressRef = useRef(false);
  const activeGroupRef = useRef(activeGroup);

  useEffect(() => {
    activeGroupRef.current = activeGroup;
  }, [activeGroup]);

  const [hotkeysBoundToGroup, setHotkeysBoundToGroup] = useState<Record<string, string>>({});
  const [hotkeysBoundToSubTag, setHotkeysBoundToSubTag] = useState<Record<string, string>>({});
  const [groupDragActiveId, setGroupDragActiveId] = useState<string | null>(null);

  const pluginStateReady = plugins.length > 0;
  const pluginEnabled = (id: string) => plugins.some((plugin) => plugin.id === id && plugin.enabled);
  const hotkeyBinderEnabled = pluginEnabled("hotkey-binder");

  const fetchGroupHotkeys = async () => {
    try {
      const keys = await getGroupHotkeys();
      setHotkeysBoundToGroup(keys);
    } catch (e) {
      console.error("Failed to load group hotkeys", e);
    }
  };

  const fetchSubTagHotkeys = async () => {
    try {
      const keys = await getSubTagHotkeys();
      setHotkeysBoundToSubTag(keys);
    } catch (e) {
      console.error("Failed to load subtag hotkeys", e);
    }
  };

  useEffect(() => {
    if (hotkeyBinderEnabled) {
      void fetchGroupHotkeys();
      void fetchSubTagHotkeys();
    } else {
      setHotkeysBoundToGroup({});
      setHotkeysBoundToSubTag({});
    }
  }, [hotkeyBinderEnabled]);

  const handleGroupDragStart = (event: DragStartEvent) => {
    setGroupDragActiveId(event.active.id as string);
  };

  const handleGroupDragEnd = (event: DragEndEvent) => {
    setGroupDragActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setGroups((prev) => {
      const oldIndex = prev.findIndex((g) => g.id === active.id);
      const newIndex = prev.findIndex((g) => g.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      void reorderGroups(next.map((g) => g.id)).then((updatedGroups) => {
        setGroups(updatedGroups);
      }).catch((err) => {
        console.error("Failed to reorder groups:", err);
      });
      return next;
    });
  };

  const handleGroupDragCancel = () => {
    setGroupDragActiveId(null);
  };

  const restrictToHorizontalAxis = ({ transform }: any) => ({
    ...transform,
    y: 0,
  });

  const handleGroupHotkeyKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setDialog(null);
      return;
    }

    if (event.key === "Backspace") {
      if (dialog?.type === "group-hotkey") {
        setBusy(true);
        void updateGroupHotkey(dialog.groupId, null).then(async () => {
          const group = groups.find((g) => g.id === dialog.groupId);
          setToast(`分组「${group?.title}」已解除快捷键绑定`);
          setDialog(null);
          const keys = await getGroupHotkeys();
          setHotkeysBoundToGroup(keys);
        }).catch((error) => {
          setToast(`解除绑定失败：${String(error)}`);
        }).finally(() => {
          setBusy(false);
        });
      }
      return;
    }

    const key = event.key;
    const isModifier = ["Control", "Alt", "Shift", "Meta", "OS"].includes(key);

    const keys: string[] = [];
    if (event.ctrlKey) keys.push("Ctrl");
    if (event.altKey) keys.push("Alt");
    if (event.shiftKey) keys.push("Shift");
    if (event.metaKey) keys.push("Win");

    if (!isModifier) {
      let keyName = key;
      if (keyName === " ") keyName = "Space";
      if (keyName.length === 1) {
        keyName = keyName.toUpperCase();
      } else {
        keyName = keyName.charAt(0).toUpperCase() + keyName.slice(1);
      }
      if (!keys.includes(keyName)) {
        keys.push(keyName);
      }
    }

    const combination = keys.slice(0, 4).join("+");
    setDialog((prev) => prev?.type === "group-hotkey" ? { ...prev, value: combination } : prev);
  };

  const handleGroupHotkeyKeyUp = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (dialog?.type === "group-hotkey" && dialog.value) {
      const parts = dialog.value.split("+");
      const hasMainKey = parts.length > 0 && !["Ctrl", "Alt", "Shift", "Win"].includes(parts[parts.length - 1]);

      if (hasMainKey) {
        setBusy(true);
        try {
          const group = groups.find((g) => g.id === dialog.groupId);
          await updateGroupHotkey(dialog.groupId, dialog.value);
          setToast(`分组「${group?.title}」已绑定快捷键：${dialog.value}`);
          setDialog(null);
          const keysList = await getGroupHotkeys();
          setHotkeysBoundToGroup(keysList);
        } catch (error) {
          setToast(`绑定失败：${String(error)}`);
        } finally {
          setBusy(false);
        }
      }
    }
  };
  const handleSubTagHotkeyKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setDialog(null);
      return;
    }

    if (event.key === "Backspace") {
      if (dialog?.type === "subtag-hotkey") {
        setBusy(true);
        void updateSubTagHotkey(dialog.subtagPath, null).then(async () => {
          setToast(`子目录「${dialog.subtagPath}」已解除快捷键绑定`);
          setDialog(null);
          await fetchSubTagHotkeys();
        }).catch((error) => {
          setToast(`解除绑定失败：${String(error)}`);
        }).finally(() => {
          setBusy(false);
        });
      }
      return;
    }

    const key = event.key;
    const isModifier = ["Control", "Alt", "Shift", "Meta", "OS"].includes(key);

    const keys: string[] = [];
    if (event.ctrlKey) keys.push("Ctrl");
    if (event.altKey) keys.push("Alt");
    if (event.shiftKey) keys.push("Shift");
    if (event.metaKey) keys.push("Win");

    if (!isModifier) {
      let keyName = key;
      if (keyName === " ") keyName = "Space";
      if (keyName.length === 1) {
        keyName = keyName.toUpperCase();
      } else {
        keyName = keyName.charAt(0).toUpperCase() + keyName.slice(1);
      }
      if (!keys.includes(keyName)) {
        keys.push(keyName);
      }
    }

    const combination = keys.slice(0, 4).join("+");
    setDialog((prev) => prev?.type === "subtag-hotkey" ? { ...prev, value: combination } : prev);
  };

  const handleSubTagHotkeyKeyUp = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (dialog?.type === "subtag-hotkey" && dialog.value) {
      const parts = dialog.value.split("+");
      const hasMainKey = parts.length > 0 && !["Ctrl", "Alt", "Shift", "Win"].includes(parts[parts.length - 1]);

      if (hasMainKey) {
        setBusy(true);
        try {
          await updateSubTagHotkey(dialog.subtagPath, dialog.value);
          setToast(`子目录「${dialog.subtagPath}」已绑定快捷键：${dialog.value}`);
          setDialog(null);
          await fetchSubTagHotkeys();
        } catch (error) {
          setToast(`绑定失败：${String(error)}`);
        } finally {
          setBusy(false);
        }
      }
    }
  };

  const checkForUpdates = async (manual: boolean) => {
    if (!isTauriRuntime()) {
      if (manual) {
        setToast("当前处于浏览器开发环境，无法执行自动更新。");
      }
      return;
    }
    setIsCheckingForUpdate(true);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        setDialog({
          type: "app-update",
          version: update.version,
          body: update.body || "",
          pendingUpdate: update,
        });
      } else {
        if (manual) {
          setToast(`当前已是最新版本 (v${APP_VERSION})`);
        }
      }
    } catch (err) {
      console.error("Failed to check for updates:", err);
      if (manual) {
        setToast(`检查更新失败：${String(err)}`);
      }
    } finally {
      setIsCheckingForUpdate(false);
    }
  };

  const startAppUpdate = async (pendingUpdate: any) => {
    setUpdateProgress(0);
    setUpdatingState("downloading");
    try {
      let downloaded = 0;
      let contentLength = 0;
      await pendingUpdate.downloadAndInstall((event: any) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength || 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setUpdateProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case "Finished":
            setUpdatingState("applying");
            break;
        }
      });
      setToast("更新包下载完成，应用即将自动重启...");
      setTimeout(async () => {
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      }, 1500);
    } catch (err) {
      console.error("Failed to download and install update:", err);
      setToast(`下载更新失败：${String(err)}`);
      setUpdatingState("idle");
    }
  };

  const isLite = import.meta.env.VITE_APP_LITE === "true";
  const tripsFeatureEnabled = !isLite && (!pluginStateReady || pluginEnabled("tips-search"));
  const obsidianFeatureEnabled = !isLite && (!pluginStateReady || (pluginEnabled("core-obsidian") && pluginEnabled("obsidian-search")));
  const workspacesFeatureEnabled = !isLite && (!pluginStateReady || pluginEnabled("workspaces"));
  const effectivePlugins = useMemo(
    () => plugins.map((plugin) => {
      if (plugin.id === "obsidian-search" && !obsidianFeatureEnabled) {
        return { ...plugin, enabled: false };
      }
      return plugin;
    }),
    [plugins, obsidianFeatureEnabled]
  );
  const pluginHost = useMemo(() => createOrbitPluginHost(effectivePlugins), [effectivePlugins]);

  useEffect(() => {
    if (isTauriRuntime()) {
      void getAutostartEnabled()
        .then(setAutostartState)
        .catch((error) => {
          console.error("Failed to read autostart state:", error);
          setToast(`无法读取开机启动状态：${String(error)}`);
        });
    }
  }, []);

  useEffect(() => {
    if (isTodoPanelWindow) {
      document.body.classList.add("todo-body");
    } else {
      document.body.classList.remove("todo-body");
    }
  }, [isTodoPanelWindow]);

  useEffect(() => {
    if (isAuxWindow) {
      document.body.classList.add("aux-body");
    } else {
      document.body.classList.remove("aux-body");
    }
  }, [isAuxWindow]);

  useEffect(() => {
    if (isBubbleWindow) {
      document.body.classList.add("bubble-body");
      document.documentElement.classList.add("bubble-html");
    } else {
      document.body.classList.remove("bubble-body");
      document.documentElement.classList.remove("bubble-html");
    }
  }, [isBubbleWindow]);

  useEffect(() => {
    setLocalOrder(items.map((item) => item.id));
  }, [items]);

  const debouncedReorder = useMemo(
    () =>
      debounce(async (orderedIds: string[]) => {
        try {
          await reorderItems(orderedIds);
        } catch (error) {
          console.error("Failed to persist reorder:", error);
        }
      }, 300),
    []
  );

  const sensors = useSensors(
    useSensor(SmartMouseSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(SmartTouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 8,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const customCollisionDetection = (args: any) => {
    // 1. Get collisions from both pointerWithin and rectIntersection
    const pointerCollisions = pointerWithin(args);
    const rectCollisions = rectIntersection(args);
    
    // Merge them to ensure active card overlap is detected even if mouse pointer is outside
    let collisions = [...pointerCollisions];
    for (const rc of rectCollisions) {
      if (!collisions.some((c) => c.id === rc.id)) {
        collisions.push(rc);
      }
    }
    
    // Fall back to closestCenter if no collisions found
    if (collisions.length === 0) {
      collisions = closestCenter(args);
    }
    
    if (collisions.length === 0) return [];
    
    const resolvedCollisions = [...collisions];
    const activeId = args.active.id;
    const activeItem = items.find((item) => item.id === activeId);
    const activeSubTag = activeItem ? (activeItem.subTag || "") : "";
    
    for (const collision of collisions) {
      const collisionIdStr = String(collision.id);
      
      // If it's a resource card collision
      if (!collisionIdStr.startsWith("droppable-subtag-")) {
        const collidedItem = items.find((item) => item.id === collisionIdStr);
        if (collidedItem) {
          const itemSubTag = collidedItem.subTag || "";
          
          // Only trigger overlay if it is a DIFFERENT directory
          if (itemSubTag !== activeSubTag) {
            const parentContainerId = itemSubTag === "" 
              ? "droppable-subtag-root" 
              : `droppable-subtag-${itemSubTag}`;
            
            // Add the parent container to the collisions list if not already present
            if (!resolvedCollisions.some((c) => c.id === parentContainerId)) {
              const parentContainer = args.droppableContainers.find((c: any) => c.id === parentContainerId);
              if (parentContainer) {
                resolvedCollisions.push({
                  id: parentContainerId,
                  data: { droppableContainer: parentContainer }
                });
              }
            }
          }
        }
      } else {
        // If it's a directory container collision directly,
        // we should check if it's the active item's own directory.
        const targetSubTag = collisionIdStr === "droppable-subtag-root" 
          ? "" 
          : collisionIdStr.replace("droppable-subtag-", "");
          
        if (targetSubTag === activeSubTag) {
          // It's the same directory, remove it from resolvedCollisions so it doesn't show the overlay
          const index = resolvedCollisions.findIndex((c) => c.id === collisionIdStr);
          if (index !== -1) {
            resolvedCollisions.splice(index, 1);
          }
        }
      }
    }
    
    return resolvedCollisions;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const activeIdStr = active.id as string;
    const overIdStr = over.id as string;

    // Sub-directory drag sorting
    if (activeIdStr.startsWith("subtag-sortable-")) {
      const activePath = activeIdStr.replace("subtag-sortable-", "");
      let overPath = overIdStr.startsWith("subtag-sortable-")
        ? overIdStr.replace("subtag-sortable-", "")
        : overIdStr.startsWith("droppable-subtag-")
        ? overIdStr.replace("droppable-subtag-", "")
        : "";

      if (!overPath) {
        const overItem = items.find((item) => item.id === overIdStr);
        if (overItem && overItem.subTag) {
          overPath = overItem.subTag;
        }
      }

      if (overPath && activePath !== overPath) {
        setSubTagOrder((prev) => {
          const currentOrder = [...prev];
          if (!currentOrder.includes(activePath)) {
            currentOrder.push(activePath);
          }
          if (!currentOrder.includes(overPath)) {
            currentOrder.push(overPath);
          }
          const oldIndex = currentOrder.indexOf(activePath);
          const newIndex = currentOrder.indexOf(overPath);
          if (oldIndex === -1 || newIndex === -1) return prev;
          return arrayMove(currentOrder, oldIndex, newIndex);
        });
      }
      return;
    }

    // 1. Drop resource card on a subtag target (either droppable or sortable subtag ID)
    if (!activeIdStr.startsWith("subtag-sortable-")) {
      let targetSubTag: string | null = null;
      if (overIdStr.startsWith("droppable-subtag-")) {
        targetSubTag = overIdStr === "droppable-subtag-root" ? "" : overIdStr.replace("droppable-subtag-", "");
      } else if (overIdStr.startsWith("subtag-sortable-")) {
        targetSubTag = overIdStr.replace("subtag-sortable-", "");
      }

      if (targetSubTag !== null) {
        const activeItem = items.find((item) => item.id === activeIdStr);
        if (activeItem && (activeItem.subTag || "") !== targetSubTag) {
          setBusy(true);
          updateItem({ ...activeItem, subTag: targetSubTag })
            .then((updated) => applyItemUpdate(updated))
            .catch((err) => setToast(`移动失败: ${String(err)}`))
            .finally(() => setBusy(false));
        }
        return;
      }
    }

    // 2. Drop on another card belonging to a different subTag
    const activeItem = items.find((item) => item.id === activeIdStr);
    const overItem = items.find((item) => item.id === overIdStr);
    if (activeItem && overItem && (activeItem.subTag || "") !== (overItem.subTag || "")) {
      const targetSubTag = overItem.subTag || "";
      setBusy(true);
      updateItem({ ...activeItem, subTag: targetSubTag })
        .then((updated) => applyItemUpdate(updated))
        .catch((err) => setToast(`移动失败: ${String(err)}`))
        .finally(() => setBusy(false));
      return;
    }

    // 3. Drop on another card within the same subTag (local sorting)
    if (activeIdStr === overIdStr) return;
    setLocalOrder((prev) => {
      const oldIndex = prev.indexOf(activeIdStr);
      const newIndex = prev.indexOf(overIdStr);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      void debouncedReorder(next);
      return next;
    });
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  const handleStatisticsDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setWorkbenchStatisticsOrder((prev) => {
      const oldIndex = prev.indexOf(active.id as string);
      const newIndex = prev.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const handleActionsDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setWorkbenchActionsOrder((prev) => {
      const oldIndex = prev.indexOf(active.id as string);
      const newIndex = prev.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  function applySnapshot(snapshot: Awaited<ReturnType<typeof loadSnapshot>>) {
    setItems(snapshot.items);
    setGroups(snapshot.groups);
    setCommands(snapshot.commands);
    setPlugins(snapshot.plugins);
    setThemes(snapshot.themes);
    setSettings(snapshot.settings);
    setLogs(snapshot.logs);
  }

  function applyItemUpdate(item: OrbitItem) {
    setItems((previous) => upsertItemById(previous, item));
  }

  function applyItemDeletion(id: string) {
    setItems((previous) => removeItemById(previous, id));
    setTripCounts((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }

  async function reload() {
    const snapshot = await loadSnapshot();
    applySnapshot(snapshot);
    if (snapshot.plugins.some((p) => p.id === "hotkey-binder" && p.enabled)) {
      void fetchGroupHotkeys();
    } else {
      setHotkeysBoundToGroup({});
    }
    return snapshot;
  }

  async function refreshTripCounts(scopeItems = items) {
    if (scopeItems.length === 0) {
      setTripCounts({});
      return;
    }
    const counts = await tripCountForItems(scopeItems.map((item) => item.id));
    setTripCounts(counts);
  }

  async function refreshTripSearch(queryText = tripsQuery) {
    const results = await searchTrips(queryText);
    setTripSearchResults(results);
  }

  async function handleTripsChanged() {
    await refreshTripCounts();
    await refreshTripSearch();
  }

  async function refreshObsidian(queryText = obsidianQuery, vaultId = activeObsidianVault) {
    const [vaultList, taskList, noteList] = await Promise.all([
      listObsidianVaults(),
      listObsidianTasks({ includeCompleted: false, query: queryText }),
      listObsidianNotes({ vaultId: vaultId === "all" ? undefined : vaultId, query: queryText })
    ]);
    setObsidianVaults(vaultList);
    setObsidianTasks(taskList);
    setObsidianNotes(noteList);
  }

  async function handleObsidianChanged() {
    await refreshObsidian();
  }

  useEffect(() => {
    reload().catch((error) => setToast(`加载失败：${String(error)}`));
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    const disposers: Array<() => void> = [];

    void Promise.all([
      listen<OrbitItem>("orbit://item-created", (event) => applyItemUpdate(event.payload)),
      listen<OrbitItem>("orbit://item-updated", (event) => applyItemUpdate(event.payload)),
      listen<{ id: string }>("orbit://item-deleted", (event) => applyItemDeletion(event.payload.id)),
      listen<AppSettings>("orbit://settings-updated", (event) => setSettings(event.payload))
    ])
      .then((nextDisposers) => {
        if (disposed) {
          nextDisposers.forEach((dispose) => dispose());
        } else {
          disposers.push(...nextDisposers);
        }
      })
      .catch((error) => console.error("Failed to subscribe to catalog item events", error));

    return () => {
      disposed = true;
      disposers.splice(0).forEach((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    if (!tripsFeatureEnabled) {
      setTripCounts({});
      return;
    }
    refreshTripCounts(items).catch((error) => console.warn("Failed to load trip counts", error));
  }, [items, tripsFeatureEnabled]);

  useEffect(() => {
    if (!tripsFeatureEnabled) {
      setTripSearchResults([]);
      return;
    }
    refreshTripSearch(tripsQuery).catch((error) => console.warn("Failed to search trips", error));
  }, [tripsQuery, tripsFeatureEnabled]);

  useEffect(() => {
    if (!obsidianFeatureEnabled) {
      setObsidianVaults([]);
      setObsidianTasks([]);
      setObsidianNotes([]);
      return;
    }
    refreshObsidian(obsidianQuery, activeObsidianVault).catch((error) => console.warn("Failed to load Obsidian index", error));
  }, [obsidianQuery, activeObsidianVault, obsidianFeatureEnabled]);

  useEffect(() => {
    if (!pluginStateReady) return;
    if (activeView === "trips" && !tripsFeatureEnabled) {
      setActiveView("dashboard");
      setTripPanelItem(null);
      setTripPanelHighlightId(null);
    }
    if (activeView === "obsidian" && !obsidianFeatureEnabled) {
      setActiveView("dashboard");
    }
  }, [activeView, pluginStateReady, tripsFeatureEnabled, obsidianFeatureEnabled]);

  useEffect(() => {
    if (!pluginStateReady) return;
    if (settingsSection === "obsidian" && !obsidianFeatureEnabled) {
      setSettingsSection("plugins");
    }
  }, [settingsSection, pluginStateReady, obsidianFeatureEnabled]);

  useEffect(() => {
    const onToast = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      setToast(message);
    };
    window.addEventListener("orbit-toast", onToast);
    return () => window.removeEventListener("orbit-toast", onToast);
  }, []);

  useEffect(() => {
    const onOpenTrip = (event: Event) => {
      if (!tripsFeatureEnabled) {
        setToast("Tips 插件已停用，可在插件管理中重新启用。");
        return;
      }
      const detail = (event as CustomEvent<{ itemId: string; tripId?: string }>).detail;
      if (!detail.itemId) {
        setActiveView("trips");
        return;
      }
      const item = items.find((candidate) => candidate.id === detail.itemId);
      if (!item) {
        setToast("未找到关联资源");
        return;
      }
      setActiveView("trips");
      setTripPanelItem(item);
      setTripPanelHighlightId(detail.tripId ?? null);
    };
    window.addEventListener("orbit-open-trip", onOpenTrip);
    return () => window.removeEventListener("orbit-open-trip", onOpenTrip);
  }, [items, tripsFeatureEnabled]);

  useEffect(() => {
    const onOpenObsidian = () => {
      if (!obsidianFeatureEnabled) {
        setToast("Obsidian 插件已停用，可在插件管理中重新启用。");
        return;
      }
      setActiveView("obsidian");
    };
    const onObsidianChanged = () => {
      if (!obsidianFeatureEnabled) return;
      void handleObsidianChanged();
    };
    window.addEventListener("orbit-open-obsidian", onOpenObsidian);
    window.addEventListener("orbit://obsidian-changed", onObsidianChanged);
    return () => {
      window.removeEventListener("orbit-open-obsidian", onOpenObsidian);
      window.removeEventListener("orbit://obsidian-changed", onObsidianChanged);
    };
  }, [obsidianQuery, activeObsidianVault, obsidianFeatureEnabled]);

  useEffect(() => {
    if (!isTodoPanelWindow || !todoPanelPayload.noteId) return;
    let cancelled = false;
    setTodoPanelLoading(true);
    listObsidianNoteTasks(todoPanelPayload.noteId)
      .then((tasks) => {
        if (!cancelled) setTodoPanelTasks(tasks);
      })
      .catch((error) => {
        if (!cancelled) {
          setTodoPanelTasks([]);
          setToast(`读取待办失败：${String(error)}`);
        }
      })
      .finally(() => {
        if (!cancelled) setTodoPanelLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isTodoPanelWindow, todoPanelPayload.noteId]);

  useEffect(() => {
    if (!isTodoPanelWindow || !isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen<TodoPanelPayload>("orbit://todo-note", (event) => {
        setTodoPanelPayload(event.payload);
      }))
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
        } else {
          unlisten = nextUnlisten;
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isTodoPanelWindow]);

  useEffect(() => {
    if (isTodoPanelWindow || isAuxWindow || isBubbleWindow || !isTauriRuntime()) return;
    
    let unlisten: (() => void) | undefined;
    let disposed = false;
    
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen<string>("orbit://bubble-action", (event) => {
        const action = event.payload;
        if (action === "search") {
          setActiveView("dashboard");
          setActiveGroup("all");
          setQuery("");
          requestAnimationFrame(() => searchInputRef.current?.focus());
        } else if (action === "add-resource") {
          setActiveView("dashboard");
          setEditor({ mode: "create", input: makeEmptyInput() });
        } else if (action === "workspace") {
          setActiveView("dashboard");
          setActiveGroup("all");
        } else if (action === "recent") {
          setActiveView("dashboard");
          setActiveGroup("all");
          setQuery("");
        } else if (action === "settings") {
          void openPanelWindow("settings");
        }
      }))
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
        } else {
          unlisten = nextUnlisten;
        }
      })
      .catch((err) => console.error("Failed to setup bubble action listener", err));
      
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isTodoPanelWindow, isAuxWindow, isBubbleWindow]);

  useEffect(() => {
    if (isTodoPanelWindow || isAuxWindow || isBubbleWindow || !isTauriRuntime()) return;
    
    let unlisten: (() => void) | undefined;
    let disposed = false;
    
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen<string>("orbit://run-workspace", (event) => {
        const wsId = event.payload;
        if (wsId) {
          void launchWorkspaceFromDashboard(wsId);
        }
      }))
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
        } else {
          unlisten = nextUnlisten;
        }
      })
      .catch((err) => console.error("Failed to setup global workspace run listener", err));
      
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isTodoPanelWindow, isAuxWindow, isBubbleWindow, pluginHost]);


  function focusSearch() {
    setActiveView("dashboard");
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function closeTransientUi() {
    setPaletteOpen(false);
    setCommandBarOpen(false);
    setEditor(null);
    setBackupOpen(false);
    setDialog(null);
    setSelectedPlugin(null);
    setContextMenu(null);
  }

  const openCommandBar = () => {
    setCommandBarQuery("");
    setCommandBarSelectedIndex(0);
    setCommandBarOpen(true);
  };

  useEffect(() => {
    return installDesktopShell({
      closeTransientUi,
      focusSearch,
      openCommandPalette: () => setPaletteOpen(true),
      openCommandBar: () => {
        closeTransientUi();
        openCommandBar();
      },
      openSettings: () => {
        setLocalAuxPanel("settings");
        setSettingsSection("general");
      },
      openPanel: (panel) => {
        setLocalAuxPanel(panel as AuxPanel);
        setSettingsSection(sectionFromPanel(panel as AuxPanel));
      },
      refreshResources: async () => {
        await reload();
      },
      toggleSafeMode,
      focusGroup: (groupId) => setActiveGroup(groupId),
      focusSubtag: (subtagPath) => {
        setActiveView("dashboard");
        setActiveGroup("all");
        setQuery("");

        const parts = subtagPath.split("/");
        const pathsToExpand: string[] = [];
        for (let i = 1; i <= parts.length; i++) {
          pathsToExpand.push(parts.slice(0, i).join("/"));
        }

        setCollapsedSubTagPaths((prev) =>
          prev.filter((p) => !pathsToExpand.includes(p))
        );

        setTimeout(() => {
          const el = document.getElementById(`droppable-subtag-wrapper-${subtagPath}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.classList.add("focus-highlight");
            setTimeout(() => {
              el.classList.remove("focus-highlight");
            }, 2000);
          }
        }, 100);
      }
    });
  }, [settings?.safeMode]);

  useEffect(() => {
    if (paletteOpen) {
      requestAnimationFrame(() => paletteInputRef.current?.focus());
    }
  }, [paletteOpen]);

  useEffect(() => {
    const trackPointer = (event: globalThis.PointerEvent) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", trackPointer, { passive: true });
    window.addEventListener("pointerdown", trackPointer, { passive: true });
    return () => {
      window.removeEventListener("pointermove", trackPointer);
      window.removeEventListener("pointerdown", trackPointer);
    };
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [contextMenu]);

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const margin = 10;
    const nextX = Math.min(Math.max(margin, contextMenu.x), Math.max(margin, window.innerWidth - rect.width - margin));
    const nextY = Math.min(Math.max(margin, contextMenu.y), Math.max(margin, window.innerHeight - rect.height - margin));
    if (Math.abs(nextX - contextMenu.x) > 0.5 || Math.abs(nextY - contextMenu.y) > 0.5) {
      setContextMenu((current) => (current ? { ...current, x: nextX, y: nextY } : current));
    }
  }, [contextMenu]);

  useEffect(() => {
    const currentWindow = getAppWindow();
    const unlisteners: (() => void)[] = [];
    if (currentWindow && isTauriRuntime()) {
      let scaleFactor = window.devicePixelRatio || 1;
      void currentWindow.scaleFactor().then((value) => {
        if (value > 0) scaleFactor = value;
      }).catch(() => undefined);

      currentWindow.onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "leave") {
          setDragActive(false);
          setExternalDropGroupId(null);
          return;
        }

        const logicalPosition = payload.position.toLogical(scaleFactor);
        const destinationGroup = normalizeDroppedResourceGroup(
          dropGroupIdAtPoint(logicalPosition.x, logicalPosition.y) ?? activeGroupRef.current
        );

        if (payload.type === "enter" || payload.type === "over") {
          setDragActive(true);
          setExternalDropGroupId(destinationGroup ?? null);
          return;
        }

        setDragActive(false);
        setExternalDropGroupId(null);
        void createDroppedResources(payload.paths, destinationGroup);
      }).then((unlisten) => {
        unlisteners.push(unlisten);
      }).catch(() => undefined);
    }

    const droppedPathsFromBrowserEvent = (event: DragEvent) => {
      return Array.from(event.dataTransfer?.files ?? [])
        .map((file) => {
          const fileWithPath = file as File & { path?: string };
          return fileWithPath.path ?? file.webkitRelativePath ?? "";
        })
        .filter(Boolean);
    };
    const handleBrowserDrag = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setDragActive(true);
      const destinationGroup = normalizeDroppedResourceGroup(
        dropGroupIdFromElement(event.target)
        ?? dropGroupIdAtPoint(event.clientX, event.clientY)
        ?? activeGroupRef.current
      );
      setExternalDropGroupId(destinationGroup ?? null);
    };
    const handleBrowserLeave = (event: DragEvent) => {
      event.preventDefault();
      if (event.target === document.body || event.target === document.documentElement) {
        setDragActive(false);
        setExternalDropGroupId(null);
      }
    };
    const handleBrowserDrop = (event: DragEvent) => {
      event.preventDefault();
      setDragActive(false);
      const destinationGroup = normalizeDroppedResourceGroup(
        dropGroupIdFromElement(event.target)
        ?? dropGroupIdAtPoint(event.clientX, event.clientY)
        ?? activeGroupRef.current
      );
      setExternalDropGroupId(null);
      const paths = droppedPathsFromBrowserEvent(event);
      if (paths.length > 0) {
        void createDroppedResources(paths, destinationGroup);
      } else if (!isTauriRuntime()) {
        setToast("浏览器预览无法读取本地路径，请在桌面版中拖拽文件");
      }
    };
    window.addEventListener("dragenter", handleBrowserDrag);
    window.addEventListener("dragover", handleBrowserDrag);
    window.addEventListener("dragleave", handleBrowserLeave);
    window.addEventListener("drop", handleBrowserDrop);

    return () => {
      unlisteners.forEach((fn) => fn());
      window.removeEventListener("dragenter", handleBrowserDrag);
      window.removeEventListener("dragover", handleBrowserDrag);
      window.removeEventListener("dragleave", handleBrowserLeave);
      window.removeEventListener("drop", handleBrowserDrop);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = pluginHost.subscribe(() => setPluginHostRevision((revision) => revision + 1));
    pluginHost.start();
    return () => {
      unsubscribe();
      pluginHost.dispose();
    };
  }, [pluginHost]);

  useEffect(() => {
    let cancelled = false;
    pluginHost.search.query(paletteQuery).then((results) => {
      if (!cancelled) setPluginResults(results);
    });
    return () => {
      cancelled = true;
    };
  }, [paletteQuery, pluginHost, pluginHostRevision]);

  const activeTheme = useMemo(() => {
    return themes.find((theme) => theme.id === settings?.activeThemeId) ?? themes[0];
  }, [settings?.activeThemeId, themes]);

  useEffect(() => {
    if (!activeTheme) return;
    const root = document.documentElement;
    root.dataset.theme = activeTheme.id;
    if (activeTheme.id.startsWith("atelier-")) {
      root.dataset.themeStyle = "atelier";
    } else {
      delete root.dataset.themeStyle;
    }
    root.removeAttribute("style");
    Object.entries(activeTheme.tokens).forEach(([key, value]) => root.style.setProperty(key, value));
  }, [activeTheme]);

  const [activeLaunch, setActiveLaunch] = useState<any | null>(null);

  useEffect(() => {
    const checkLaunch = () => {
      try {
        const raw = localStorage.getItem("orbitstart.plugin.workspaces.storage.active_launch");
        if (raw) {
          const data = JSON.parse(raw);
          if (data && data.status === "running") {
            setActiveLaunch(data);
            return;
          }
        }
        setActiveLaunch(null);
      } catch {}
    };

    checkLaunch();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "orbitstart.plugin.workspaces.storage.active_launch") {
        checkLaunch();
      }
    };
    window.addEventListener("storage", handleStorage);
    const timer = setInterval(checkLaunch, 250);
    return () => {
      window.removeEventListener("storage", handleStorage);
      clearInterval(timer);
    };
  }, [pluginHostRevision]);

  const [dashboardWorkspaces, setDashboardWorkspaces] = useState<any[]>([]);

  useEffect(() => {
    if (activeView === "dashboard") {
      try {
        const raw = localStorage.getItem("orbitstart.plugin.workspaces.storage.workspaces");
        if (raw) {
          const list = JSON.parse(raw);
          setDashboardWorkspaces(list.filter((w: any) => w.enabled));
        } else {
          setDashboardWorkspaces([]);
        }
      } catch (e) {
        console.error(e);
      }
    }
  }, [activeView, pluginHostRevision]);

  const getWorkspaceIcon = (name: string, color?: string, size = 20) => {
    const style = { color: color || "var(--text)" };
    switch (name) {
      case "AppWindow": return <AppWindow size={size} style={style} />;
      case "Globe": return <Globe size={size} style={style} />;
      case "FolderOpen": return <FolderOpen size={size} style={style} />;
      case "FileText": return <FileText size={size} style={style} />;
      case "Settings": return <Settings size={size} style={style} />;
      default: return <Briefcase size={size} style={style} />;
    }
  };

  const launchWorkspaceFromDashboard = async (wsId: string) => {
    if (pluginHost && pluginHost.commands && typeof pluginHost.commands.run === "function") {
      const sanitizedId = wsId.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
      try {
        setToast("正在启动工作区...");
        await pluginHost.commands.run(`workspaces.run-workspace-${sanitizedId}`);
        const raw = localStorage.getItem("orbitstart.plugin.workspaces.storage.workspaces");
        if (raw) {
          setDashboardWorkspaces(JSON.parse(raw).filter((w: any) => w.enabled));
        }
      } catch (err) {
        console.error(err);
        setToast(`启动工作区失败: ${String(err)}`);
      }
    }
  };

  const createWorkspaceFromActiveGroup = () => {
    if (selectedIds.length === 0) return;

    const selectedItems = selectedIds
      .map((id) => items.find((item) => item.id === id))
      .filter((item): item is OrbitItem => !!item);

    const activeGroupObj = groups.find((g) => g.id === activeGroup);
    const groupTitle = activeGroupObj ? activeGroupObj.title : "自定义";
    const newWsId = "ws_" + Math.random().toString(36).substr(2, 9);
    
    const newWs = {
      id: newWsId,
      name: `新工作区`,
      description: `由选中的 ${selectedItems.length} 个资源生成的启动场景`,
      icon: "Briefcase",
      color: "#27d7c6",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      launchCount: 0
    };

    const newSteps = selectedItems.map((item, idx) => ({
      id: "step_" + Math.random().toString(36).substr(2, 9),
      workspaceId: newWsId,
      order: idx + 1,
      type: item.kind,
      itemId: item.id,
      title: item.title,
      target: item.target,
      arguments: item.arguments || "",
      workingDirectory: "",
      failurePolicy: "continue",
      enabled: true,
      delayMs: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));

    let existingWorkspaces: any[] = [];
    try {
      const raw = localStorage.getItem("orbitstart.plugin.workspaces.storage.workspaces");
      if (raw) existingWorkspaces = JSON.parse(raw);
    } catch {}

    let existingSteps: any[] = [];
    try {
      const raw = localStorage.getItem("orbitstart.plugin.workspaces.storage.steps");
      if (raw) existingSteps = JSON.parse(raw);
    } catch {}

    const nextWs = [...existingWorkspaces, newWs];
    const nextSteps = [...existingSteps, ...newSteps];

    localStorage.setItem("orbitstart.plugin.workspaces.storage.workspaces", JSON.stringify(nextWs));
    localStorage.setItem("orbitstart.plugin.workspaces.storage.steps", JSON.stringify(nextSteps));

    if (pluginHost && pluginHost.commands && typeof pluginHost.commands.run === "function") {
      pluginHost.commands.run("workspaces.reload").catch((err: any) => {
        console.error("Failed to reload workspaces in plugin", err);
      });
    }

    // Clean up batch state
    exitBatchMode();

    localStorage.setItem("orbitstart.workspaces.editing_id", newWsId);
    setActiveView("workspaces");
    setToast(`成功将选中的 ${selectedItems.length} 个资源创建为工作区`);
  };

  const visibleKindOptions = baseKindOptions.filter((option) => !option.pluginId || pluginEnabled(option.pluginId));

  function itemKindAllowed(item: OrbitItem) {
    if (item.kind === "website") return pluginEnabled("core-websites");
    if (item.kind === "action_chain") return pluginEnabled("core-actions");
    return true;
  }

  const visibleGroups = groups.filter((group) => {
    if (group.id === "work") return false;
    if (group.id === "web") return pluginEnabled("core-websites");
    return true;
  });

  const filteredItems = useMemo(() => {
    const matched = items
      .filter(itemKindAllowed)
      .filter((item) => {
        if (activeGroup === "all") return true;
        return itemHasGroup(item, activeGroup);
      })
      .filter((item) => matchesItem(item, query));

    const q = query.trim().toLowerCase();
    if (!q) {
      const orderMap = new Map(localOrder.map((id, index) => [id, index]));
      return matched.slice().sort((a, b) => {
        const aIdx = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const bIdx = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return aIdx - bIdx;
      });
    }

    return matched.slice().sort((a, b) => {
      const scoreA = scoreItem(a, query);
      const scoreB = scoreItem(b, query);
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      // Tie breaker: database order (favorite, launchCount, etc.)
      const aFav = a.favorite ? 1 : 0;
      const bFav = b.favorite ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      const aLaunch = a.launchCount ?? 0;
      const bLaunch = b.launchCount ?? 0;
      if (aLaunch !== bLaunch) return bLaunch - aLaunch;
      return a.title.localeCompare(b.title, "zh-Hans-CN");
    });
  }, [activeGroup, items, plugins, query, localOrder]);

  useEffect(() => {
    setResourceRenderLimit(RESOURCE_RENDER_PAGE_SIZE);
  }, [activeGroup, query, items.length]);

  const renderedItems = useMemo(
    () => filteredItems.slice(0, resourceRenderLimit),
    [filteredItems, resourceRenderLimit]
  );

  const rootResourceItems = useMemo(
    () => renderedItems.filter((item) => !cleanSubTag(item.subTag)),
    [renderedItems]
  );

  const subTagTree = useMemo(() => buildSubTagTree(renderedItems, subTagOrder), [renderedItems, subTagOrder]);
  const selectableItemsInView = useMemo(
    () => [...rootResourceItems, ...visibleSubTagItems(subTagTree, collapsedSubTagPaths)],
    [collapsedSubTagPaths, rootResourceItems, subTagTree]
  );

  const favoriteItems = filteredItems.filter((item) => item.favorite);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const itemByTarget = useMemo(() => new Map(items.map((item) => [item.target, item])), [items]);
  const existingSubTags = useMemo(() => {
    const tags = new Set<string>();
    for (const item of items) {
      const parts = subTagParts(item.subTag);
      if (parts.length > 0) {
        let currentPath = "";
        for (const part of parts) {
          currentPath = currentPath ? `${currentPath}/${part}` : part;
          tags.add(currentPath);
        }
      }
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [items]);
  const enabledPlugins = plugins.filter((plugin) => plugin.enabled).length;
  const densityValue = useMemo(() => {
    if (!settings?.density) return 0;
    if (settings.density === "comfortable") return 0;
    if (settings.density === "compact") return 100;
    const val = parseInt(settings.density, 10);
    return isNaN(val) ? 0 : val;
  }, [settings?.density]);

  const densityFactor = densityValue / 100;
  const isSimple = (settings?.displayMode ?? "simple") === "simple";
  const density = densityValue > 50 ? "compact" : "comfortable";
  const workbenchVisible = settings?.workbenchVisible ?? !hideWorkbench;
  const workbenchShowStatus = settings?.workbenchShowStatus ?? true;
  const workbenchShowWorkspaces = settings?.workbenchShowWorkspaces ?? true;
  const workbenchShowActions = settings?.workbenchShowActions ?? true;
  const workbenchShowToast = settings?.workbenchShowToast ?? true;
  const workbenchShowStatistics = settings?.workbenchShowStatistics ?? true;

  const isLocalGalaxyTheme = activeTheme?.id === "local-galaxy";
  const themeLabel = activeTheme?.name ? activeTheme.name.toUpperCase() : "ORBITSTART";
  const galaxyAssetVars = {
    "--asset-divider-glow": `url("${localGalaxyAssets.effects.dividerGlow.src}")`,
    "--asset-search-edge": `url("${localGalaxyAssets.effects.searchEdge.src}")`,
    "--asset-active-tab-glow": `url("${localGalaxyAssets.effects.activeTabGlow.src}")`,
    "--asset-cyan-glow": `url("${localGalaxyAssets.effects.cyanGlow.src}")`,
    "--asset-gold-glow": `url("${localGalaxyAssets.effects.goldGlow.src}")`,
    "--asset-radar": `url("${localGalaxyAssets.ornaments.radar.src}")`,
    "--asset-compass-star": `url("${localGalaxyAssets.ornaments.compass.src}")`,
    "--asset-log-texture": `url("${localGalaxyAssets.textures.logs.src}")`,
    "--asset-settings-star-map": `url("${localGalaxyAssets.ornaments.settingsStarMap.src}")`,
    "--asset-scan-orbit": `url("${localGalaxyAssets.ornaments.scanOrbit.src}")`,
    "--asset-astrolabe": `url("${localGalaxyAssets.ornaments.astrolabe.src}")`,
    "--asset-panel-corner": `url("${localGalaxyAssets.frames.corner.src}")`
  } as CSSProperties;

  const appShellStyle = {
    ...(isLocalGalaxyTheme ? galaxyAssetVars : {}),
    "--density-factor": densityFactor.toString(),
    "--resource-min-width": isSimple 
      ? `${140 - densityFactor * 30}px` 
      : `${220 - densityFactor * 30}px`,
  } as CSSProperties;
  const activeViewMeta: Record<ViewId, { title: string; subtitle: string }> = {
    dashboard: { title: "资源中心", subtitle: "统一管理本地应用、文件、网址与自动化入口" },
    trips: { title: "Tips", subtitle: "为资源记录快捷键、流程、参数和状态提示" },
    obsidian: { title: "Obsidian", subtitle: "只读索引本地 vault，聚合笔记和 Markdown 待办" },
    workspaces: { title: "工作区管理", subtitle: "分组管理启动项，一键按顺序加载办公/开发环境" },
    settings: { title: "设置中心", subtitle: "系统偏好、插件、主题与数据维护" },
    logs: { title: "运行日志", subtitle: "查看最近的插件事件、扫描结果与系统反馈" }
  };

  function iconBaseFor(item: OrbitItem) {
    return item.kind === "website" || item.kind === "script" || item.kind === "action_chain"
      ? localGalaxyAssets.icons.shellViolet64.src
      : localGalaxyAssets.icons.shellTeal64.src;
  }

  function resourceIconStyle(item: OrbitItem) {
    return {
      "--accent": item.accent,
      "--asset-icon-base": isLocalGalaxyTheme ? `url("${iconBaseFor(item)}")` : "none"
    } as CSSProperties;
  }

  function renderBrandIcon(size = 24) {
    return <img src={appIconSrc} alt="" width={size} height={size} />;
  }

  function inputWithKind(input: OrbitItemInput, kind: ItemKind): OrbitItemInput {
    const option = baseKindOptions.find((candidate) => candidate.value === kind) ?? baseKindOptions[0];
    return {
      ...input,
      kind,
      group: normalizeGroupValue(mergeGroupValues(option.group, input.group), option.group),
      icon: option.icon,
      accent: option.accent
    };
  }

  async function openItem(item: OrbitItem) {
    setBusy(true);
    try {
      const result = await launchItem(item.id, item.target);
      setToast(result);
      await reload();
    } catch (error) {
      setToast(`启动失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveEditor() {
    if (!editor) return;
    const option = baseKindOptions.find((candidate) => candidate.value === editor.input.kind) ?? baseKindOptions[0];
    const normalizedInput = {
      ...editor.input,
      group: normalizeGroupValue(editor.input.group, option.group),
      aliases: uniqueList(editor.input.aliases),
      tags: uniqueList(editor.input.tags),
      subTag: cleanSubTag(editor.input.subTag)
    };

    if (!normalizedInput.title.trim() || !normalizedInput.target.trim()) {
      setToast("标题和目标路径/网址不能为空");
      return;
    }

    setBusy(true);
    try {
      let saved: OrbitItem;
      if (editor.mode === "create") {
        saved = await createItem(normalizedInput);
        setToast(`已添加：${normalizedInput.title}`);
      } else {
        saved = await updateItem({
          ...editor.item,
          ...normalizedInput
        });
        setToast(`已更新：${normalizedInput.title}`);
      }
      applyItemUpdate(saved);
      setEditor(null);
    } catch (error) {
      setToast(`保存失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function createDroppedResources(paths: string[], destinationGroupId?: string) {
    const cleanPaths = paths.map((path) => path.trim()).filter(Boolean);
    if (cleanPaths.length === 0 || dropInProgressRef.current) return;

    const destinationGroup = normalizeDroppedResourceGroup(destinationGroupId);
    dropInProgressRef.current = true;
    setBusy(true);
    try {
      const created = await createItemsFromPaths(cleanPaths, destinationGroup);
      setItems((previous) => upsertItemsById(previous, created));
      setActiveView("dashboard");
      if (destinationGroup) {
        setActiveGroup(destinationGroup);
      }
      setToast(`已通过拖拽创建 ${created.length} 个资源${destinationGroup ? "，并加入目标标签" : ""}`);
    } catch (error) {
      setToast(`拖拽创建失败：${String(error)}`);
    } finally {
      dropInProgressRef.current = false;
      setBusy(false);
    }
  }

  function mergePickedResourceInput(current: OrbitItemInput, picked: OrbitItemInput): OrbitItemInput {
    return {
      ...current,
      kind: picked.kind,
      group: normalizeGroupValue(mergeGroupValues(current.group, picked.group), picked.group),
      target: picked.target,
      title: current.title.trim() ? current.title : picked.title,
      subtitle: current.subtitle.trim() ? current.subtitle : picked.subtitle,
      aliases: Array.from(new Set([...current.aliases, ...picked.aliases])),
      tags: Array.from(new Set([...current.tags, ...picked.tags])),
      icon: picked.icon,
      accent: picked.accent
    };
  }

  async function chooseResourceTarget(mode: "file" | "folder") {
    if (!editor) return;
    setBusy(true);
    try {
      const picked = await pickResourceInput(mode);
      if (!picked) return;
      setEditor((current) => (current ? { ...current, input: mergePickedResourceInput(current.input, picked) } : current));
      setToast(mode === "folder" ? "已选择文件夹" : "已选择本地资源");
    } catch (error) {
      setToast(`选择资源失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function chooseCustomIcon() {
    if (!editor) return;
    setBusy(true);
    try {
      const icon = await pickIconImage();
      if (!icon) return;
      setEditor((current) => (current ? { ...current, input: { ...current.input, icon } } : current));
      setToast("已应用自定义图标");
    } catch (error) {
      setToast(`选择图标失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function resetEditorIcon() {
    setEditor((current) => {
      if (!current) return current;
      const option = baseKindOptions.find((candidate) => candidate.value === current.input.kind) ?? baseKindOptions[0];
      return { ...current, input: { ...current.input, icon: option.icon } };
    });
  }

  async function removeItem(item: OrbitItem) {
    setDialog({ type: "delete-item", item });
  }

  async function confirmRemoveItem(item: OrbitItem) {
    setBusy(true);
    try {
      await deleteItem(item.id);
      applyItemDeletion(item.id);
      setToast(`已删除：${item.title}`);
      setDialog(null);
    } catch (error) {
      setToast(`删除失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmCreateSubTag(subTagName: string, itemIds: string[]) {
    const cleanPath = cleanSubTag(subTagName);
    if (!cleanPath) {
      setToast("子目录名称不能为空");
      return;
    }
    setBusy(true);
    try {
      const promises = itemIds.map((id) => {
        const item = itemById.get(id);
        if (item) {
          return updateItem({ ...item, subTag: cleanPath });
        }
        return Promise.resolve(null);
      });
      await Promise.all(promises);
      await reload();
      setToast(`成功创建子目录并移动了 ${itemIds.length} 个资源`);
      setDialog(null);
    } catch (error) {
      console.error("Failed to create subtag", error);
      setToast("创建子目录失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRenameSubTag(oldPath: string, newPath: string) {
    const cleanPath = cleanSubTag(newPath);
    if (!cleanPath) {
      setToast("新子目录名称不能为空");
      return;
    }
    if (cleanPath === oldPath) {
      setDialog(null);
      return;
    }
    setBusy(true);
    try {
      const targetItems = items.filter(
        (item) => item.subTag && (item.subTag === oldPath || item.subTag.startsWith(oldPath + "/"))
      );
      const promises = targetItems.map((item) => {
        let updatedSubTag = cleanPath;
        if (item.subTag && item.subTag.startsWith(oldPath + "/")) {
          updatedSubTag = cleanPath + item.subTag.substring(oldPath.length);
        }
        return updateItem({ ...item, subTag: updatedSubTag });
      });
      await Promise.all(promises);

      // Rename subtag hotkeys if any are bound
      const hotkeyPromises: Promise<void>[] = [];
      Object.entries(hotkeysBoundToSubTag).forEach(([subPath, hotkey]) => {
        if (subPath === oldPath || subPath.startsWith(oldPath + "/")) {
          let newSubPath = cleanPath;
          if (subPath.startsWith(oldPath + "/")) {
            newSubPath = cleanPath + subPath.substring(oldPath.length);
          }
          hotkeyPromises.push(updateSubTagHotkey(subPath, null));
          hotkeyPromises.push(updateSubTagHotkey(newSubPath, hotkey));
        }
      });
      if (hotkeyPromises.length > 0) {
        await Promise.all(hotkeyPromises);
        await fetchSubTagHotkeys();
      }

      await reload();
      setToast(`成功重命名子目录并联动更新了 ${targetItems.length} 个资源项`);
      setDialog(null);
    } catch (error) {
      console.error("Failed to rename subtag", error);
      setToast("重命名子目录失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteSubTag(path: string) {
    setBusy(true);
    try {
      const targetItems = items.filter(
        (item) => item.subTag && (item.subTag === path || item.subTag.startsWith(path + "/"))
      );
      const promises = targetItems.map((item) => {
        return updateItem({ ...item, subTag: "" });
      });
      await Promise.all(promises);

      // Delete subtag hotkeys if any are bound
      const hotkeyPromises: Promise<void>[] = [];
      Object.entries(hotkeysBoundToSubTag).forEach(([subPath, _]) => {
        if (subPath === path || subPath.startsWith(path + "/")) {
          hotkeyPromises.push(updateSubTagHotkey(subPath, null));
        }
      });
      if (hotkeyPromises.length > 0) {
        await Promise.all(hotkeyPromises);
        await fetchSubTagHotkeys();
      }

      await reload();
      setToast(`成功删除子目录并移除了其下 ${targetItems.length} 个资源项的子目录标记`);
      setDialog(null);
    } catch (error) {
      console.error("Failed to delete subtag", error);
      setToast("删除子目录失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite(item: OrbitItem) {
    setBusy(true);
    try {
      const updated = await updateItem({
        ...item,
        favorite: !item.favorite
      });
      applyItemUpdate(updated);
    } catch (error) {
      setToast(`更新收藏失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function addCustomGroup() {
    setDialog({ type: "group", value: "" });
  }

  async function confirmCustomGroup(title: string) {
    if (!title.trim()) {
      setToast("标签名称不能为空");
      return;
    }
    setBusy(true);
    try {
      const nextGroups = await createGroup(title.trim());
      setGroups(nextGroups);
      const created = nextGroups.find((group) => group.title === title.trim());
      if (created) setActiveGroup(created.id);
      setToast(`已创建标签：${title.trim()}`);
      setDialog(null);
    } catch (error) {
      setToast(`创建标签失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeGroup(groupId: string) {
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group || !group.custom) {
      setToast("默认分组不可删除");
      return;
    }
    const affected = items.filter((item) => itemHasGroup(item, groupId)).length;
    setBusy(true);
    try {
      const nextGroups = await deleteGroup(groupId);
      setGroups(nextGroups);
      if (activeGroup === groupId) setActiveGroup("all");
      await reload();
      setToast(
        affected > 0
          ? `\u5df2\u5220\u9664\u6807\u7b7e\u201c${group.title}\u201d\uff0c\u5e76\u4ece ${affected} \u4e2a\u8d44\u6e90\u4e2d\u79fb\u9664\u8be5\u6807\u7b7e`
          : `\u5df2\u5220\u9664\u6807\u7b7e\u201c${group.title}\u201d`
      );
    } catch (error) {
      setToast(`\u5220\u9664\u6807\u7b7e\u5931\u8d25\uff1a${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(id: string, shiftKey = false) {
    const anchorIndex = selectionAnchorId ? selectableItemsInView.findIndex((item) => item.id === selectionAnchorId) : -1;
    const targetIndex = selectableItemsInView.findIndex((item) => item.id === id);

    if (shiftKey && anchorIndex !== -1 && targetIndex !== -1) {
      const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
      const rangeIds = selectableItemsInView.slice(start, end + 1).map((item) => item.id);
      setSelectedIds((current) => Array.from(new Set([...current, ...rangeIds])));
      return;
    }

    const wasSelected = selectedIds.includes(id);
    setSelectedIds((current) => (current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id]));
    setSelectionAnchorId(wasSelected ? null : id);
  }

  function enterBatchMode() {
    setBatchMode(true);
    setSelectedIds([]);
    setSelectionAnchorId(null);
  }

  function exitBatchMode() {
    setBatchMode(false);
    setSelectedIds([]);
    setSelectionAnchorId(null);
  }

  function selectAllCurrent() {
    setSelectedIds(filteredItems.map((item) => item.id));
    setSelectionAnchorId(null);
  }

  function clearSelectedItems() {
    setSelectedIds([]);
    setSelectionAnchorId(null);
  }

  async function batchDeleteSelected() {
    if (selectedIds.length === 0) return;
    setDialog({ type: "batch-delete" });
  }

  async function confirmBatchDeleteSelected() {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      for (const id of selectedIds) {
        await deleteItem(id);
      }
      exitBatchMode();
      setDialog(null);
      await reload();
      setToast("批量删除完成");
    } catch (error) {
      setToast(`批量删除失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function batchMoveSelected() {
    if (selectedIds.length === 0) return;
    setDialog({ type: "batch-move", groupId: batchGroup });
  }

  async function confirmBatchMoveSelected(groupId: string) {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      const selected = items.filter((item) => selectedIds.includes(item.id));
      for (const item of selected) {
        await updateItem({ ...item, group: normalizeGroupValue(mergeGroupValues(item.group, groupId), groupId) });
      }
      setBatchGroup(groupId);
      exitBatchMode();
      setDialog(null);
      await reload();
      const group = groups.find((candidate) => candidate.id === groupId);
      setToast(`已添加标签：${group?.title ?? groupId}`);
    } catch (error) {
      setToast(`批量移动失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function batchRemoveTagSelected() {
    if (selectedIds.length === 0) return;
    const selected = items.filter((item) => selectedIds.includes(item.id));
    const selectedItemGroups = Array.from(new Set(selected.flatMap((item) => splitGroupIds(item.group)))).filter(Boolean);
    const initialTagId = selectedItemGroups[0] ?? "";
    setDialog({ type: "batch-remove-tag", tagId: initialTagId });
  }

  async function confirmBatchRemoveTag(tagId: string) {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      const selected = items.filter((item) => selectedIds.includes(item.id));
      for (const item of selected) {
        const currentGroups = splitGroupIds(item.group);
        if (currentGroups.includes(tagId)) {
          const updatedGroups = currentGroups.filter((id) => id !== tagId);
          await updateItem({ ...item, group: joinGroupIds(updatedGroups) });
        }
      }
      exitBatchMode();
      setDialog(null);
      await reload();
      const group = groups.find((candidate) => candidate.id === tagId);
      setToast(`已批量移除标签：${group?.title ?? tagId}`);
    } catch (error) {
      setToast(`批量移除标签失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmBatchMoveToSubTag(subTag: string) {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      const selected = items.filter((item) => selectedIds.includes(item.id));
      for (const item of selected) {
        await updateItem({ ...item, subTag });
      }
      exitBatchMode();
      await reload();
      setToast(subTag === "" ? "已将选中资源移回主目录" : `已将选中资源成功批量移动至子目录：${subTag}`);
    } catch (error) {
      setToast(`批量移动至子目录失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function toggleSubTagCollapsed(path: string) {
    const cleanPath = cleanSubTag(path);
    setCollapsedSubTagPaths((current) =>
      current.includes(cleanPath) ? current.filter((candidate) => candidate !== cleanPath) : [...current, cleanPath]
    );
  }

  function renderResourceCards(cardItems: OrbitItem[]) {
    return (
      <SortableContext items={cardItems.map((item) => item.id)} strategy={rectSortingStrategy}>
        {cardItems.map((item) => (
          <SortableResourceRow
            key={item.id}
            item={item}
            selectedIds={selectedIds}
            batchMode={batchMode}
            busy={busy}
            onToggleSelected={toggleSelected}
            onOpenItem={openItem}
            groups={groups}
            tripCounts={tripCounts}
            showTripsAction={tripsFeatureEnabled}
            onOpenTrips={(selectedItem) => {
              setTripPanelItem(selectedItem);
              setTripPanelHighlightId(null);
            }}
            onToggleFavorite={toggleFavorite}
            onEdit={(selectedItem) => setEditor({ mode: "edit", item: selectedItem, input: inputFromItem(selectedItem) })}
            onDelete={removeItem}
            resourceIconStyle={resourceIconStyle}
            renderIcon={Icon}
            formatLastLaunched={lastLaunchedText}
            isSimple={isSimple}
            densityFactor={densityFactor}
          />
        ))}
      </SortableContext>
    );
  }

  function renderSubTagResourceSection(node: SubTagNode, depth = 0) {
    return (
      <SortableSubTagSection
        key={node.path}
        node={node}
        depth={depth}
        collapsedSubTagPaths={collapsedSubTagPaths}
        displayMode={settings?.displayMode ?? "simple"}
        renderResourceCards={renderResourceCards}
        renderSubTagResourceSection={renderSubTagResourceSection}
        toggleSubTagCollapsed={toggleSubTagCollapsed}
        hotkeysBoundToSubTag={hotkeysBoundToSubTag}
        hotkeyBinderEnabled={hotkeyBinderEnabled}
      />
    );
  }

  const handleHotkeyKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isRecordingHotkey) return;
    event.preventDefault();
    event.stopPropagation();

    // 如果按下 Escape 键，退出录制并取消
    if (event.key === "Escape") {
      setIsRecordingHotkey(false);
      setRecordedKeys([]);
      return;
    }

    // 如果按下 Backspace，清空录制
    if (event.key === "Backspace") {
      setRecordedKeys([]);
      return;
    }

    const keys: string[] = [];

    // 检测修饰键
    if (event.ctrlKey) keys.push("Ctrl");
    if (event.altKey) keys.push("Alt");
    if (event.shiftKey) keys.push("Shift");
    if (event.metaKey) keys.push("Win");
    
    // 排除修饰键本身的名称
    const key = event.key;
    const isModifierOnly = ["Control", "Alt", "Shift", "Meta", "OS"].includes(key);

    if (!isModifierOnly) {
      let keyName = key;
      if (keyName === " ") keyName = "Space";
      
      // 规范化名称
      if (keyName.length === 1) {
        keyName = keyName.toUpperCase();
      } else {
        // 首字母大写
        keyName = keyName.charAt(0).toUpperCase() + keyName.slice(1);
      }
      keys.push(keyName);
    }

    // 限制最多四个键
    const finalKeys = keys.slice(0, 4);
    setRecordedKeys(finalKeys);
  };

  async function saveHotkey() {
    const hasMainKey = recordedKeys.length > 0 && !["Ctrl", "Alt", "Shift", "Win"].includes(recordedKeys[recordedKeys.length - 1]);
    if (!hasMainKey) {
      setToast("快捷键必须包含一个主键（例如字母、数字或空格）");
      return;
    }
    const newHotkey = recordedKeys.join("+");
    const oldHotkey = settings?.globalHotkey ?? "Ctrl+Alt+Space";
    if (newHotkey === oldHotkey) {
      setIsRecordingHotkey(false);
      return;
    }
    
    setBusy(true);
    try {
      await updateGlobalHotkey(oldHotkey, newHotkey);
      if (settings) {
        setSettings({ ...settings, globalHotkey: newHotkey });
      }
      setToast(`全局热键已更新为：${newHotkey}`);
      setIsRecordingHotkey(false);
    } catch (error) {
      setToast(`注册热键失败，可能被占用：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runNativeItemScan(kind: "shortcuts" | "bookmarks", onClose?: () => void) {
    setBusy(true);
    setToast(kind === "shortcuts" ? "正在扫描本地程序..." : "正在读取浏览器书签...");
    try {
      const scanned = kind === "shortcuts" 
        ? await previewScanShortcuts() 
        : await previewScanBrowserBookmarks();
      
      if (scanned.length === 0) {
        setToast("未扫描到任何可用资源");
        if (onClose) onClose();
        return;
      }

      // Keep the full preview visible, but default-select only likely user-facing launch targets.
      const selectedIndices = buildDefaultImportSelection(kind, scanned);

      setImportPreview({
        kind,
        items: scanned,
        selectedIndices,
        searchQuery: "",
        visibleCount: IMPORT_PREVIEW_PAGE_SIZE,
        onClose
      });
      setToast(kind === "shortcuts" ? "本地程序扫描已就绪，请选择导入" : "浏览器书签扫描已就绪，请选择导入");
    } catch (error) {
      setToast(`扫描失败：${String(error)}`);
      if (onClose) onClose();
    } finally {
      setBusy(false);
    }
  }

  async function runExport() {
    setBusy(true);
    try {
      const result = await exportCatalogJson();
      setBackupJson(result.json);
      setBackupPath(result.path);
      setBackupOpen(true);
      setToast("数据备份已导出");
    } catch (error) {
      setToast(`导出失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!backupJson.trim()) {
      setToast("请先粘贴 JSON");
      return;
    }
    setBusy(true);
    try {
      const result = await importCatalogJson(backupJson);
      setBackupOpen(false);
      const snapshot = await reload();
      const tripCopy = result.tripsImported > 0 ? `，恢复 ${result.tripsImported} 条记录` : "";
      const skippedCopy = result.skipped > 0 ? `，跳过 ${result.skipped} 个重复项` : "";
      setToast(`导入完成：新增 ${result.inserted} 个、恢复 ${result.updated} 个资源${tripCopy}${skippedCopy}，当前 ${snapshot.items.length} 个资源`);
    } catch (error) {
      setToast(`导入失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function togglePlugin(plugin: OrbitPluginManifest) {
    setBusy(true);
    try {
      const snapshot = await setPluginEnabled(plugin.id, !plugin.enabled);
      applySnapshot(snapshot);
      setToast(`${plugin.name} 已${plugin.enabled ? "停用" : "启用"}`);
      if (plugin.id === "core-websites" && plugin.enabled && activeGroup === "web") {
        setActiveGroup("all");
      }
    } catch (error) {
      setToast(`插件状态更新失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function changeTheme(themeId: string) {
    setBusy(true);
    try {
      const nextSettings = await setActiveTheme(themeId);
      setSettings(nextSettings);
      setToast(`已应用主题：${themeId}`);
    } catch (error) {
      setToast(`主题切换失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function changeDensity(next: "comfortable" | "compact" | string) {
    setBusy(true);
    try {
      const nextSettings = await setDensity(next);
      setSettings(nextSettings);
      setToast(`密度已切换`);
    } catch (error) {
      setToast(`密度切换失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const debouncedSetDensity = useMemo(() => {
    let timer: any = null;
    return (value: string) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const nextSettings = await setDensity(value);
          setSettings((prev) => prev ? { ...nextSettings, density: prev.density } : nextSettings);
        } catch (error) {
          console.error("Failed to persist density:", error);
        }
      }, 150);
    };
  }, []);

  const handleDensityChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const val = event.target.value;
    if (settings) {
      setSettings({ ...settings, density: val });
    }
    debouncedSetDensity(val);
  };

  async function changeDisplayMode(mode: "simple" | "detailed") {
    setBusy(true);
    try {
      const nextSettings = await setDisplayMode(mode);
      setSettings(nextSettings);
      setToast(`显示模式已应用：${mode === "simple" ? "简约模式" : "详细模式"}`);
    } catch (error) {
      setToast(`显示模式切换失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function changeCloseBehavior(next: "tray" | "exit") {
    setBusy(true);
    try {
      const nextSettings = await setCloseBehavior(next);
      setSettings(nextSettings);
      setToast(next === "tray" ? "关闭按钮已设置为隐藏到托盘" : "关闭按钮已设置为直接退出");
    } catch (error) {
      setToast(`关闭行为更新失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function changeHotkeyBehavior(next: "command_bar" | "open_only") {
    setBusy(true);
    try {
      const nextSettings = await setHotkeyBehavior(next);
      setSettings(nextSettings);
      setToast(next === "command_bar" ? "全局热键已设置为打开 Command Bar" : "全局热键已设置为单纯打开主窗口并聚焦");
    } catch (error) {
      setToast(`热键行为更新失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function openPanelWindow(panel: AuxPanel) {
    // 设置页面直接在主窗口中央本地渲染，不再打开独立的 Tauri 子窗口以保证跟随和关闭生命周期一致
    setLocalAuxPanel(panel);
    setSettingsSection(sectionFromPanel(panel));
  }

  async function toggleSafeMode() {
    setBusy(true);
    try {
      const snapshot = await setSafeMode(!settings?.safeMode);
      applySnapshot(snapshot);
      setToast(snapshot.settings.safeMode ? "安全模式已启用：第三方插件暂时停用" : "安全模式已关闭");
    } catch (error) {
      setToast(`安全模式更新失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAutoPinnedMode() {
    setBusy(true);
    try {
      const next = !settings?.autoPinnedMode;
      const nextSettings = await setAutoPinnedMode(next);
      setSettings(nextSettings);
      setToast(next ? "自动置顶模式已启用：启动资源后自动移动至最前" : "自动置顶模式已关闭");
    } catch (error) {
      setToast(`置顶模式更新失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAutostart() {
    const next = !autostartState;
    setBusy(true);
    try {
      await setAutostartEnabled(next);
      setAutostartState(next);
      setToast(next ? "开机自启动已启用" : "开机自启动已禁用");
    } catch (error) {
      setToast(`设置自启动失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function createTemplate() {
    setDialog({ type: "template", value: "My Command Plugin" });
  }

  async function confirmCreateTemplate(name: string) {
    if (!name.trim()) {
      setToast("插件名称不能为空");
      return;
    }
    setBusy(true);
    try {
      const path = await createPluginTemplate(name.trim());
      await reload();
      setActiveView("settings");
      setSettingsSection("dev");
      setToast(`插件模板已创建：${path}`);
      setDialog(null);
    } catch (error) {
      setToast(`创建插件模板失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function openDataDir() {
    try {
      const path = await openDataDirectory();
      setToast(`数据目录：${path}`);
    } catch (error) {
      setToast(`打开数据目录失败：${String(error)}`);
    }
  }

  function handleResetSoftware() {
    setDialog({ type: "reset-confirm" });
  }

  async function confirmResetSoftware() {
    setBusy(true);
    try {
      await resetSoftware();
      localStorage.clear();
      setToast("已成功恢复初始化，软件即将重启或重新加载");
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error) {
      setToast(`恢复初始化失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function copyToast(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("已复制到剪贴板");
    } catch {
      setToast(text);
    }
  }

  async function handleCommand(command: OrbitCommand) {
    if (command.id === "core.addItem") {
      setEditor({ mode: "create", input: makeEmptyInput() });
      return;
    }
    if (command.id === "core.addActionChain") {
      setEditor({ mode: "create", input: makeEmptyInput("action_chain") });
      return;
    }
    if (command.id === "core.scanShortcuts") {
      await runNativeItemScan("shortcuts");
      return;
    }
    if (command.id === "core.scanBookmarks") {
      await runNativeItemScan("bookmarks");
      return;
    }
    if (command.id === "core.exportJson") {
      await runExport();
      return;
    }
    if (command.id === "core.themeStudio") {
      await openPanelWindow("themes");
      return;
    }
    if (command.id === "core.createPluginTemplate") {
      await createTemplate();
      return;
    }
    if (command.id === "core.openDataDir") {
      await openDataDir();
      return;
    }
    if (command.id === "core.commandPalette") {
      setPaletteOpen(true);
      return;
    }
    setToast(`命令已触发：${command.title}`);
  }

  interface CommandBarItem {
    id: string;
    title: string;
    subtitle: string;
    icon: string;
    typeLabel: "应用" | "网站" | "分组" | "页面";
    groupLabel?: string;
    _score: number;
    lastLaunchedAt?: string;
    launchCount?: number;
    favorite?: boolean;
    run: () => void | Promise<void>;
    resourceId?: string;
  }

  function scoreGeneric(title: string, subtitle: string, query: string): number {
    const q = query.trim().toLowerCase();
    if (!q) return 1;

    const titleLower = title.toLowerCase();
    const subLower = subtitle.toLowerCase();
    const py = getPinyinInitials(title);

    if (titleLower === q) return 100;
    if (titleLower.startsWith(q)) return 80;
    if (titleLower.includes(q)) return 50;
    if (py === q) return 40;
    if (py.startsWith(q)) return 30;
    if (py.includes(q)) return 20;
    if (subLower.includes(q)) return 10;
    return 0;
  }

  const commandBarResults = useMemo(() => {
    const q = commandBarQuery.trim().toLowerCase();

    // 1. Apps & Websites
    const appAndWebsites: CommandBarItem[] = items
      .filter((item) => item.kind === "app" || item.kind === "website")
      .map((item) => {
        const groupObj = groups.find((g) => g.id === item.group);
        const score = q ? scoreItem(item, commandBarQuery) : 0;
        return {
          id: `item:${item.id}`,
          title: item.title,
          subtitle: item.subtitle || item.target,
          icon: item.icon,
          typeLabel: item.kind === "app" ? "应用" : "网站",
          groupLabel: groupObj?.title,
          _score: score,
          lastLaunchedAt: item.lastLaunchedAt,
          launchCount: item.launchCount || 0,
          favorite: !!item.favorite,
          run: () => openItem(item),
          resourceId: item.id
        };
      });

    // 2. Groups
    const groupItems: CommandBarItem[] = groups.map((g) => {
      const score = q ? scoreGeneric(g.title, "", commandBarQuery) : 0;
      return {
        id: `group:${g.id}`,
        title: g.title,
        subtitle: `跳转到标签：${g.title}`,
        icon: "Tag",
        typeLabel: "分组",
        _score: score,
        run: () => {
          setActiveGroup(g.id);
          setActiveView("dashboard");
        }
      };
    });

    // 3. Internal Pages
    const internalPageCandidates = [
      { id: "dashboard", title: "工作台", subtitle: "跳转到主页工作台", icon: "LayoutDashboard" },
      { id: "settings", title: "系统设置", subtitle: "管理基础设置", icon: "Settings", panel: "settings", section: "general" },
      { id: "plugins", title: "插件管理", subtitle: "管理已安装插件", icon: "Blocks", panel: "plugins" },
      { id: "themes", title: "主题工作室", subtitle: "管理与编辑主题", icon: "Palette", panel: "themes" },
      { id: "logs", title: "运行日志", subtitle: "查看星际日志", icon: "Database", panel: "logs" },
      { id: "about", title: "关于 OrbitStart", subtitle: "查看软件关于页面", icon: "Info", panel: "about" },
      ...(obsidianFeatureEnabled ? [{ id: "obsidian", title: "Obsidian", subtitle: "管理知识库设置", icon: "NotebookText", panel: "obsidian" }] : [])
    ];

    const pageItems: CommandBarItem[] = internalPageCandidates.map((page) => {
      const score = q ? scoreGeneric(page.title, page.subtitle, commandBarQuery) : 0;
      return {
        id: `page:${page.id}`,
        title: page.title,
        subtitle: page.subtitle,
        icon: page.icon,
        typeLabel: "页面",
        _score: score,
        run: () => {
          if (page.id === "dashboard") {
            setActiveView("dashboard");
          } else if (page.id === "logs") {
            setActiveView("logs");
          } else if (page.panel) {
            setLocalAuxPanel(page.panel as any);
            if (page.section) {
              setSettingsSection(page.section as any);
            } else {
              setSettingsSection(sectionFromPanel(page.panel as any));
            }
          }
        }
      };
    });

    let merged: CommandBarItem[] = [];
    if (q) {
      const allCandidates = [...appAndWebsites, ...groupItems, ...pageItems];
      merged = allCandidates
        .filter((c) => c._score > 0)
        .sort((a, b) => b._score - a._score);
    } else {
      const sortedApps = appAndWebsites.sort((a, b) => {
        const aRecent = recencyBonus(a.lastLaunchedAt);
        const bRecent = recencyBonus(b.lastLaunchedAt);
        if (Math.abs(aRecent - bRecent) > 0.5) return bRecent - aRecent;
        const aLaunch = a.launchCount ?? 0;
        const bLaunch = b.launchCount ?? 0;
        if (aLaunch !== bLaunch) return bLaunch - aLaunch;
        const aFav = a.favorite ? 1 : 0;
        const bFav = b.favorite ? 1 : 0;
        if (aFav !== bFav) return bFav - aFav;
        return a.title.localeCompare(b.title, "zh-Hans-CN");
      });

      merged = [
        ...sortedApps.slice(0, 10),
        ...groupItems,
        ...pageItems
      ];
    }

    setCommandBarSelectedIndex((prev) => Math.min(prev, Math.max(0, merged.length - 1)));
    return merged.slice(0, 16);
  }, [items, groups, commandBarQuery, obsidianFeatureEnabled]);

  const handleCommandBarKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const total = commandBarResults.length;
    if (total === 0) {
      if (event.key === "Escape") {
        event.preventDefault();
        setCommandBarOpen(false);
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setCommandBarSelectedIndex((prev) => (prev + 1) % total);
        break;
      case "ArrowUp":
        event.preventDefault();
        setCommandBarSelectedIndex((prev) => (prev - 1 + total) % total);
        break;
      case "Enter":
        event.preventDefault();
        const selected = commandBarResults[commandBarSelectedIndex];
        if (selected) {
          void selected.run();
          setCommandBarOpen(false);
        }
        break;
      case "Escape":
        event.preventDefault();
        setCommandBarOpen(false);
        break;
    }
  };

  useEffect(() => {
    if (commandBarOpen) {
      const timer = setTimeout(() => {
        commandBarInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [commandBarOpen]);

  const paletteCommands = useMemo(() => {
    const raw = buildSortedResults({
      items,
      commands,
      paletteQuery,
      itemFilter: itemKindAllowed,
      toItemResult: (item) => ({
        id: `item:${item.id}`,
        title: item.title,
        subtitle: item.subtitle,
        icon: item.icon,
        source: item.kind,
        actionLabel: "打开",
        run: () => openItem(item),
        resourceId: item.id
      }),
      toCommandResult: (command) => ({
        id: command.id,
        title: command.title,
        subtitle: command.subtitle,
        icon: command.icon,
        source: command.pluginId,
        actionLabel: "执行命令",
        run: () => handleCommand(command)
      }),
      extraPluginResults: [
        ...pluginHost.commands.list().map((command) => ({
          id: command.id,
          title: command.title,
          subtitle: command.subtitle,
          icon: command.icon,
          source: command.pluginId,
          actionLabel: "执行插件命令",
          run: command.run
        })),
        ...pluginResults
      ]
    });

    // Auto-reset selection when results change, keep in bounds
    setPaletteSelectedIndex((prev) => Math.min(prev, Math.max(0, raw.length - 1)));
    return raw;
  }, [commands, items, paletteQuery, pluginHost, pluginHostRevision, pluginResults, plugins]);

  /** Keyboard navigation handler for command palette. */
  const handlePaletteKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const total = paletteCommands.length;
    if (total === 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setPaletteSelectedIndex((prev) => (prev + 1) % total);
        break;
      case "ArrowUp":
        event.preventDefault();
        setPaletteSelectedIndex((prev) => (prev - 1 + total) % total);
        break;
      case "Enter":
        event.preventDefault();
        const selected = paletteCommands[paletteSelectedIndex];
        if (selected) { selected.run(); setPaletteOpen(false); }
        break;
      case "Escape":
        event.preventDefault();
        setPaletteOpen(false);
        break;
    }
  };

  const navItems: Array<{ id: ViewId; title: string; icon: JSX.Element }> = [
    { id: "dashboard", title: "工作台", icon: <LayoutDashboard size={21} /> },
    ...(tripsFeatureEnabled ? [{ id: "trips" as const, title: "Tips", icon: <Lightbulb size={21} /> }] : []),
    ...(obsidianFeatureEnabled ? [{ id: "obsidian" as const, title: "Obsidian", icon: <NotebookText size={21} /> }] : []),
    ...(workspacesFeatureEnabled ? [{ id: "workspaces" as const, title: "工作区", icon: <Briefcase size={21} /> }] : []),
    { id: "logs", title: "日志", icon: <Database size={21} /> }
  ];

  async function persistWorkbenchSetting(key: string, value: boolean) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()) as keyof AppSettings;
    const previousSettings = settings;
    const previousHideWorkbench = hideWorkbench;
    if (key === "workbench_visible") {
      setHideWorkbench(!value);
      localStorage.setItem("orbitstart.dashboard.hide_workbench", String(!value));
    }
    setSettings((prev) => prev ? ({ ...prev, [camelKey]: value } as AppSettings) : prev);
    try {
      const nextSettings = await setBubbleSetting(key, value ? "true" : "false");
      setSettings(nextSettings);
    } catch (error) {
      setSettings(previousSettings);
      if (key === "workbench_visible") {
        setHideWorkbench(previousHideWorkbench);
        localStorage.setItem("orbitstart.dashboard.hide_workbench", String(previousHideWorkbench));
      }
      setToast(`工作台设置保存失败：${String(error)}`);
    }
  }

  const toggleWorkbenchPanel = () => {
    const nextVisible = !workbenchVisible;
    void persistWorkbenchSetting("workbench_visible", nextVisible);
  };

  function handleAppContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (activeId) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const nativeEvent = event.nativeEvent;
    const fallbackPoint = lastPointerRef.current;
    const clientX =
      Number.isFinite(nativeEvent.clientX) && nativeEvent.clientX > 0 && nativeEvent.clientX <= window.innerWidth
        ? nativeEvent.clientX
        : fallbackPoint.x;
    const clientY =
      Number.isFinite(nativeEvent.clientY) && nativeEvent.clientY > 0 && nativeEvent.clientY <= window.innerHeight
        ? nativeEvent.clientY
        : fallbackPoint.y;
    const nextMenu = contextMenuFromEvent({ clientX, clientY, target: nativeEvent.target });
    contextEditTargetRef.current = nextMenu.kind === "edit" ? editableElementFrom(event.nativeEvent.target) : null;
    setContextMenu(nextMenu);
  }

  async function runResourceContextAction(action: "launch" | "reveal" | "copy" | "edit" | "favorite" | "delete", item: OrbitItem) {
    setContextMenu(null);
    if (action === "launch") {
      await openItem(item);
      return;
    }
    if (action === "reveal") {
      try {
        const result = await revealTarget(item.target);
        setToast(result);
      } catch (error) {
        setToast(`打开所在位置失败：${String(error)}`);
      }
      return;
    }
    if (action === "copy") {
      await copyText(item.target);
      setToast("已复制路径 / URL");
      return;
    }
    if (action === "edit") {
      setEditor({ mode: "edit", item, input: inputFromItem(item) });
      return;
    }
    if (action === "favorite") {
      await toggleFavorite(item);
      return;
    }
    removeItem(item);
  }

  async function runBlankContextAction(action: "add" | "scan" | "bookmarks" | "refresh" | "settings") {
    setContextMenu(null);
    if (action === "add") {
      setEditor({ mode: "create", input: makeEmptyInput() });
      return;
    }
    if (action === "scan") {
      await runNativeItemScan("shortcuts");
      return;
    }
    if (action === "bookmarks") {
      await runNativeItemScan("bookmarks");
      return;
    }
    if (action === "refresh") {
      await reload();
      setToast("资源索引已刷新");
      return;
    }
    await openPanelWindow("settings");
  }

  async function runEditContextAction(command: EditMenuCommand) {
    const target = contextEditTargetRef.current;
    setContextMenu(null);
    await runEditMenuCommand(command, target);
  }

  function formatIndexTime(value?: string | null) {
    if (!value) return "未扫描";
    return lastLaunchedText({ lastLaunchedAt: value } as OrbitItem);
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  async function addObsidianVaultFromPicker() {
    setBusy(true);
    try {
      const path = await pickObsidianVaultPath();
      if (!path) {
        setToast("未选择 Obsidian Vault");
        return;
      }
      const vault = await addObsidianVault(path);
      setObsidianScanningId(vault.id);
      await scanObsidianVault(vault.id);
      await refreshObsidian();
      setToast(`已索引 Obsidian Vault：${vault.name}`);
    } catch (error) {
      setToast(`添加 Obsidian Vault 失败：${String(error)}`);
    } finally {
      setObsidianScanningId(null);
      setBusy(false);
    }
  }

  async function rescanAllObsidianVaults() {
    if (obsidianVaults.length === 0) {
      setToast("请先添加 Obsidian Vault");
      return;
    }
    setBusy(true);
    try {
      let totalTasks = 0;
      for (const vault of obsidianVaults) {
        setObsidianScanningId(vault.id);
        const result = await scanObsidianVault(vault.id);
        totalTasks += result.taskCount;
      }
      await refreshObsidian();
      setToast(`已重新扫描 ${obsidianVaults.length} 个 vault，索引 ${totalTasks} 条 checkbox`);
    } catch (error) {
      setToast(`重新扫描失败：${String(error)}`);
    } finally {
      setObsidianScanningId(null);
      setBusy(false);
    }
  }

  async function deleteObsidianVault(vault: ObsidianVaultConfig) {
    if (!window.confirm(`移除 Obsidian Vault「${vault.name}」？这只会清理本地索引，不会删除原始笔记。`)) return;
    setBusy(true);
    try {
      await removeObsidianVault(vault.id);
      await refreshObsidian();
      setToast(`已移除 Obsidian Vault：${vault.name}`);
    } catch (error) {
      setToast(`移除 Obsidian Vault 失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function openObsidianTask(task: ObsidianTask) {
    try {
      const result = await openObsidianNote(task.vaultId, task.relativePath, task.lineNumber);
      setToast(result);
    } catch (error) {
      setToast(`打开 Obsidian 笔记失败：${String(error)}`);
    }
  }

  async function handleTodoToggle(event: React.MouseEvent, task: ObsidianTask) {
    event.stopPropagation();
    try {
      const updated = await toggleObsidianTaskCompletion(task.id);
      // Update local state to reflect the change immediately
      setTodoPanelTasks((prev) =>
        prev.map((t) => (t.id === updated.id ? updated : t))
      );
    } catch (error) {
      setToast(`同步待办状态失败：${String(error)}`);
    }
  }

  async function openObsidianNoteResource(note: ObsidianNoteIndex) {
    try {
      const result = await openObsidianNote(note.vaultId, note.relativePath, null);
      setToast(result);
    } catch (error) {
      setToast(`打开 Obsidian 笔记失败：${String(error)}`);
    }
  }

  async function addObsidianNoteToResources(note: ObsidianNoteIndex) {
    const existing = itemByTarget.get(note.filePath);
    if (existing) {
      setToast("这篇笔记已在资源中心");
      return;
    }
    setBusy(true);
    try {
      const created = await createItem({
        title: note.title,
        subtitle: `${note.vaultName} · ${note.relativePath}`,
        kind: "file",
        group: "work",
        target: note.filePath,
        aliases: uniqueList([note.title, note.relativePath, note.vaultName]),
        tags: uniqueList(["obsidian", note.vaultName, ...note.tags]),
        icon: "NotebookText",
        accent: "#8b7cf6",
        favorite: note.favorite
      });
      applyItemUpdate(created);
      setToast(`已加入资源中心：${note.title}`);
    } catch (error) {
      setToast(`加入资源中心失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleObsidianNoteFavoriteAction(note: ObsidianNoteIndex) {
    const existing = itemByTarget.get(note.filePath);
    if (existing) {
      await toggleFavorite(existing);
      return;
    }
    setBusy(true);
    try {
      await toggleObsidianNoteFavorite(note.id, !note.favorite);
      await refreshObsidian();
    } catch (error) {
      setToast(`更新笔记收藏失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function editObsidianNoteResource(note: ObsidianNoteIndex) {
    const existing = itemByTarget.get(note.filePath);
    if (existing) {
      setEditor({ mode: "edit", item: existing, input: inputFromItem(existing) });
      return;
    }
    void openObsidianNoteResource(note);
  }

  async function openTodoPanelForNote(note: ObsidianNoteIndex) {
    try {
      await openObsidianTodoWindow(note.id);
    } catch (error) {
      setToast(`打开待办面板失败：${String(error)}`);
    }
  }

  async function toggleTodoPanelPin() {
    const next = !todoPanelPinned;
    try {
      await setTodoWindowAlwaysOnTop(next);
      setTodoPanelPinned(next);
    } catch (error) {
      setToast(`切换置顶失败：${String(error)}`);
    }
  }

  const renderKpiCard = (id: string) => {
    switch (id) {
      case "items_count":
        return (
          <SortableKpiCard key="items_count" id="items_count">
            <span>资源总数</span>
            <strong>{items.length}</strong>
            <em>本地入口与链接</em>
          </SortableKpiCard>
        );
      case "enabled_plugins":
        return (
          <SortableKpiCard key="enabled_plugins" id="enabled_plugins">
            <span>启用插件</span>
            <strong>{enabledPlugins}</strong>
            <em>{plugins.length} 个可用模块</em>
          </SortableKpiCard>
        );
      case "active_theme":
        return (
          <SortableKpiCard key="active_theme" id="active_theme">
            <span>主题方案</span>
            <strong>{themes.length}</strong>
            <em title={activeTheme?.name ?? "默认主题"}>{activeTheme?.name ?? "默认主题"}</em>
          </SortableKpiCard>
        );
      case "safe_mode":
        return (
          <SortableKpiCard key="safe_mode" id="safe_mode">
            <span>安全模式</span>
            <strong>{settings?.safeMode ? "启用" : "关闭"}</strong>
            <em>第三方扩展控制</em>
          </SortableKpiCard>
        );
      default:
        return null;
    }
  };

  const renderActionButton = (id: string) => {
    switch (id) {
      case "new_group":
        return (
          <SortableActionButton key="new_group" id="new_group" onClick={addCustomGroup} disabled={busy}>
            <PlusCircle size={17} />
            <span>新建分组</span>
          </SortableActionButton>
        );
      case "scan_programs":
        return (
          <SortableActionButton key="scan_programs" id="scan_programs" onClick={() => runNativeItemScan("shortcuts")} disabled={busy || !pluginEnabled("core-shortcuts")}>
            <ScanSearch size={17} />
            <span>扫描本地程序</span>
          </SortableActionButton>
        );
      case "import_bookmarks":
        return (
          <SortableActionButton key="import_bookmarks" id="import_bookmarks" onClick={() => runNativeItemScan("bookmarks")} disabled={busy || !pluginEnabled("core-bookmarks")}>
            <Bookmark size={17} />
            <span>导入浏览器书签</span>
          </SortableActionButton>
        );
      case "export_backup":
        return (
          <SortableActionButton key="export_backup" id="export_backup" onClick={runExport} disabled={busy}>
            <Download size={17} />
            <span>导出数据备份</span>
          </SortableActionButton>
        );
      case "open_command_panel":
        return (
          <SortableActionButton key="open_command_panel" id="open_command_panel" onClick={() => setPaletteOpen(true)}>
            <Command size={17} />
            <span>打开命令面板</span>
          </SortableActionButton>
        );
      default:
        return null;
    }
  };

  const renderDashboard = () => (
    <section className="page-layout dashboard-page">
      <section className="group-tabs-row" aria-label="资源分组">
        <div className="group-tabs group-tabs-main">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleGroupDragStart}
            onDragEnd={handleGroupDragEnd}
            onDragCancel={handleGroupDragCancel}
            modifiers={[restrictToHorizontalAxis]}
          >
            <SortableContext items={visibleGroups.map((g) => g.id)} strategy={horizontalListSortingStrategy}>
              {visibleGroups.map((group) => (
                <SortableGroupTab
                  key={group.id}
                  group={group}
                  activeGroup={activeGroup}
                  setActiveGroup={setActiveGroup}
                  hotkey={hotkeysBoundToGroup[group.id]}
                  hotkeyBinderEnabled={hotkeyBinderEnabled}
                  externalDropTarget={externalDropGroupId === group.id}
                  renderIcon={Icon}
                />
              ))}
            </SortableContext>
          </DndContext>
          <button className="add-group-tab" onClick={addCustomGroup} disabled={busy}>
            <PlusCircle size={16} />
            <span>新分组</span>
          </button>
        </div>
        <button
          type="button"
          className={`workbench-toggle-btn group-tabs-toggle ${workbenchVisible ? "active" : ""}`}
          title={workbenchVisible ? "收起工作台" : "展开工作台"}
          onClick={toggleWorkbenchPanel}
        >
          {workbenchVisible ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </section>

      <section className={`dashboard-grid ${workbenchVisible ? "" : "workbench-collapsed"}`}>
        <section className="surface-panel resource-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Resources</p>
              <h2>{filteredItems.length} 个资源</h2>
            </div>
            <div className="section-actions">
              <span>{favoriteItems.length} 个星标 · {items.length} 个总条目</span>
              <button
                type="button"
                className="secondary-action compact-action"
                onClick={() => setDialog({ type: "create-subtag", value: "", itemIds: [] })}
              >
                添加子目录
              </button>
              <button type="button" className="secondary-action compact-action" onClick={() => (batchMode ? exitBatchMode() : enterBatchMode())}>
                {batchMode ? "退出批量" : "批量管理"}
              </button>
            </div>
          </div>

          {batchMode && (
            <div className="batch-toolbar">
              <strong>已选 {selectedIds.length} 个</strong>
              <span className="batch-selection-hint">Shift + 点击可连续选择</span>
              <button type="button" onClick={selectAllCurrent}>全选当前</button>
              <button type="button" onClick={clearSelectedItems}>清空</button>
              {workspacesFeatureEnabled && (
                <button type="button" onClick={createWorkspaceFromActiveGroup} disabled={busy || selectedIds.length === 0}>创建为工作区</button>
              )}
              <button type="button" onClick={batchMoveSelected} disabled={busy || selectedIds.length === 0}>加标签</button>
              <button type="button" onClick={batchRemoveTagSelected} disabled={busy || selectedIds.length === 0}>批量移除标签</button>
              <button
                type="button"
                onClick={() => {
                  setSubTagSelectModal({
                    isOpen: true,
                    currentValue: "",
                    onSelect: (val) => {
                      confirmBatchMoveToSubTag(val);
                    }
                  });
                }}
                disabled={busy || selectedIds.length === 0}
              >
                移动至子目录
              </button>
              <button type="button" className="danger-action" onClick={batchDeleteSelected} disabled={busy || selectedIds.length === 0}>删除</button>
            </div>
          )}

          <div className={`resource-list display-${settings?.displayMode ?? "simple"}`}>
            <DndContext
              sensors={batchMode ? [] : sensors}
              collisionDetection={customCollisionDetection}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              {subTagTree.length > 0 ? (
                <>
                  <DroppableRootSection displayMode={settings?.displayMode ?? "simple"}>
                    {rootResourceItems.length > 0 ? (
                      renderResourceCards(rootResourceItems)
                    ) : (
                      <div className="root-empty-droppable-area" style={{ padding: '24px 16px', border: '1px dashed var(--line)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', margin: '8px 0', opacity: 0.7, background: 'rgba(255, 255, 255, 0.02)' }}>
                        拖拽资源到此处移回主目录
                      </div>
                    )}
                  </DroppableRootSection>
                  <section className="subtag-resource-block">
                    <div className="section-head slim">
                      <p className="eyebrow">Sub Tags</p>
                      <h2>子目录</h2>
                    </div>
                    <SortableContext items={subTagTree.map(node => `subtag-sortable-${node.path}`)} strategy={verticalListSortingStrategy}>
                      {subTagTree.map((node) => renderSubTagResourceSection(node))}
                    </SortableContext>
                  </section>
                </>
              ) : (
                renderResourceCards(renderedItems)
              )}
              {createPortal(
                <DragOverlay>
                  {activeId ? (() => {
                    const activeItem = itemById.get(activeId);
                    if (!activeItem) return null;
                    return (
                      <SortableResourceRow
                        item={activeItem}
                        selectedIds={selectedIds}
                        batchMode={batchMode}
                        busy={busy}
                        onToggleSelected={toggleSelected}
                        onOpenItem={openItem}
                        groups={groups}
                        tripCounts={tripCounts}
                        showTripsAction={tripsFeatureEnabled}
                        onOpenTrips={(selectedItem) => {
                          setTripPanelItem(selectedItem);
                          setTripPanelHighlightId(null);
                        }}
                        onToggleFavorite={toggleFavorite}
                        onEdit={(selectedItem) => setEditor({ mode: "edit", item: selectedItem, input: inputFromItem(selectedItem) })}
                        onDelete={removeItem}
                        resourceIconStyle={resourceIconStyle}
                        renderIcon={Icon}
                        formatLastLaunched={lastLaunchedText}
                        isOverlay={true}
                        isSimple={isSimple}
                        densityFactor={densityFactor}
                      />
                    );
                  })() : null}
                </DragOverlay>,
                document.body
              )}
            </DndContext>
            {renderedItems.length < filteredItems.length && (
              <div className="resource-progressive-load">
                <span>已显示 {renderedItems.length} / {filteredItems.length} 个资源</span>
                <button
                  type="button"
                  className="secondary-action compact-action"
                  onClick={() => setResourceRenderLimit((current) => current + RESOURCE_RENDER_PAGE_SIZE)}
                >
                  继续加载
                </button>
              </div>
            )}
            {filteredItems.length === 0 && (
              <div className="empty-state">
                <Search size={28} />
                <strong>未发现匹配资源</strong>
                <span>调整搜索关键词、切换分组，或导入本地资源。</span>
              </div>
            )}
          </div>
        </section>

        {workbenchVisible && (
          <aside className="surface-panel operations-panel resource-detail-panel">
            <div className="resource-workbench-head">
              <div>
                <p className="eyebrow">Workbench</p>
                <h2>工作台</h2>
              </div>
            </div>

            {workbenchShowStatistics && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleStatisticsDragEnd}
              >
                <SortableContext items={workbenchStatisticsOrder} strategy={rectSortingStrategy}>
                  <section className="kpi-grid workbench-kpi-grid" aria-label="工作台概览">
                    {workbenchStatisticsOrder.map((id) => renderKpiCard(id))}
                  </section>
                </SortableContext>
              </DndContext>
            )}

            {workbenchShowStatus && (
            <section className="status-card">
              <div className="status-icon">
                <ShieldCheck size={20} />
              </div>
              <div>
                <p>系统状态</p>
                <strong>工作台运行正常</strong>
                <span>所有核心插件已就绪</span>
              </div>
            </section>
            )}

            {workbenchShowWorkspaces && workspacesFeatureEnabled && dashboardWorkspaces.length > 0 && (
              <section className="operation-group workspaces-operation-group">
                <div className="section-head slim">
                  <h2>快捷工作区</h2>
                </div>
                <div className="dashboard-workspaces-list">
                  {dashboardWorkspaces.slice(0, 5).map((ws) => (
                    <div key={ws.id} className="dashboard-workspace-item">
                      <div
                        className="dashboard-ws-icon"
                        style={{
                          backgroundColor: `${ws.color}15`,
                          color: ws.color,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center"
                        }}
                      >
                        {getWorkspaceIcon(ws.icon || "Briefcase", ws.color, 16)}
                      </div>
                      <div className="dashboard-ws-info">
                        <strong>{ws.name}</strong>
                        <span>已启动 {ws.launchCount || 0} 次</span>
                      </div>
                      <button
                        type="button"
                        className="dashboard-ws-run-btn"
                        onClick={() => launchWorkspaceFromDashboard(ws.id)}
                        title="启动此工作区"
                      >
                        <Play size={12} fill="currentColor" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {workbenchShowActions && (
              <section className="operation-group">
                <div className="section-head slim">
                  <h2>常用操作</h2>
                </div>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleActionsDragEnd}
                >
                  <SortableContext items={workbenchActionsOrder} strategy={rectSortingStrategy}>
                    {workbenchActionsOrder.map((id) => renderActionButton(id))}
                  </SortableContext>
                </DndContext>
              </section>
            )}

            {workbenchShowToast && (
            <section className="toast-line">
              <CheckCircle2 size={18} />
              <span>{toast}</span>
            </section>
            )}
          </aside>
        )}
      </section>
    </section>
  );

  const renderTripsPage = () => {
    const totalTrips = Object.values(tripCounts).reduce((sum, value) => sum + value, 0);
    const resourceWithTrips = Object.values(tripCounts).filter((value) => value > 0).length;
    return (
      <section className="page-layout trips-page">
        <section className="kpi-grid trips-kpis" aria-label="Tips 概览">
          <article className="kpi-card">
            <span>Tips 总数</span>
            <strong>{totalTrips}</strong>
            <em>资源使用提示</em>
          </article>
          <article className="kpi-card">
            <span>覆盖资源</span>
            <strong>{resourceWithTrips}</strong>
            <em>{items.length} 个资源中已记录</em>
          </article>
          <article className="kpi-card">
            <span>搜索结果</span>
            <strong>{tripSearchResults.length}</strong>
            <em>{tripsQuery ? "当前关键词" : "最近更新"}</em>
          </article>
          <article className="kpi-card">
            <span>插件入口</span>
            <strong>{pluginEnabled("tips-search") ? "启用" : "停用"}</strong>
            <em>命令面板增强</em>
          </article>
        </section>

        <section className="surface-panel trips-surface">
          <div className="section-head">
            <div>
              <p className="eyebrow">Tip Notes</p>
              <h2>资源提示笔记</h2>
            </div>

          </div>

          <div className="trips-result-grid">
            {tripSearchResults.map((result) => {
              const item = itemById.get(result.itemId);
              return (
                <article key={result.trip.id} className="trip-result-card">
                  <div className="trip-result-head">
                    <span className={`trip-chip ${result.trip.category}`}>{tripCategoryLabels[result.trip.category]}</span>
                    {result.trip.status && <span className={`trip-status ${result.trip.status}`}>{tripStatusLabels[result.trip.status] ?? result.trip.status}</span>}
                  </div>
                  <h3>{result.trip.title}</h3>
                  <p>{result.trip.content.replace(/[#*_`|>-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || "暂无内容"}</p>
                  <div className="trip-result-meta">
                    <span>
                      <Icon name={result.itemIcon} size={15} />
                      {result.itemTitle}
                    </span>
                    <button
                      type="button"
                      className="secondary-action compact-action"
                      onClick={() => {
                        if (item) {
                          setTripPanelItem(item);
                          setTripPanelHighlightId(result.trip.id);
                        }
                      }}
                    >
                      查看
                    </button>
                  </div>
                </article>
              );
            })}
            {tripSearchResults.length === 0 && (
              <div className="empty-state trips-empty-state">
                <Lightbulb size={28} />
                <strong>还没有匹配的 Tips</strong>
                <span>从资源卡片上的灯泡按钮开始记录。</span>
              </div>
            )}
          </div>
        </section>
      </section>
    );
  };

  const renderPlugins = () => (
    <section className="settings-page-grid plugins-settings">
      <div className="setting-card wide-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Plugins</p>
            <h2>插件管理</h2>
          </div>
          <button className="secondary-action" onClick={toggleSafeMode} disabled={busy}>
            <ShieldAlert size={17} />
            {settings?.safeMode ? "关闭安全模式" : "开启安全模式"}
          </button>
        </div>
        <div className="data-table plugin-table">
          {plugins.map((plugin) => (
            <article key={plugin.id} className={`data-row plugin-card ${!plugin.enabled ? "is-disabled" : ""}`}>
              <div className="data-main">
                <strong>{plugin.name}</strong>
                <span>{plugin.description}</span>
              </div>
              <div className="permission-row">
                {plugin.permissions.slice(0, 3).map((permission) => (
                  <em key={permission.id} className={`risk-${permission.risk}`}>{permission.label}</em>
                ))}
              </div>
              <small>{plugin.builtin ? "核心插件" : "本地插件"} · v{plugin.version}</small>
              <div className="plugin-actions">
                <button className="secondary-action compact-action" onClick={() => setSelectedPlugin(plugin)}>
                  详情
                </button>
                <button className={`switch-button ${plugin.enabled ? "on" : ""}`} onClick={() => togglePlugin(plugin)} disabled={busy}>
                  <Power size={16} />
                  {plugin.enabled ? "停用" : "启用"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
      <div className="setting-card info-card">
        <p className="eyebrow">Behavior</p>
        <h2>即时生效</h2>
        <p>停用网址插件后，相关分组和资源会从界面隐藏，数据仍保留在本地数据库中。</p>
        <button className="wide-command" onClick={() => setActiveGroup("web")}>
          <Globe size={17} />
          <span>检查网址分组</span>
        </button>
      </div>
    </section>
  );

  const renderThemes = () => {
    const isPremiumTheme = (themeId: string) => {
      return ["local-galaxy", "orbit-dark", "ink-blue", "creative-mode"].includes(themeId);
    };

    const isBasicLight = (themeId: string) => {
      return ["atelier-zero", "atelier-charcoal", "atelier-mint", "atelier-sky", "atelier-pink", "atelier-grey", "atelier-lavender"].includes(themeId);
    };

    const isBasicDark = (themeId: string) => {
      return ["atelier-rust", "atelier-coal", "atelier-abyss", "atelier-amber"].includes(themeId);
    };

    const premiumThemes = themes.filter((t) => isPremiumTheme(t.id));
    const basicLightThemes = themes.filter((t) => isBasicLight(t.id));
    const basicDarkThemes = themes.filter((t) => isBasicDark(t.id));
    const otherThemes = themes.filter((t) => !isPremiumTheme(t.id) && !isBasicLight(t.id) && !isBasicDark(t.id));
    const allPremium = [...premiumThemes, ...otherThemes];

    const renderThemeCard = (theme: ThemeManifest) => (
      <button key={theme.id} className={`theme-card ${theme.id === settings?.activeThemeId ? "selected" : ""}`} onClick={() => changeTheme(theme.id)}>
        <span className="theme-swatches">
          <i style={{ background: theme.tokens["--bg"] }} />
          <i style={{ background: theme.tokens["--accent"] }} />
          <i style={{ background: theme.tokens["--accent-2"] }} />
          <i style={{ background: theme.tokens["--accent-3"] }} />
        </span>
        <strong>{theme.name}</strong>
        <small>{theme.description}</small>
        <em>{theme.builtin ? "官方主题" : "本地主题包"}</em>
      </button>
    );

    return (
      <section className="settings-page-grid theme-settings">
        <div className="setting-card wide-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Theme</p>
              <h2>{activeTheme?.name ?? "未选择主题"}</h2>
            </div>
          </div>
          <div className="theme-group-container">
            <h3 className="theme-group-title">高级主题</h3>
            <div className="theme-grid">
              {allPremium.map(renderThemeCard)}
            </div>
            <h3 className="theme-group-title">基础主题 - 亮色</h3>
            <div className="theme-grid">
              {basicLightThemes.map(renderThemeCard)}
            </div>
            <h3 className="theme-group-title">基础主题 - 暗色</h3>
            <div className="theme-grid">
              {basicDarkThemes.map(renderThemeCard)}
            </div>
          </div>
        </div>
        <div className="setting-card info-card">
          <p className="eyebrow">Directory</p>
          <h2>主题包目录</h2>
          <p>{settings?.dataDir ? `${settings.dataDir}\\themes` : "加载中"}</p>
          <button className="wide-command" onClick={openDataDir}>
            <FolderOpen size={17} />
            <span>打开数据目录</span>
          </button>
        </div>
      </section>
    );
  };

  const renderDev = () => (
    <section className="settings-page-grid dev-settings">
      <div className="setting-card">
        <p className="eyebrow">Development</p>
        <h2>插件开发工具</h2>
        <p>创建标准插件包结构，接入命令注册、搜索提供者、桌面通知等核心能力。</p>
        <button className="wide-command" onClick={createTemplate} disabled={busy}>
          <FileCode2 size={17} />
          <span>创建插件模板</span>
        </button>
        <button className="wide-command" onClick={openDataDir}>
          <FolderOpen size={17} />
          <span>打开插件目录</span>
        </button>
      </div>
      <div className="setting-card">
        <p className="eyebrow">Theme Dev</p>
        <h2>可分享主题包</h2>
        <p>主题包通过 theme.json 声明 CSS tokens，支持附加 theme.css 扩展高级视觉样式。</p>
        <button className="wide-command" onClick={() => copyToast(JSON.stringify(activeTheme, null, 2))}>
          <Copy size={17} />
          <span>复制当前主题</span>
        </button>
      </div>
      <div className="setting-card wide-card">
        <p className="eyebrow">Local First</p>
        <h2>数据路径</h2>
        <div className="path-list">
          <code>{settings?.dataDir ?? "loading"}\\orbit.db</code>
          <code>{settings?.dataDir ?? "loading"}\\plugins</code>
          <code>{settings?.dataDir ?? "loading"}\\themes</code>
          <code>{settings?.dataDir ?? "loading"}\\backups</code>
        </div>
      </div>
    </section>
  );

  const renderObsidianPage = () => {
    const today = todayKey();
    const totalIndexedTasks = obsidianVaults.reduce((sum, vault) => sum + vault.taskCount, 0);
    const totalIndexedFiles = obsidianVaults.reduce((sum, vault) => sum + vault.fileCount, 0);
    const dueToday = obsidianTasks.filter((task) => task.dueDate === today).length;
    const activeVault = obsidianVaults.find((vault) => vault.id === activeObsidianVault);

    return (
      <section className="page-layout obsidian-page">
        <section className="kpi-grid obsidian-kpis" aria-label="Obsidian overview">
          <article className="kpi-card">
            <span>未完成待办</span>
            <strong>{obsidianTasks.length}</strong>
            <em>当前搜索范围</em>
          </article>
          <article className="kpi-card">
            <span>今日到期</span>
            <strong>{dueToday}</strong>
            <em>{today}</em>
          </article>
          <article className="kpi-card">
            <span>已配置 Vault</span>
            <strong>{obsidianVaults.length}</strong>
            <em>{activeVault?.name ?? "全部仓库"}</em>
          </article>
          <article className="kpi-card">
            <span>索引规模</span>
            <strong>{totalIndexedFiles}</strong>
            <em>{totalIndexedTasks} 条 checkbox</em>
          </article>
        </section>

        <section className="group-tabs obsidian-vault-tabs" aria-label="Obsidian vault tabs">
          <button type="button" className={activeObsidianVault === "all" ? "selected" : ""} onClick={() => setActiveObsidianVault("all")}>
            <CircleDot size={16} />
            <span>全部</span>
            <em>{totalIndexedFiles}</em>
          </button>
          {obsidianVaults.map((vault) => (
            <button key={vault.id} type="button" className={activeObsidianVault === vault.id ? "selected" : ""} onClick={() => setActiveObsidianVault(vault.id)}>
              <NotebookText size={16} />
              <span>{vault.name}</span>
              <em>{vault.fileCount}</em>
            </button>
          ))}
          {obsidianVaults.length === 0 && (
            <button type="button" onClick={addObsidianVaultFromPicker} disabled={busy}>
              <FolderOpen size={16} />
              <span>添加 Vault</span>
            </button>
          )}
        </section>

        <section className="surface-panel obsidian-surface">
          <div className="section-head">
            <div>
              <p className="eyebrow">Obsidian Local Index</p>
              <h2>{obsidianNotes.length} 篇笔记</h2>
            </div>
            <div className="section-actions obsidian-toolbar">
              <span>{obsidianVaults.length} 个 vault · {totalIndexedTasks} 条 checkbox</span>
              <button type="button" className="secondary-action compact-action" onClick={addObsidianVaultFromPicker} disabled={busy}>
                <FolderOpen size={16} />
                添加 Vault
              </button>
              <button type="button" className="secondary-action compact-action" onClick={rescanAllObsidianVaults} disabled={busy || obsidianVaults.length === 0}>
                <RefreshCcw size={16} className={obsidianScanningId ? "spin-icon" : ""} />
                重新扫描
              </button>
            </div>
          </div>



          <div className="resource-list obsidian-note-list">
            {obsidianNotes.map((note) => {
              const linkedItem = itemByTarget.get(note.filePath);
              const isFavorite = linkedItem?.favorite ?? note.favorite;
              return (
                <article key={note.id} className={`resource-row obsidian-note-row ${linkedItem ? "is-resource" : ""}`}>
                  <button type="button" className="resource-launch" onClick={() => void openObsidianNoteResource(note)} disabled={busy}>
                    <span className="resource-icon obsidian-note-icon" style={{ "--accent": linkedItem?.accent ?? "#8b7cf6", "--asset-icon-base": "none" } as CSSProperties}>
                      <NotebookText size={25} />
                    </span>
                    <span className="resource-copy">
                      <strong>{note.title}</strong>
                      <small>{note.relativePath}</small>
                      <span className="resource-group-tags" aria-label="note tags">
                        <em>{note.vaultName}</em>
                        {note.tags.slice(0, 2).map((tag) => (
                          <em key={tag}>{tag}</em>
                        ))}
                        {linkedItem && <em>资源中心</em>}
                      </span>
                    </span>
                    <span className="resource-meta-column">
                      <em>{note.taskCount} 条待办</em>
                      <small>{formatIndexTime(note.modifiedAt)}</small>
                    </span>
                  </button>
                  <div className="tile-actions obsidian-note-actions">
                    <button title="Add to todo" onClick={() => void openTodoPanelForNote(note)} disabled={busy || note.taskCount === 0}>
                      <CheckCircle2 size={15} />
                    </button>
                    <button className={`favorite-action ${isFavorite ? "is-favorite" : ""}`} title="Favorite" onClick={() => void toggleObsidianNoteFavoriteAction(note)} disabled={busy}>
                      {isFavorite ? <img src={localGalaxyAssets.icons.favoriteStar20.src} alt="" /> : <Star size={15} />}
                    </button>
                    <button title={linkedItem ? "Edit resource" : "Open note"} onClick={() => editObsidianNoteResource(note)} disabled={busy}>
                      <Pencil size={15} />
                    </button>
                    {linkedItem ? (
                      <button title="Remove from resource center" onClick={() => removeItem(linkedItem)} disabled={busy}>
                        <Trash2 size={15} />
                      </button>
                    ) : (
                      <button title="Add to resource center" onClick={() => void addObsidianNoteToResources(note)} disabled={busy}>
                        <PlusCircle size={15} />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
            {obsidianNotes.length === 0 && (
              <div className="empty-state obsidian-empty-state">
                <NotebookText size={28} />
                <strong>{obsidianVaults.length ? "没有匹配的笔记" : "还没有配置 Obsidian Vault"}</strong>
                <span>{obsidianVaults.length ? "调整搜索或重新扫描 vault。" : "添加 vault 后，OrbitStart 会建立只读本地索引。"}</span>
                <button type="button" className="secondary-action compact-action" onClick={obsidianVaults.length ? rescanAllObsidianVaults : addObsidianVaultFromPicker} disabled={busy}>
                  {obsidianVaults.length ? "重新扫描" : "添加 Vault"}
                </button>
              </div>
            )}
          </div>
        </section>
      </section>
    );
  };

  const renderLogs = () => (
    <section className="settings-page-grid logs-settings">
      <div className="setting-card wide-card logs-panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">Logs</p>
            <h2>{logs.length} 条最近事件</h2>
          </div>
        </div>
        <div className="log-list">
          {logs.map((log) => (
            <article key={log.id} className={`log-row ${log.level}`}>
              <strong>{log.pluginId}</strong>
              <span>{log.message}</span>
              <em>{lastLaunchedText({ lastLaunchedAt: log.createdAt } as OrbitItem)}</em>
            </article>
          ))}
          {logs.length === 0 && <p className="empty-copy">暂无插件日志。</p>}
        </div>
      </div>
    </section>
  );

  const renderGeneralSettings = () => (
    <section className="settings-page-grid general-settings">
      <div className="setting-card">
        <p className="eyebrow">General</p>
        <h2>通用配置</h2>
        <p>控制界面密度、全局热键与插件安全策略。</p>
        <div className="setting-list">
          <label>
            全局热键
            <div className="hotkey-input-container">
              <input
                ref={hotkeyInputRef}
                value={isRecordingHotkey ? (recordedKeys.join("+") || "请按下快捷键...") : (settings?.globalHotkey ?? "Ctrl+Alt+Space")}
                readOnly
                onKeyDown={handleHotkeyKeyDown}
                className={isRecordingHotkey ? "recording" : ""}
                placeholder="请按下快捷键..."
                style={{ cursor: isRecordingHotkey ? "pointer" : "default" }}
              />
              {isRecordingHotkey ? (
                <>
                  <button type="button" className="action-btn confirm-btn" onClick={saveHotkey} disabled={busy}>
                    确定
                  </button>
                  <button type="button" className="action-btn cancel-btn" onClick={() => { setIsRecordingHotkey(false); setRecordedKeys([]); }} disabled={busy}>
                    取消
                  </button>
                </>
              ) : (
                <button type="button" className="action-btn" onClick={() => { setIsRecordingHotkey(true); setRecordedKeys([]); setTimeout(() => hotkeyInputRef.current?.focus(), 50); }}>
                  自定义
                </button>
              )}
            </div>
          </label>
          <label>
            热键功能选择
            <select value={settings?.hotkeyBehavior === "open_only" ? "open_only" : "command_bar"} onChange={(event) => changeHotkeyBehavior(event.target.value as "command_bar" | "open_only")}>
              <option value="command_bar">当前版本的 OrbitStart Command Bar</option>
              <option value="open_only">先前版本单纯打开 OrbitStart</option>
            </select>
          </label>
          <label>
            关闭按钮
            <select value={settings?.closeBehavior === "exit" ? "exit" : "tray"} onChange={(event) => changeCloseBehavior(event.target.value as "tray" | "exit")}>
              <option value="tray">隐藏到托盘</option>
              <option value="exit">直接退出</option>
            </select>
          </label>
          <label className="setting-inline">
            <input type="checkbox" checked={Boolean(settings?.safeMode)} onChange={toggleSafeMode} />
            安全模式
          </label>
          {isTauriRuntime() && (
            <label className="setting-inline">
              <input type="checkbox" checked={autostartState} onChange={toggleAutostart} />
              开机自启动
            </label>
          )}
        </div>
      </div>
      <div className="setting-card">
        <p className="eyebrow">Launcher</p>
        <h2>主页行为</h2>
        <p>配置首页资源管理方式与本地程序扫描入口。</p>
        <div className="setting-list action-stack">
          <label className="setting-inline">
            <input type="checkbox" checked={batchMode} onChange={(event) => (event.target.checked ? enterBatchMode() : exitBatchMode())} />
            批量操作模式
          </label>
          <label className="setting-inline">
            <input type="checkbox" checked={Boolean(settings?.autoPinnedMode)} onChange={toggleAutoPinnedMode} />
            自动置顶模式
          </label>
          <label>
            资源卡片显示模式
            <select value={settings?.displayMode === "detailed" ? "detailed" : "simple"} onChange={(event) => changeDisplayMode(event.target.value as "simple" | "detailed")}>
              <option value="simple">简约模式</option>
              <option value="detailed">详细模式</option>
            </select>
          </label>
          <button className="wide-command" onClick={addCustomGroup}>
            <PlusCircle size={17} />
            <span>新建自定义分组</span>
          </button>
          <button className="wide-command" onClick={() => runNativeItemScan("shortcuts")}>
            <ScanSearch size={17} />
            <span>重新扫描本地图标</span>
          </button>
        </div>
      </div>
    </section>
  );

  const renderWorkbenchSettings = () => (
    <section className="settings-page-grid workbench-settings">
      <div className="setting-card wide-card">
        <p className="eyebrow">Workbench</p>
        <h2>工作台显示</h2>
        <p>控制首页右侧工作台是否显示，以及工作台内保留哪些内容块。</p>
        <div className="setting-list">
          <label className="setting-inline">
            <input
              type="checkbox"
              checked={workbenchVisible}
              onChange={(event) => void persistWorkbenchSetting("workbench_visible", event.target.checked)}
            />
            显示工作台
          </label>
          <label className="setting-inline">
            <input
              type="checkbox"
              checked={workbenchShowStatus}
              onChange={(event) => void persistWorkbenchSetting("workbench_show_status", event.target.checked)}
              disabled={!workbenchVisible}
            />
            显示系统状态
          </label>
          <label className="setting-inline">
            <input
              type="checkbox"
              checked={workbenchShowWorkspaces}
              onChange={(event) => void persistWorkbenchSetting("workbench_show_workspaces", event.target.checked)}
              disabled={!workbenchVisible}
            />
            显示快捷工作区
          </label>
          <label className="setting-inline">
            <input
              type="checkbox"
              checked={workbenchShowActions}
              onChange={(event) => void persistWorkbenchSetting("workbench_show_actions", event.target.checked)}
              disabled={!workbenchVisible}
            />
            显示常用操作
          </label>
          <label className="setting-inline">
            <input
              type="checkbox"
              checked={workbenchShowToast}
              onChange={(event) => void persistWorkbenchSetting("workbench_show_toast", event.target.checked)}
              disabled={!workbenchVisible}
            />
            显示状态提示
          </label>
          <label className="setting-inline">
            <input
              type="checkbox"
              checked={workbenchShowStatistics}
              onChange={(event) => void persistWorkbenchSetting("workbench_show_statistics", event.target.checked)}
              disabled={!workbenchVisible}
            />
            显示信息统计
          </label>
        </div>
      </div>

      <div className="setting-card">
        <p className="eyebrow">Layout</p>
        <h2>开关位置</h2>
        <p>工作台展开/收起按钮固定在根标签栏右侧，标签较多时仅标签区域横向滚动，按钮不会被遮挡。</p>
      </div>
    </section>
  );

  const renderBubbleSettings = () => {
    const bubbleOpacityValue = bubbleOpacityDraft ?? settings?.bubbleOpacity ?? 1.0;

    const patchBubbleSetting = (key: string, value: string) => {
      const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()) as keyof AppSettings;
      const parsedValue = value === "true" ? true : value === "false" ? false : Number.isNaN(Number(value)) ? value : Number(value);
      setSettings((prev) => prev ? ({ ...prev, [camelKey]: parsedValue } as AppSettings) : prev);
    };

    const persistBubbleSetting = async (key: string, value: string) => {
      const previousSettings = settings;
      patchBubbleSetting(key, value);
      try {
        const nextSettings = await setBubbleSetting(key, value);
        setSettings(nextSettings);
        return nextSettings;
      } catch (error) {
        setSettings(previousSettings);
        setToast(`悬浮球设置保存失败：${String(error)}`);
        return null;
      }
    };

    const commitBubbleOpacity = async (value: number | null = bubbleOpacityDraft) => {
      if (value === null || !Number.isFinite(value)) return;
      const next = Math.max(0.1, Math.min(1, value));
      setBubbleOpacityDraft(null);
      await persistBubbleSetting("bubble_opacity", String(next));
    };

    return (
      <section className="settings-page-grid bubble-settings">
        <div className="setting-card wide-card">
          <p className="eyebrow">Desktop Experience</p>
          <h2>悬浮启动球</h2>
          <p>控制启动球的启用状态、缩放尺寸、吸附与不透明度。</p>
          <div className="setting-list">
            <label className="setting-inline">
              <input
                type="checkbox"
                checked={Boolean(settings?.bubbleEnabled)}
                onChange={async (event) => {
                  const checked = event.currentTarget.checked;
                  const snapshot = await persistBubbleSetting("bubble_enabled", checked ? "true" : "false");
                  if (!snapshot) return;
                  if (!checked) {
                    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
                    const bubble = await WebviewWindow.getByLabel("floating-bubble").catch(() => null);
                    await bubble?.destroy().catch(() => undefined);
                  }
                }}
              />
              启用悬浮启动球
            </label>
            <label className="setting-inline">
              <input
                type="checkbox"
                checked={Boolean(settings?.bubbleShowWhenMainHidden)}
                onChange={(event) => void persistBubbleSetting("bubble_show_when_main_hidden", event.currentTarget.checked ? "true" : "false")}
              />
              主窗口隐藏时显示悬浮球
            </label>
            <label className="setting-inline">
              <input
                type="checkbox"
                checked={Boolean(settings?.bubbleAlwaysOnTop)}
                onChange={(event) => void persistBubbleSetting("bubble_always_on_top", event.currentTarget.checked ? "true" : "false")}
              />
              悬浮球始终置顶
            </label>
            <label>
              悬浮球大小
              <select
                value={settings?.bubbleSize ?? 64}
                onChange={(event) => void persistBubbleSetting("bubble_size", event.currentTarget.value)}
              >
                <option value="56">小 (56px)</option>
                <option value="64">中 (64px)</option>
                <option value="72">大 (72px)</option>
              </select>
            </label>
            <label className="setting-inline">
              <input
                type="checkbox"
                checked={Boolean(settings?.bubbleSnapToEdge)}
                onChange={(event) => void persistBubbleSetting("bubble_snap_to_edge", event.currentTarget.checked ? "true" : "false")}
              />
              靠边吸附
            </label>
            <label className="setting-inline">
              <input
                type="checkbox"
                checked={Boolean(settings?.bubbleExpandOnHover)}
                onChange={(event) => void persistBubbleSetting("bubble_expand_on_hover", event.currentTarget.checked ? "true" : "false")}
              />
              鼠标悬浮展开快捷小球
            </label>
            <label className="setting-inline">
              <input
                type="checkbox"
                checked={Boolean(settings?.bubbleAvoidFullscreen)}
                onChange={(event) => void persistBubbleSetting("bubble_avoid_fullscreen", event.currentTarget.checked ? "true" : "false")}
              />
              自动规避全屏应用
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                <span>不透明度</span>
                <span>{Math.round(bubbleOpacityValue * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={bubbleOpacityValue}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (!Number.isFinite(next)) return;
                  setBubbleOpacityDraft(next);
                  patchBubbleSetting("bubble_opacity", String(next));
                  void emit("orbit://bubble-opacity-preview", next).catch(() => undefined);
                }}
                onPointerUp={(event) => void commitBubbleOpacity(Number(event.currentTarget.value))}
                onPointerCancel={(event) => void commitBubbleOpacity(Number(event.currentTarget.value))}
                onKeyUp={(event) => {
                  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
                    void commitBubbleOpacity(Number(event.currentTarget.value));
                  }
                }}
                onBlur={(event) => void commitBubbleOpacity(Number(event.currentTarget.value))}
              />
            </label>
            <button
              type="button"
              className="wide-command"
              onClick={async () => {
                localStorage.removeItem("orbitstart_bubble_position");
                localStorage.removeItem("orbitstart_bubble_align");

                const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
                const { PhysicalPosition } = await import("@tauri-apps/api/dpi");
                const { currentMonitor } = await import("@tauri-apps/api/window");
                try {
                  const bubble = (await WebviewWindow.getByLabel("floating-bubble")) as any;
                  if (bubble) {
                    const monitor = await currentMonitor();
                    if (monitor) {
                      const scaleFactor = monitor.scaleFactor;
                      const monitorX = monitor.position.x;
                      const monitorWidth = monitor.size.width;
                      const monitorY = monitor.position.y;
                      const monitorHeight = monitor.size.height;

                      const configuredSize = settings?.bubbleSize ?? 64;
                      const outerSize = await bubble.outerSize().catch(() => null);
                      const bubbleWidth = outerSize?.width ?? Math.round(configuredSize * scaleFactor);
                      const bubbleHeight = outerSize?.height ?? Math.round(configuredSize * scaleFactor);
                      const visualDiameter = Math.round(configuredSize * scaleFactor);
                      const horizontalInset = Math.max(0, (bubbleWidth - visualDiameter) / 2);
                      const margin = Math.round(4 * scaleFactor);
                      const minX = monitorX + margin - horizontalInset;
                      const maxX = monitorX + monitorWidth - visualDiameter - margin - horizontalInset;
                      const minY = monitorY + margin;
                      const maxY = monitorY + monitorHeight - bubbleHeight - margin;
                      const rawX = monitorX + monitorWidth - bubbleWidth - margin;
                      const rawY = monitorY + monitorHeight * 0.7 - bubbleHeight / 2;
                      const defaultX = Math.min(maxX, Math.max(minX, rawX));
                      const defaultY = Math.min(maxY, Math.max(minY, rawY));
                      await bubble.setPosition(new PhysicalPosition(Math.round(defaultX), Math.round(defaultY)));
                      await bubble.emit("orbit://bubble-reset-position", { x: defaultX, y: defaultY });
                    }
                  }
                } catch (err) {
                  // Ignore reset failures; the next bubble open will compute a safe default.
                }
                setToast("已重置悬浮球位置");
              }}
            >
              <span>重置悬浮球位置</span>
            </button>
          </div>
        </div>
      </section>
    );
  };

  const renderDataSettings = () => (
    <section className="settings-page-grid data-settings">
      <div className="setting-card wide-card">
        <p className="eyebrow">Data</p>
        <h2>数据目录</h2>
        <p>OrbitStart 的数据库、插件、主题与备份文件都存储在本地。</p>
        <div className="path-list">
          <code>{settings?.dataDir ?? "loading"}\\orbit.db</code>
          <code>{settings?.dataDir ?? "loading"}\\plugins</code>
          <code>{settings?.dataDir ?? "loading"}\\themes</code>
          <code>{settings?.dataDir ?? "loading"}\\backups</code>
        </div>
        <button className="wide-command" onClick={openDataDir}>
          <FolderOpen size={17} />
          <span>打开数据目录</span>
        </button>
      </div>
      <div className="setting-card">
        <p className="eyebrow">Backup</p>
        <h2>导入导出</h2>
        <p>导出 JSON 备份，或从已有备份恢复资源目录。</p>
        <button className="wide-command" onClick={runExport}>
          <Download size={17} />
          <span>导出 JSON</span>
        </button>
        <button className="wide-command" onClick={() => setBackupOpen(true)}>
          <Upload size={17} />
          <span>导入 JSON</span>
        </button>
      </div>
      <div className="setting-card">
        <p className="eyebrow">Reset</p>
        <h2>恢复初始化</h2>
        <p>清空所有本地数据，包括所有的资源、分组和配置，恢复到初始安装状态。</p>
        <button className="wide-command danger-btn" onClick={handleResetSoftware}>
          <RefreshCcw size={17} />
          <span>恢复初始化</span>
        </button>
      </div>
    </section>
  );

  const renderAbout = () => (
    <section className="settings-page-grid about-settings">
      <div className="setting-card wide-card about-card">
        <p className="eyebrow">About</p>
        <h2>OrbitStart</h2>
        <p>原创 Windows 启动工作台，面向本地应用、文件、网址、脚本和插件入口的统一管理。</p>
        <div className="about-stats">
          <span><strong>{items.length}</strong>资源</span>
          <span><strong>{enabledPlugins}</strong>启用插件</span>
          <span><strong>{themes.length}</strong>主题</span>
          <span><strong>{APP_VERSION}</strong>版本</span>
        </div>
      </div>
      <div className="setting-card">
        <p className="eyebrow">Desktop Shell</p>
        <h2>桌面外壳</h2>
        <p>自定义标题栏、右键菜单、系统托盘、全局快捷键和外部打开逻辑都由 OrbitStart 接管。</p>
      </div>
      <div className="setting-card">
        <p className="eyebrow">Local Data</p>
        <h2>本地优先</h2>
        <p>{settings?.dataDir ?? "正在加载数据目录"}</p>
      </div>
      <div className="setting-card">
        <p className="eyebrow">Open Source</p>
        <h2>开源项目</h2>
        <p>访问 GitHub 仓库以获取更新或参与贡献。</p>
        <a
          href="https://github.com/xuxinxi14/OrbitStart"
          target="_blank"
          rel="noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
            color: "var(--accent)",
            textDecoration: "none",
            fontSize: "var(--font-size-sm)",
            fontWeight: "600",
            marginTop: "var(--space-2)"
          }}
          onClick={(e) => {
            if (isTauriRuntime()) {
              e.preventDefault();
              void launchTarget("https://github.com/xuxinxi14/OrbitStart");
            }
          }}
        >
          github.com/xuxinxi14/OrbitStart
        </a>
      </div>
    </section>
  );

  const renderObsidianSettings = () => (
    <section className="settings-page-grid obsidian-settings">
      <div className="setting-card wide-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Obsidian</p>
            <h2>Vault 索引</h2>
            <span>只读扫描本地 Markdown checkbox，不写回源文件。</span>
          </div>
          <div className="section-actions obsidian-toolbar">
            <button type="button" className="secondary-action compact-action" onClick={addObsidianVaultFromPicker} disabled={busy}>
              <FolderOpen size={16} />
              添加 Vault
            </button>
            <button type="button" className="secondary-action compact-action" onClick={rescanAllObsidianVaults} disabled={busy || obsidianVaults.length === 0}>
              <RefreshCcw size={16} className={obsidianScanningId ? "spin-icon" : ""} />
              重新扫描
            </button>
          </div>
        </div>
        <div className="obsidian-settings-list">
          {obsidianVaults.map((vault) => (
            <article key={vault.id} className="obsidian-settings-row">
              <div>
                <strong>{vault.name}</strong>
                <span>{vault.path}</span>
                <small>{vault.fileCount} 篇笔记 · {vault.taskCount} 条 checkbox · {formatIndexTime(vault.lastIndexedAt)}</small>
              </div>
              <div>
                <button type="button" className="secondary-action compact-action" onClick={() => setActiveView("obsidian")}>
                  查看
                </button>
                <button
                  type="button"
                  className="secondary-action compact-action"
                  onClick={() => void scanObsidianVault(vault.id)
                    .then(() => refreshObsidian())
                    .catch((error) => {
                      console.error("Failed to scan Obsidian vault:", error);
                      setToast(`Vault 扫描失败：${String(error)}`);
                    })}
                  disabled={busy}
                >
                  扫描
                </button>
                <button type="button" className="secondary-action compact-action danger-soft" onClick={() => void deleteObsidianVault(vault)} disabled={busy}>
                  移除
                </button>
              </div>
            </article>
          ))}
          {obsidianVaults.length === 0 && <p className="empty-copy">尚未添加 vault。添加后可在 Obsidian 页面查看笔记与待办。</p>}
        </div>
      </div>
    </section>
  );

  const renderSettings = () => {
    const sections: Array<{ id: SettingsSection; title: string; icon: JSX.Element }> = [
      { id: "general", title: "基础设置", icon: <Settings size={18} /> },
      { id: "workbench", title: "工作台", icon: <PanelsTopLeft size={18} /> },
      { id: "plugins", title: "插件管理", icon: <Blocks size={18} /> },
      { id: "themes", title: "主题工作室", icon: <Palette size={18} /> },
      ...(obsidianFeatureEnabled ? [{ id: "obsidian" as const, title: "Obsidian", icon: <NotebookText size={18} /> }] : []),
      ...(isTauriRuntime() ? [{ id: "bubble" as const, title: "悬浮启动球", icon: <CircleDot size={18} /> }] : []),
      { id: "dev", title: "开发套件", icon: <Hammer size={18} /> },
      { id: "data", title: "数据备份", icon: <Database size={18} /> },
      { id: "about", title: "关于", icon: <Info size={18} /> }
    ];

    return (
      <section className="settings-shell">
        <aside className="settings-menu">
          {sections.map((section) => (
            <button key={section.id} className={settingsSection === section.id ? "active" : ""} onClick={() => setSettingsSection(section.id)}>
              {section.icon}
              <span>{section.title}</span>
            </button>
          ))}
        </aside>
        <div className="settings-content">
          {settingsSection === "general" && renderGeneralSettings()}
          {settingsSection === "workbench" && renderWorkbenchSettings()}
          {settingsSection === "plugins" && renderPlugins()}
          {settingsSection === "themes" && renderThemes()}
          {settingsSection === "obsidian" && obsidianFeatureEnabled && renderObsidianSettings()}
          {settingsSection === "bubble" && isTauriRuntime() && renderBubbleSettings()}
          {settingsSection === "dev" && renderDev()}
          {settingsSection === "data" && renderDataSettings()}
          {settingsSection === "about" && renderAbout()}
        </div>
      </section>
    );
  };

  const renderAppDialog = () => {
    if (!dialog) return null;
    const moveGroups = visibleGroups.filter((group) => group.id !== "all");

    if (dialog.type === "group-hotkey") {
      const group = groups.find((g) => g.id === dialog.groupId);
      return (
        <section className="palette-backdrop centered-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className="modal-panel dialog-panel">
            <div className="modal-head">
              <div>
                <p className="eyebrow">Hotkey Binder</p>
                <h2>录制分组快捷键</h2>
              </div>
              <button type="button" className="icon-action" onClick={() => setDialog(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <p style={{ fontSize: "var(--font-size-sm)", color: "var(--soft)", marginBottom: "var(--space-4)" }}>
                请按下你想为分类 <strong>{group?.title}</strong> 绑定的全局快捷键（如 <code>Ctrl+Shift+1</code>）。录制完成后窗口将自动关闭。
              </p>
              <label>
                按键录制中...
                <input
                  autoFocus
                  readOnly
                  placeholder="按下按键组合进行录制..."
                  value={dialog.value || "请按下按键..."}
                  onKeyDown={handleGroupHotkeyKeyDown}
                  onKeyUp={handleGroupHotkeyKeyUp}
                  className="recording"
                  style={{ caretColor: "transparent", cursor: "pointer", textAlign: "center", fontSize: "16px", fontWeight: "bold" }}
                />
              </label>
              <p style={{ fontSize: "var(--font-size-xs)", color: "var(--soft)", marginTop: "var(--space-2)" }}>
                支持 Ctrl, Alt, Shift, Win + 任意单键。按 <code>Backspace</code> 清除当前绑定，按 <code>Escape</code> 退出。
              </p>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-action" onClick={() => setDialog(null)}>取消</button>
            </div>
          </div>
        </section>
      );
    }

    if (dialog.type === "group") {
      return (
        <section className="palette-backdrop centered-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <form
            className="modal-panel dialog-panel"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmCustomGroup(dialog.value);
            }}
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">New group</p>
                <h2>新建自定义分组</h2>
              </div>
              <button type="button" className="icon-action" onClick={() => setDialog(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <label>
                分组名称
                <input
                  autoFocus
                  value={dialog.value}
                  onChange={(event) =>
                    setDialog((current) => (current?.type === "group" ? { ...current, value: event.target.value } : current))
                  }
                  placeholder="例如：AI 工具"
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-action" onClick={() => setDialog(null)}>取消</button>
              <button type="submit" className="primary-action" disabled={busy}>创建</button>
            </div>
          </form>
        </section>
      );
    }

    if (dialog.type === "delete-item") {
      return (
        <section className="palette-backdrop centered-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className="modal-panel dialog-panel">
            <div className="modal-head">
              <div>
                <p className="eyebrow">Delete resource</p>
                <h2>删除资源</h2>
              </div>
              <button type="button" className="icon-action" onClick={() => setDialog(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <p className="dialog-warning">这只会从 OrbitStart 资源库中移除条目，不会删除磁盘上的真实文件。</p>
              <div className="dialog-target">
                <Icon name={dialog.item.icon} size={22} />
                <span>
                  <strong>{dialog.item.title}</strong>
                  <small>{dialog.item.target}</small>
                </span>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-action" onClick={() => setDialog(null)}>取消</button>
              <button type="button" className="danger-action dialog-action" onClick={() => void confirmRemoveItem(dialog.item)} disabled={busy}>
                删除
              </button>
            </div>
          </div>
        </section>
      );
    }

    if (dialog.type === "batch-delete") {
      return (
        <section className="palette-backdrop centered-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className="modal-panel dialog-panel">
            <div className="modal-head">
              <div>
                <p className="eyebrow">Batch delete</p>
                <h2>批量删除</h2>
              </div>
              <button type="button" className="icon-action" onClick={() => setDialog(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <p className="dialog-warning">将从资源库移除当前选中的 {selectedIds.length} 个资源，不会删除本地文件。</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-action" onClick={() => setDialog(null)}>取消</button>
              <button type="button" className="danger-action dialog-action" onClick={() => void confirmBatchDeleteSelected()} disabled={busy}>
                删除
              </button>
            </div>
          </div>
        </section>
      );
    }

    if (dialog.type === "batch-move") {
      return (
        <section className="palette-backdrop centered-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className="modal-panel dialog-panel">
            <div className="modal-head">
              <div>
                <p className="eyebrow">Batch move</p>
                <h2>添加到标签</h2>
              </div>
              <button type="button" className="icon-action" onClick={() => setDialog(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <p>已选择 {selectedIds.length} 个资源。选择标签后会追加到资源现有标签中。</p>
              <label>
                目标标签
                <select
                  value={dialog.groupId}
                  onChange={(event) =>
                    setDialog((current) => (current?.type === "batch-move" ? { ...current, groupId: event.target.value } : current))
                  }
                >
                  {moveGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-action" onClick={() => setDialog(null)}>取消</button>
              <button
                type="button"
                className="primary-action"
                onClick={() => void confirmBatchMoveSelected(dialog.groupId)}
                disabled={busy || selectedIds.length === 0 || moveGroups.length === 0}
              >
                添加标签
              </button>
            </div>
          </div>
        </section>
      );
    }

    if (dialog.type === "batch-remove-tag") {
      const selected = items.filter((item) => selectedIds.includes(item.id));
      const selectedItemGroups = Array.from(new Set(selected.flatMap((item) => splitGroupIds(item.group)))).filter(Boolean);
      const tagsToRemove = selectedItemGroups.map(id => {
        const groupObj = groups.find(g => g.id === id);
        return { id, title: groupObj ? groupObj.title : id };
      });

      return (
        <section className="palette-backdrop centered-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className="modal-panel dialog-panel">
            <div className="modal-head">
              <div>
                <p className="eyebrow">Batch remove tag</p>
                <h2>批量移除标签</h2>
              </div>
              <button type="button" className="icon-action" onClick={() => setDialog(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <p>已选择 {selectedIds.length} 个资源。选择标签后会从已选资源中移除该标签。</p>
              {tagsToRemove.length === 0 ? (
                <p style={{ color: "var(--red)" }}>已选择的资源中没有包含任何标签。</p>
              ) : (
                <label>
                  要移除的标签
                  <select
                    value={dialog.tagId}
                    onChange={(event) =>
                      setDialog((current) => (current?.type === "batch-remove-tag" ? { ...current, tagId: event.target.value } : current))
                    }
                  >
                    {tagsToRemove.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-action" onClick={() => setDialog(null)}>取消</button>
              <button
                type="button"
                className="danger-action dialog-action"
                onClick={() => void confirmBatchRemoveTag(dialog.tagId)}
                disabled={busy || selectedIds.length === 0 || tagsToRemove.length === 0 || !dialog.tagId}
              >
                移除标签
              </button>
            </div>
          </div>
        </section>
      );
    }

    if (dialog.type === "template") {
      return (
        <section className="palette-backdrop centered-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <form
            className="modal-panel dialog-panel"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmCreateTemplate(dialog.value);
            }}
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">Plugin template</p>
                <h2>创建插件模板</h2>
              </div>
              <button type="button" className="icon-action" onClick={() => setDialog(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <label>
                模板名称
                <input
                  autoFocus
                  value={dialog.value}
                  onChange={(event) =>
                    setDialog((current) => (current?.type === "template" ? { ...current, value: event.target.value } : current))
                  }
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-action" onClick={() => setDialog(null)}>取消</button>
              <button type="submit" className="primary-action" disabled={busy}>创建</button>
            </div>
          </form>
        </section>
      );
    }

    if (dialog.type === "reset-confirm") {
      return (
        <section className="palette-backdrop centered-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className="modal-panel dialog-panel">
            <div className="modal-head">
              <div>
                <p className="eyebrow" style={{ color: "var(--danger)" }}>Reset Software</p>
                <h2>恢复软件初始化</h2>
              </div>
              <button type="button" className="icon-action" onClick={() => setDialog(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <p className="dialog-warning" style={{ margin: 0, padding: "var(--space-3) var(--space-4)", background: "rgba(255, 122, 144, 0.08)", border: "1px solid rgba(255, 122, 144, 0.2)", borderRadius: "8px", color: "var(--danger)", fontSize: "13px", lineHeight: "1.6" }}>
                确定要恢复初始化吗？这将会清空所有的资源卡片、插件配置和用户自定义分组，且操作不可逆！
              </p>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-action" onClick={() => setDialog(null)}>取消</button>
              <button type="button" className="danger-action dialog-action" onClick={() => { setDialog(null); void confirmResetSoftware(); }} disabled={busy}>
                确定重置
              </button>
            </div>
          </div>
        </section>
      );
    }

    if (dialog.type === "create-subtag") {
      return (
        <section className="palette-backdrop centered-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className="modal-panel dialog-panel">
            <div className="modal-head">
              <div>
                <p className="eyebrow">Sub Tag</p>
                <h2>新建子目录</h2>
              </div>
              <button type="button" className="icon-action" onClick={() => setDialog(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body subtag-dialog-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              <label className="wide-field">
                子目录名称
                <input
                  autoFocus
                  placeholder="例如：开发工具 或 办公/文档"
                  value={dialog.value}
                  onChange={(event) =>
                    setDialog((current) => (current?.type === "create-subtag" ? { ...current, value: event.target.value } : current))
                  }
                />
              </label>

              <div style={{ marginTop: '16px' }}>
                <label style={{ fontWeight: '500', marginBottom: '8px', display: 'block' }}>选择要放入该子目录的资源：</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: '6px', padding: '8px' }}>
                  {filteredItems.map((item) => {
                    const isChecked = dialog.itemIds.includes(item.id);
                    return (
                      <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            const nextItemIds = isChecked
                              ? dialog.itemIds.filter((id) => id !== item.id)
                              : [...dialog.itemIds, item.id];
                            setDialog((current) => (current?.type === "create-subtag" ? { ...current, itemIds: nextItemIds } : current));
                          }}
                        />
                        <Icon name={item.icon} size={15} />
                        <span>{item.title}</span>
                      </label>
                    );
                  })}
                  {filteredItems.length === 0 && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>当前分组下暂无资源</span>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-action" onClick={() => setDialog(null)}>取消</button>
              <button
                type="button"
                className="primary-action"
                disabled={busy || !dialog.value.trim() || dialog.itemIds.length === 0}
                onClick={() => void confirmCreateSubTag(dialog.value, dialog.itemIds)}
              >
                确定创建
              </button>
            </div>
          </div>
        </section>
      );
    }

    if (dialog.type === "subtag-hotkey") {
      return (
        <section className="palette-backdrop centered-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className="modal-panel dialog-panel">
            <div className="modal-head">
              <div>
                <p className="eyebrow">Hotkey Binder</p>
                <h2>录制子目录快捷键</h2>
              </div>
              <button type="button" className="icon-action" onClick={() => setDialog(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <p style={{ fontSize: "var(--font-size-sm)", color: "var(--soft)", marginBottom: "var(--space-4)" }}>
                请按下你想为子目录 <strong>{dialog.subtagPath}</strong> 绑定的全局快捷键（如 <code>Ctrl+Shift+1</code>）。录制完成后窗口将自动关闭。
              </p>
              <label>
                按键录制中...
                <input
                  autoFocus
                  readOnly
                  placeholder="按下按键组合进行录制..."
                  value={dialog.value || "请按下按键..."}
                  onKeyDown={handleSubTagHotkeyKeyDown}
                  onKeyUp={handleSubTagHotkeyKeyUp}
                  className="recording"
                  style={{ caretColor: "transparent", cursor: "pointer", textAlign: "center", fontSize: "16px", fontWeight: "bold" }}
                />
              </label>
              <p style={{ fontSize: "var(--font-size-xs)", color: "var(--soft)", marginTop: "var(--space-2)" }}>
                支持 Ctrl, Alt, Shift, Win + 任意单键。按 <code>Backspace</code> 清除当前绑定，按 <code>Escape</code> 退出。
              </p>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-action" onClick={() => setDialog(null)}>取消</button>
            </div>
          </div>
        </section>
      );
    }

    if (dialog.type === "subtag-rename") {
      return (
        <section className="palette-backdrop centered-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <form
            className="modal-panel dialog-panel"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmRenameSubTag(dialog.oldPath, dialog.value);
            }}
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">Rename subtag</p>
                <h2>重命名子目录</h2>
              </div>
              <button type="button" className="icon-action" onClick={() => setDialog(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <label>
                子目录路径名称
                <input
                  autoFocus
                  value={dialog.value}
                  onChange={(event) =>
                    setDialog((current) => (current?.type === "subtag-rename" ? { ...current, value: event.target.value } : current))
                  }
                  placeholder="例如：开发工具 或 办公/文档"
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-action" onClick={() => setDialog(null)}>取消</button>
              <button type="submit" className="primary-action" disabled={busy}>确定</button>
            </div>
          </form>
        </section>
      );
    }

    if (dialog.type === "subtag-delete-confirm") {
      return (
        <section className="palette-backdrop centered-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className="modal-panel dialog-panel">
            <div className="modal-head">
              <div>
                <p className="eyebrow" style={{ color: "var(--danger)" }}>Delete subtag</p>
                <h2>删除子目录</h2>
              </div>
              <button type="button" className="icon-action" onClick={() => setDialog(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <p className="dialog-warning" style={{ margin: 0, padding: "var(--space-3) var(--space-4)", background: "rgba(255, 122, 144, 0.08)", border: "1px solid rgba(255, 122, 144, 0.2)", borderRadius: "8px", color: "var(--danger)", fontSize: "13px", lineHeight: "1.6" }}>
                确定要删除子目录 <strong>{dialog.subtagPath}</strong> 吗？这只会清除其下所有资源的子目录标记，并解绑关联快捷键，不会删除资源本身或本地文件。
              </p>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-action" onClick={() => setDialog(null)}>取消</button>
              <button type="button" className="danger-action dialog-action" onClick={() => { void confirmDeleteSubTag(dialog.subtagPath); }} disabled={busy}>
                确定删除
              </button>
            </div>
          </div>
        </section>
      );
    }

    return null;
  };

  const renderContextMenu = () => {
    if (!contextMenu) return null;
    const resource = contextMenu.kind === "resource" ? items.find((item) => item.id === contextMenu.resourceId) : null;

    return (
      <section
        ref={contextMenuRef}
        className="context-menu"
        style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        {contextMenu.kind === "edit" && (
          <>
            <button type="button" onClick={() => void runEditContextAction("cut")}>剪切</button>
            <button type="button" onClick={() => void runEditContextAction("copy")}>复制</button>
            <button type="button" onClick={() => void runEditContextAction("paste")}>粘贴</button>
            <span className="context-separator" />
            <button type="button" onClick={() => void runEditContextAction("select-all")}>全选</button>
          </>
        )}

        {contextMenu.kind === "resource" && resource && (
          <>
            <button type="button" onClick={() => void runResourceContextAction("launch", resource)}>启动</button>
            <button type="button" disabled>以管理员身份启动</button>
            <span className="context-separator" />
            <button type="button" onClick={() => void runResourceContextAction("reveal", resource)}>打开所在位置</button>
            <button type="button" onClick={() => void runResourceContextAction("copy", resource)}>复制路径 / URL</button>
            <span className="context-separator" />
            <button type="button" onClick={() => void runResourceContextAction("edit", resource)}>编辑资源</button>
            <button type="button" onClick={() => void runResourceContextAction("favorite", resource)}>
              {resource.favorite ? "取消收藏" : "收藏"}
            </button>
            <button type="button" className="context-danger" onClick={() => void runResourceContextAction("delete", resource)}>删除资源</button>
          </>
        )}

        {contextMenu.kind === "blank" && (
          <>
            <button type="button" onClick={() => void runBlankContextAction("add")}>添加资源</button>
            <button type="button" onClick={() => void runBlankContextAction("scan")}>扫描桌面 / 开始菜单</button>
            <button type="button" onClick={() => void runBlankContextAction("bookmarks")}>导入浏览器书签</button>
            <span className="context-separator" />
            <button type="button" onClick={() => void runBlankContextAction("refresh")}>刷新资源索引</button>
            <button type="button" onClick={() => void runBlankContextAction("settings")}>打开设置</button>
          </>
        )}

        {contextMenu.kind === "group" && contextMenu.groupId && (() => {
          const targetGroup = groups.find((candidate) => candidate.id === contextMenu.groupId);
          if (!targetGroup) return null;
          const hotkey = hotkeysBoundToGroup[targetGroup.id];
          return (
            <>
              <button type="button" onClick={() => { setActiveGroup(targetGroup.id); setContextMenu(null); }}>{"切换到此标签"}</button>
              
              {hotkeyBinderEnabled && (
                <>
                  <span className="context-separator" />
                  <button
                    type="button"
                    onClick={() => {
                      setDialog({ type: "group-hotkey", groupId: targetGroup.id, value: hotkey || "" });
                      setContextMenu(null);
                    }}
                  >
                    {hotkey ? "修改当前快捷键" : "绑定全局快捷键"}
                  </button>
                  {hotkey && (
                    <button
                      type="button"
                      className="context-danger"
                      onClick={async () => {
                        setContextMenu(null);
                        setBusy(true);
                        try {
                          await updateGroupHotkey(targetGroup.id, null);
                          setToast(`分组「${targetGroup.title}」已解除快捷键绑定`);
                          const keys = await getGroupHotkeys();
                          setHotkeysBoundToGroup(keys);
                        } catch (error) {
                          setToast(`解除绑定失败：${String(error)}`);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {"删除全局快捷键"}
                    </button>
                  )}
                </>
              )}

              <span className="context-separator" />
              {targetGroup.custom ? (
                <button
                  type="button"
                  className="context-danger"
                  onClick={() => { void removeGroup(targetGroup.id); setContextMenu(null); }}
                  disabled={busy}
                >
                  {`删除标签“${targetGroup.title}”`}
                </button>
              ) : (
                <button type="button" disabled>{"内置标签不可删除"}</button>
              )}
            </>
          );
        })()}

        {contextMenu.kind === "folder" && contextMenu.folderId && (() => {
          const subtagPath = contextMenu.folderId;
          const hotkey = hotkeysBoundToSubTag[subtagPath];
          return (
            <>
              {hotkeyBinderEnabled && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setDialog({ type: "subtag-hotkey", subtagPath, value: hotkey || "" });
                      setContextMenu(null);
                    }}
                  >
                    {hotkey ? "修改当前快捷键" : "绑定全局快捷键"}
                  </button>
                  {hotkey && (
                    <button
                      type="button"
                      className="context-danger"
                      onClick={async () => {
                        setContextMenu(null);
                        setBusy(true);
                        try {
                          await updateSubTagHotkey(subtagPath, null);
                          setToast(`子目录「${subtagPath}」已解除快捷键绑定`);
                          await fetchSubTagHotkeys();
                        } catch (error) {
                          setToast(`解除绑定失败：${String(error)}`);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {"删除全局快捷键"}
                    </button>
                  )}
                  <span className="context-separator" />
                </>
              )}

              <button
                type="button"
                onClick={() => {
                  setDialog({ type: "subtag-rename", oldPath: subtagPath, value: subtagPath });
                  setContextMenu(null);
                }}
              >
                {"重命名子目录"}
              </button>
              <button
                type="button"
                className="context-danger"
                onClick={() => {
                  setDialog({ type: "subtag-delete-confirm", subtagPath });
                  setContextMenu(null);
                }}
              >
                {"删除子目录"}
              </button>
            </>
          );
        })()}
      </section>
    );
  };

  const renderPluginDetail = () => {
    if (!selectedPlugin) return null;
    const detail = pluginDetail(selectedPlugin);
    return (
      <section className="palette-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setSelectedPlugin(null); }}>
        <div className="modal-panel plugin-detail-panel">
          <div className="modal-head">
            <div>
              <p className="eyebrow">Plugin Detail</p>
              <h2>{selectedPlugin.name}</h2>
            </div>
            <button className="icon-action" onClick={() => setSelectedPlugin(null)}>
              <X size={18} />
            </button>
          </div>
          <div className="plugin-detail-body">
            <div className="detail-kv"><span>作者</span><strong>{detail.author}</strong></div>
            <div className="detail-kv"><span>版本</span><strong className="mono-value">{selectedPlugin.version}</strong></div>
            <div className="detail-kv"><span>状态</span><strong>{selectedPlugin.enabled ? "启用" : "停用"}</strong></div>
            <div>
              <h3>功能</h3>
              <div className="detail-tags">{detail.features.map((feature) => <em key={feature}>{feature}</em>)}</div>
            </div>
            <div>
              <h3>权限</h3>
              <div className="detail-tags">
                {selectedPlugin.permissions.map((permission) => <em key={permission.id} className={`risk-${permission.risk}`}>{permission.label}</em>)}
              </div>
            </div>
            <div className="demo-box">
              <h3>演示</h3>
              <p>{detail.demo}</p>
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderBackupDialog = () => {
    if (!backupOpen) return null;
    return (
      <section className="palette-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setBackupOpen(false); }}>
        <div className="modal-panel backup-panel">
          <div className="modal-head">
            <div>
              <p className="eyebrow">Backup</p>
              <h2>JSON 导入导出</h2>
            </div>
            <button className="icon-action" onClick={() => setBackupOpen(false)}>
              <X size={18} />
            </button>
          </div>
          {backupPath && <p className="backup-path">上次导出：{backupPath}</p>}
          <textarea
            value={backupJson}
            onChange={(event) => setBackupJson(event.target.value)}
            placeholder="点击导出生成 JSON，或在这里粘贴要导入的 OrbitStart JSON。"
          />
          <div className="modal-actions">
            <button className="secondary-action" onClick={runExport} disabled={busy}>
              <Download size={18} />
              导出
            </button>
            <button className="primary-action" onClick={runImport} disabled={busy}>
              <Upload size={18} />
              导入
            </button>
          </div>
        </div>
      </section>
    );
  };

  const renderImportPreviewDialog = () => {
    if (!importPreview) return null;

    const { kind, items, selectedIndices, searchQuery, visibleCount } = importPreview;

    const handleClose = () => {
      setImportPreview(null);
      if (importPreview.onClose) {
        importPreview.onClose();
      }
    };
    
    // 根据搜索框内容过滤出显示的项目列表
    const filteredItemsWithOriginalIndex = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        const q = searchQuery.toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q) ||
          item.target.toLowerCase().includes(q)
        );
      });
    const visibleItemsWithOriginalIndex = filteredItemsWithOriginalIndex.slice(0, visibleCount);
    const filterReasons = buildImportFilterReasons(kind, items);

    // Toggle a single scanned entry while preserving automatic filter hints.
    const handleToggleItem = (index: number) => {
      const nextSelected = new Set(selectedIndices);
      if (nextSelected.has(index)) {
        nextSelected.delete(index);
      } else {
        nextSelected.add(index);
      }
      setImportPreview({ ...importPreview, selectedIndices: nextSelected });
    };

    // 全选当前过滤出的项目
    const handleSelectAllFiltered = () => {
      const nextSelected = new Set(selectedIndices);
      filteredItemsWithOriginalIndex.forEach(({ index }) => {
        nextSelected.add(index);
      });
      setImportPreview({ ...importPreview, selectedIndices: nextSelected });
    };

    // 反选当前过滤出的项目（只针对当前显示的过滤列表进行切换）
    const handleInvertFiltered = () => {
      const nextSelected = new Set(selectedIndices);
      filteredItemsWithOriginalIndex.forEach(({ index }) => {
        if (nextSelected.has(index)) {
          nextSelected.delete(index);
        } else {
          nextSelected.add(index);
        }
      });
      setImportPreview({ ...importPreview, selectedIndices: nextSelected });
    };

    // 执行导入
    const handleConfirmImport = async () => {
      const selectedItems = Array.from(selectedIndices).map((idx) => items[idx]);
      if (selectedItems.length === 0) {
        setToast("未选中任何导入项");
        return;
      }
      setBusy(true);
      setToast("正在批量导入项目，请稍候...");
      try {
        const result = await importScannedItems(selectedItems);
        await reload();
        const skippedCopy = result.skipped > 0 ? `，跳过 ${result.skipped} 个重复项` : "";
        setToast(`成功处理 ${result.imported} 个资源（新增 ${result.inserted}，更新 ${result.updated}）${skippedCopy}`);
        handleClose();
        if (kind === "shortcuts" && result.itemIds.length > 0) {
          void hydrateShortcutIcons(result.itemIds)
            .then(async (updated) => {
              if (updated > 0) {
                await reload();
                setToast(`资源导入完成，已在后台补全 ${updated} 个程序图标`);
              }
            })
            .catch((error) => {
              console.error("Failed to hydrate shortcut icons:", error);
              setToast(`快捷方式图标提取失败：${String(error)}`);
            });
        }
      } catch (error) {
        setToast(`导入失败：${String(error)}`);
      } finally {
        setBusy(false);
      }
    };

    const label = kind === "shortcuts" ? "本地程序" : "浏览器书签";

    return (
      <section className="palette-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) handleClose(); }}>
        <div className="modal-panel import-preview-panel">
          <div className="modal-head">
            <div>
              <p className="eyebrow">Batch Import</p>
              <h2>批量导入过滤：{label}</h2>
            </div>
            <button className="icon-action" onClick={handleClose}>
              <X size={18} />
            </button>
          </div>

          <div className="import-search-bar">
            <Search size={16} />
            <input
              type="text"
              placeholder="搜索扫描出的项目名称或路径..."
              value={searchQuery}
              onChange={(e) => setImportPreview({
                ...importPreview,
                searchQuery: e.target.value,
                visibleCount: IMPORT_PREVIEW_PAGE_SIZE
              })}
            />
          </div>

          <div className="import-toolbar">
            <span>
              已选中 <strong>{selectedIndices.size}</strong> / {items.length} 项
            </span>
            <div className="toolbar-actions">
              <button type="button" className="toolbar-btn" onClick={handleSelectAllFiltered}>
                全选过滤项
              </button>
              <button type="button" className="toolbar-btn" onClick={handleInvertFiltered}>
                反选过滤项
              </button>
              <button type="button" className="toolbar-btn" onClick={() => setImportPreview({ ...importPreview, selectedIndices: new Set() })}>
                清空选择
              </button>
            </div>
          </div>

          <div className="import-preview-list">
            {filteredItemsWithOriginalIndex.length === 0 ? (
              <div className="empty-preview">没有找到匹配的项目</div>
            ) : (
              <>
                {visibleItemsWithOriginalIndex.map(({ item, index }) => {
                  const filterReason = filterReasons.get(index);
                  const isUninstall = filterReason?.code === "uninstall";
                  const isFiltered = Boolean(filterReason);
                  const isChecked = selectedIndices.has(index);
                  return (
                    <div
                      key={index}
                      className={`import-preview-item ${isFiltered ? "is-filtered" : ""} ${isUninstall ? "is-uninstall" : ""} ${isChecked ? "is-checked" : ""}`}
                      onClick={() => handleToggleItem(index)}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                      />
                      <div className="item-icon-wrapper" style={{ color: item.accent }}>
                        <Icon name={item.icon} size={18} />
                      </div>
                      <div className="item-info">
                        <div className="item-title">
                          {item.title}
                          {filterReason && <span className="filter-tag">{filterReason.label}</span>}
                        </div>
                        <div className="item-subtitle" title={item.subtitle}>
                          {item.subtitle}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {visibleItemsWithOriginalIndex.length < filteredItemsWithOriginalIndex.length && (
                  <button
                    type="button"
                    className="import-load-more"
                    onClick={() => setImportPreview({
                      ...importPreview,
                      visibleCount: visibleCount + IMPORT_PREVIEW_PAGE_SIZE
                    })}
                  >
                    继续显示（{visibleItemsWithOriginalIndex.length} / {filteredItemsWithOriginalIndex.length}）
                  </button>
                )}
              </>
            )}
          </div>

          <div className="modal-actions">
            <button className="secondary-action" onClick={handleClose} disabled={busy}>
              取消
            </button>
            <button className="primary-action" onClick={handleConfirmImport} disabled={busy || selectedIndices.size === 0}>
              确认导入 ({selectedIndices.size})
            </button>
          </div>
        </div>
      </section>
    );
  };

  const renderTodoPanelWindow = () => {
    const noteTitle = todoPanelPayload.title || todoPanelTasks[0]?.noteTitle || "Obsidian Todo";
    const vaultName = todoPanelPayload.vaultName || todoPanelTasks[0]?.vaultName || "Obsidian";
    const relativePath = todoPanelPayload.relativePath || todoPanelTasks[0]?.relativePath || "";
    return (
      <>
        <main className={`app-shell todo-window-shell density-${density}`} style={appShellStyle} onContextMenu={handleAppContextMenu}>
          {isLocalGalaxyTheme && (
            <LocalGalaxyBackdrop
              mainOpacity={0.56}
              nebulaOpacity={0.1}
              starOpacity={0.1}
              topGlowOpacity={0.1}
              orbitOpacity={0.04}
              showOrbitLayer={false}
            />
          )}
          <WindowResizeEdges />
          <header className="window-titlebar todo-titlebar" data-tauri-drag-region="deep">
            <div className="window-brand">
              <span className="window-brand-glyph">{renderBrandIcon(12)}</span>
              <span>Todo</span>
            </div>
            <div className="window-drag-fill" />
            <div className="window-controls" data-tauri-drag-region="false">
              <button type="button" className={`pin-window ${todoPanelPinned ? "is-pinned" : ""}`} aria-label="Pin always on top" title={todoPanelPinned ? "Unpin" : "Pin always on top"} onClick={() => void toggleTodoPanelPin()}>
                {todoPanelPinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
              <button type="button" aria-label="Minimize" title="Minimize" onClick={minimizeWindow}>-</button>
              <button type="button" aria-label="Maximize or restore" title="Maximize or restore" onClick={toggleMaximizeWindow}>□</button>
              <button type="button" aria-label="Close" title="Close" className="close-window" onClick={closeWindow}>×</button>
            </div>
          </header>

          <section className="todo-panel-body">
            <header className="todo-note-head">
              <p className="eyebrow">{vaultName}</p>
              <h1>{noteTitle}</h1>
              <span>{relativePath || "当前笔记"}</span>
            </header>

            <section className="todo-panel-summary">
              <strong>{todoPanelTasks.filter((task) => !task.completed).length}</strong>
              <span>未完成</span>
              <strong>{todoPanelTasks.length}</strong>
              <span>checkbox</span>
            </section>

            <div className="todo-task-list">
              {todoPanelLoading && (
                <div className="empty-state todo-empty-state">
                  <RefreshCcw size={24} className="spin-icon" />
                  <strong>正在读取待办</strong>
                </div>
              )}
              {!todoPanelLoading && todoPanelTasks.map((task) => (
                <div key={task.id} className={`todo-task-row ${task.completed ? "is-completed" : ""}`}>
                  <span className="todo-task-check">
                    <input
                      type="checkbox"
                      checked={task.completed}
                      onChange={(event) => void handleTodoToggle(event as unknown as React.MouseEvent, task)}
                    />
                  </span>
                  <span className="todo-task-copy" onClick={() => void openObsidianTask(task)} style={{ cursor: "pointer" }}>
                    <strong>{task.text || "未命名待办"}</strong>
                    <small>第 {task.lineNumber} 行{task.tags.length ? ` · ${task.tags.join(" ")}` : ""}</small>
                  </span>
                  <ExternalLink size={15} onClick={() => void openObsidianTask(task)} style={{ cursor: "pointer", flexShrink: 0 }} />
                </div>
              ))}
              {!todoPanelLoading && todoPanelTasks.length === 0 && (
                <div className="empty-state todo-empty-state">
                  <CheckCircle2 size={28} />
                  <strong>这篇笔记没有 checkbox</strong>
                  <span>重新扫描 vault 后会读取 Markdown 里的 - [ ]、-[ ] 和 - [x]。</span>
                </div>
              )}
            </div>
          </section>
        </main>
        {contextMenu && renderContextMenu()}
      </>
    );
  };

  if (isTodoPanelWindow) {
    return renderTodoPanelWindow();
  }

  if (isAuxWindow) {
    const auxTitle = auxPanel === "plugins" ? "插件管理" : auxPanel === "themes" ? "主题工作室" : auxPanel === "about" ? "关于 OrbitStart" : "设置";
    return (
      <>
        <main className={`app-shell aux-shell density-${density}`} style={appShellStyle} onContextMenu={handleAppContextMenu}>
          {isLocalGalaxyTheme && (
            <LocalGalaxyBackdrop
              mainOpacity={0.58}
              nebulaOpacity={0.1}
              starOpacity={0.08}
              topGlowOpacity={0.1}
              orbitOpacity={0.05}
              showOrbitLayer={false}
            />
          )}
          <WindowResizeEdges />
          <header className="window-titlebar" data-tauri-drag-region="deep">
            <div className="window-brand">
              <span className="window-brand-glyph">{renderBrandIcon(12)}</span>
              <span>{auxTitle}</span>
            </div>
            <div className="window-drag-fill" />
            <div className="window-controls" data-tauri-drag-region="false">
              <button type="button" aria-label="Minimize" title="Minimize" onClick={minimizeWindow}>-</button>
              <button type="button" aria-label="Maximize or restore" title="Maximize or restore" onClick={toggleMaximizeWindow}>□</button>
              <button type="button" aria-label="Close" title="Close" className="close-window" onClick={closeWindow}>×</button>
            </div>
          </header>
          <section className="aux-workspace">
            {auxPanel === "about" ? renderAbout() : renderSettings()}
          </section>
          {dialog && renderAppDialog()}
          {selectedPlugin && renderPluginDetail()}
          {backupOpen && renderBackupDialog()}
          {importPreview && renderImportPreviewDialog()}
        </main>
        {contextMenu && renderContextMenu()}
      </>
    );
  }

  return (
    <>
      {showOnboarding && (
        <Suspense fallback={null}>
          <OnboardingWizard
          visible={!importPreview}
          onTemplateSelected={async (tags, groups) => {
            // Resolve current Windows username to replace [user] placeholders in template paths
            const userName = (typeof window !== "undefined" && (window as any).__ORBIT_USER_NAME__) || "";
            const resolvePath = (raw: string) =>
              userName ? raw.replace(/\[user\]/g, userName) : raw;

            // 1. Ensure custom groups needed by the templates actually exist
            setBusy(true);
            try {
              for (const g of groups) {
                try {
                  await createCustomGroup(g.id, g.title, g.icon, g.description);
                } catch (e) {
                  console.warn("Failed to create onboarding custom group:", g.title, e);
                }
              }
            } catch (e) {
              // ignore
            }

            // 2. Persist each tag to the SQLite database via createItem
            let created = 0;
            try {
              for (const t of tags) {
                try {
                  await createItem({
                    title: t.title,
                    subtitle: t.kind === "app" ? "本地程序" : t.kind === "website" ? "网址" : t.kind === "folder" ? "文件夹" : t.kind === "script" ? "脚本" : "动作链",
                    kind: t.kind,
                    group: t.group,
                    target: resolvePath(t.target),
                    aliases: [],
                    tags: [t.kind === "action_chain" ? "automation" : "template"],
                    icon: t.icon,
                    accent: t.accent,
                    favorite: t.favorite ?? false
                  });
                  created++;
                } catch (e) {
                  console.warn("Failed to create onboarding item:", t.title, e);
                }
              }
              // 3. Reload from database so React state reflects what's actually persisted
              await reload();
              setToast(`已创建 ${created} 个示例资源`);
            } catch (error) {
              setToast(`创建示例资源失败：${String(error)}`);
            } finally {
              setBusy(false);
            }
          }}
          onScanShortcuts={async () => {
            setBusy(true);
            setToast("正在扫描桌面和开始菜单...");
            try {
              await new Promise<void>((resolve, reject) => {
                runNativeItemScan("shortcuts", resolve).catch(reject);
              });
            } catch (e) {
              setToast(`扫描失败：${String(e)}`);
            } finally {
              setBusy(false);
            }
          }}
          onScanBookmarks={async () => {
            setBusy(true);
            setToast("正在扫描浏览器书签...");
            try {
              await new Promise<void>((resolve, reject) => {
                runNativeItemScan("bookmarks", resolve).catch(reject);
              });
            } catch (e) {
              setToast(`扫描失败：${String(e)}`);
            } finally {
              setBusy(false);
            }
          }}
          onComplete={() => {
            setShowOnboarding(false);
            setToast("欢迎使用 OrbitStart！按 Ctrl+K 随时唤起命令面板");
          }}
          />
        </Suspense>
      )}
      <main className={`app-shell density-${density} view-${activeView}`} style={appShellStyle} onContextMenu={handleAppContextMenu}>
      {isLocalGalaxyTheme && (
        <LocalGalaxyBackdrop
          mainOpacity={0.76}
          nebulaOpacity={activeView === "logs" ? 0.12 : 0.16}
          starOpacity={activeView === "settings" ? 0.18 : 0.12}
          topGlowOpacity={activeView === "dashboard" ? 0.16 : 0.12}
          orbitOpacity={activeView === "settings" ? 0.1 : 0.08}
          showOrbitLayer={activeView !== "logs"}
        />
      )}
      <WindowResizeEdges />
      <header className="window-titlebar" data-tauri-drag-region="deep">
        <div className="window-brand">
          <span className="window-brand-glyph">{renderBrandIcon(12)}</span>
          <span>OrbitStart</span>
        </div>
        <div className="window-drag-fill" />
        <div className="window-controls" data-tauri-drag-region="false">
          <button type="button" aria-label="Minimize" title="Minimize" onClick={minimizeWindow}>-</button>
          <button type="button" aria-label="Maximize or restore" title="Maximize or restore" onClick={toggleMaximizeWindow}>□</button>
          <button type="button" aria-label="Close" title="Close" className="close-window" onClick={closeWindow}>×</button>
        </div>
      </header>
      <aside className="sidebar">
        <div className="brand-mark">
          <div className="brand-orbit">
            {renderBrandIcon(24)}
          </div>
          <div>
            <strong>OrbitStart</strong>
            <span>Desktop</span>
          </div>
        </div>

        <nav className="rail" aria-label="主导航">
          {navItems.map((item) => (
            <button type="button" key={item.id} className={`rail-button ${activeView === item.id ? "active" : ""}`} title={item.title} onClick={() => setActiveView(item.id)}>
              {item.icon}
            </button>
          ))}
          <button type="button" className="rail-button" title="命令面板" onClick={() => setPaletteOpen(true)}>
            <Command size={21} />
          </button>
        </nav>

        <button
          type="button"
          className={`sidebar-cosmic-settings-btn ${localAuxPanel ? "active" : ""}`}
          title="系统设置"
          onClick={() => void openPanelWindow("settings")}
          style={{ marginTop: "auto" }}
        >
          <Settings size={22} className="settings-gear" />
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{themeLabel} · {settings?.globalHotkey ?? "Ctrl+Alt+Space"}</p>
            <h1>{activeViewMeta[activeView].title}</h1>
            <span className="title-subtitle">{activeViewMeta[activeView].subtitle}</span>
          </div>
          {activeView === "dashboard" && (
            <div className="top-actions">
              <div className="density-slider-container" title={`界面密度: ${densityValue}%`}>
                <SlidersHorizontal size={15} className="density-slider-icon" />
                <input
                  type="range"
                  className="density-slider"
                  min="0"
                  max="100"
                  value={densityValue}
                  onChange={handleDensityChange}
                />
              </div>
              <button type="button" className="icon-action" title="主题工作室" onClick={() => void openPanelWindow("themes")}>
                <Palette size={19} />
              </button>
              <button type="button" className="icon-action" title="扫描本地程序" onClick={() => runNativeItemScan("shortcuts")} disabled={busy || !pluginEnabled("core-shortcuts")}>
                <ScanSearch size={19} />
              </button>
              <button type="button" className="icon-action" title="数据备份" onClick={() => setBackupOpen(true)}>
                <Database size={19} />
              </button>
              <button type="button" className="icon-action" title="命令面板" onClick={() => setPaletteOpen(true)}>
                <Search size={19} />
              </button>
            </div>
          )}
        </header>

        {(activeView === "dashboard" || (activeView === "trips" && tripsFeatureEnabled) || (activeView === "obsidian" && obsidianFeatureEnabled)) && (
          <section className="hero-strip">
            <div className="search-shell">
              <Search size={19} />
              <input
                ref={searchInputRef}
                value={
                  activeView === "dashboard"
                    ? query
                    : activeView === "trips"
                    ? tripsQuery
                    : obsidianQuery
                }
                onChange={(event) => {
                  const val = event.target.value;
                  if (activeView === "dashboard") {
                    setQuery(val);
                  } else if (activeView === "trips") {
                    setTripsQuery(val);
                  } else {
                    setObsidianQuery(val);
                  }
                }}
                placeholder={
                  activeView === "dashboard"
                    ? "搜索应用、文件、网址、脚本、插件或标签..."
                    : activeView === "trips"
                    ? "搜索 Tip 标题、内容、状态或标签..."
                    : "搜索笔记标题、路径、Vault 或标签..."
                }
              />
              <kbd>Ctrl K</kbd>
            </div>
            {activeView === "dashboard" && (
              <button type="button" className="primary-action" onClick={() => setEditor({ mode: "create", input: makeEmptyInput() })} disabled={busy}>
                <PlusCircle size={18} />
                添加资源
              </button>
            )}
          </section>
        )}

        {activeView === "dashboard" && renderDashboard()}
        {activeView === "trips" && tripsFeatureEnabled && renderTripsPage()}
        {activeView === "obsidian" && obsidianFeatureEnabled && renderObsidianPage()}
        {activeView === "workspaces" && workspacesFeatureEnabled && (
          <Suspense fallback={null}>
            <Workspaces pluginHost={pluginHost} items={items} />
          </Suspense>
        )}
        {activeView === "settings" && renderSettings()}
        {activeView === "logs" && renderLogs()}
      </section>

      {dragActive && (
        <section className="drop-overlay" aria-live="polite">
          <div>
            <Download size={28} />
            <strong>释放以添加资源</strong>
            <span>
              {externalDropGroupId
                ? `将加入「${groups.find((group) => group.id === externalDropGroupId)?.title ?? externalDropGroupId}」标签`
                : "支持桌面快捷方式、文件、文件夹和脚本"}
            </span>
          </div>
        </section>
      )}



      {dialog && renderAppDialog()}

      {tripsFeatureEnabled && tripPanelItem && (
        <Suspense fallback={null}>
          <TripPanel
          item={tripPanelItem}
          highlightTripId={tripPanelHighlightId}
          onClose={() => {
            setTripPanelItem(null);
            setTripPanelHighlightId(null);
          }}
          onChanged={handleTripsChanged}
          />
        </Suspense>
      )}

      {paletteOpen && (
        <section
          className="palette-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setPaletteOpen(false); }}
        >
          <div className="command-palette">
            <div className="palette-input">
              <Search size={20} />
              <input
                ref={paletteInputRef}
                value={paletteQuery}
                onChange={(event) => setPaletteQuery(event.target.value)}
                onKeyDown={handlePaletteKeyDown}
                placeholder="搜索应用、文件、网址、脚本、插件或拼音首字母..."
                autoFocus
              />
              {paletteQuery ? (
                <button type="button" title="清空" onClick={() => setPaletteQuery("")} className="palette-clear-btn">
                  <X size={16} />
                </button>
              ) : (
                <button type="button" title="关闭" onClick={() => setPaletteOpen(false)}>
                  <X size={18} />
                </button>
              )}
            </div>
            <div className="palette-results">
              {paletteCommands.length === 0 && (
                <div className="palette-empty">
                  <Search size={24} />
                  <span>未找到匹配结果</span>
                  <small>试试拼音首字母或更短的关键词</small>
                </div>
              )}
              {paletteCommands.map((result, idx) => (
                <button
                  type="button"
                  key={result.id}
                  data-resource-id={result.resourceId}
                  className={idx === paletteSelectedIndex ? "result-selected" : ""}
                  onClick={async () => {
                    await result.run();
                    setPaletteOpen(false);
                  }}
                  onMouseEnter={() => setPaletteSelectedIndex(idx)}
                >
                  <span className="result-icon">
                    <Icon name={result.icon} size={22} />
                  </span>
                  <span>
                    <strong>{result.title}</strong>
                    <small>{result.subtitle}</small>
                  </span>
                  <em>{result.actionLabel}</em>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {commandBarOpen && createPortal(
        <section
          className="palette-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setCommandBarOpen(false); }}
        >
          <div className="command-palette command-bar-panel">
            <div className="palette-input">
              <Search size={20} />
              <input
                ref={commandBarInputRef}
                value={commandBarQuery}
                onChange={(event) => setCommandBarQuery(event.target.value)}
                onKeyDown={handleCommandBarKeyDown}
                placeholder="搜索已添加的应用、网站、分组或页面..."
                autoFocus
              />
              {commandBarQuery ? (
                <button type="button" title="清空" onClick={() => setCommandBarQuery("")} className="palette-clear-btn">
                  <X size={16} />
                </button>
              ) : (
                <button type="button" title="关闭" onClick={() => setCommandBarOpen(false)}>
                  <X size={18} />
                </button>
              )}
            </div>
            <div className="palette-results">
              {commandBarResults.length === 0 && (
                <div className="palette-empty">
                  <Search size={24} />
                  <span>没有找到已整理的入口</span>
                </div>
              )}
              {commandBarResults.map((result, idx) => (
                <button
                  type="button"
                  key={result.id}
                  data-resource-id={result.resourceId}
                  className={idx === commandBarSelectedIndex ? "result-selected" : ""}
                  onClick={async () => {
                    await result.run();
                    setCommandBarOpen(false);
                  }}
                  onMouseEnter={() => setCommandBarSelectedIndex(idx)}
                >
                  <span className="result-icon">
                    <Icon name={result.icon} size={22} />
                  </span>
                  <span>
                    <strong>{result.title}</strong>
                    <small>{result.subtitle}</small>
                  </span>
                  <div className="result-meta-tags">
                    {result.groupLabel && <em className="meta-group-tag">{result.groupLabel}</em>}
                    <em className="meta-type-tag">{result.typeLabel}</em>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>,
        document.body
      )}

      {editor && (
        <section className="palette-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel editor-panel">
            <div className="modal-head">
              <div>
                <p className="eyebrow">{editor.mode === "create" ? "New resource" : "Edit resource"}</p>
                <h2>{editor.mode === "create" ? "添加资源" : "编辑资源"}</h2>
              </div>
              <button className="icon-action" onClick={() => setEditor(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="form-grid">
              <label>
                类型
                <select
                  value={editor.input.kind}
                  onChange={(event) => setEditor({ ...editor, input: inputWithKind(editor.input, event.target.value as ItemKind) })}
                >
                  {visibleKindOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                标题
                <input
                  value={editor.input.title}
                  onChange={(event) => setEditor({ ...editor, input: { ...editor.input, title: event.target.value } })}
                  placeholder="例如 VS Code"
                />
              </label>
              <label className="wide-field">
                {editor.input.kind === "action_chain" ? "动作链目标" : "目标路径或网址"}
                {editor.input.kind === "action_chain" ? (
                  <textarea
                    value={editor.input.target}
                    onChange={(event) => setEditor({ ...editor, input: { ...editor.input, target: event.target.value } })}
                    placeholder={"每行一个目标，例如：\nC:\\Windows\\System32\\notepad.exe\nhttps://github.com\nE:\\OrbitStart"}
                  />
                ) : (
                  <>
                    <input
                      value={editor.input.target}
                      onChange={(event) => setEditor({ ...editor, input: { ...editor.input, target: event.target.value } })}
                      placeholder="C:\\Program Files\\... 或 https://..."
                    />
                    <div className="field-actions">
                      <button type="button" className="secondary-action" onClick={() => void chooseResourceTarget("file")} disabled={busy}>
                        <FolderOpen size={16} />
                        选择文件/应用/脚本
                      </button>
                      <button type="button" className="secondary-action" onClick={() => void chooseResourceTarget("folder")} disabled={busy}>
                        <FolderKanban size={16} />
                        选择文件夹
                      </button>
                    </div>
                  </>
                )}
              </label>
              {editor.input.kind !== "action_chain" && (
                <label className="wide-field">
                  启动参数 (可选)
                  <input
                    value={editor.input.arguments || ""}
                    onChange={(event) => setEditor({ ...editor, input: { ...editor.input, arguments: event.target.value } })}
                    placeholder="例如：--portable --no-sandbox"
                  />
                </label>
              )}
              <label className="wide-field">
                副标题
                <input
                  value={editor.input.subtitle}
                  onChange={(event) => setEditor({ ...editor, input: { ...editor.input, subtitle: event.target.value } })}
                  placeholder="显示在标题下方"
                />
              </label>
              <label className="wide-field">
                所属分组 / 标签 (支持多选)
                <div className="group-checkbox-grid">
                  {visibleGroups.filter((group) => group.id !== "all").map((group) => {
                    const selectedGroups = splitGroupIds(editor.input.group);
                    const isChecked = selectedGroups.includes(group.id);
                    return (
                      <button
                        key={group.id}
                        type="button"
                        className={`group-tag-checkbox ${isChecked ? "checked" : ""}`}
                        onClick={() => {
                          const next = isChecked
                            ? selectedGroups.filter((g) => g !== group.id)
                            : [...selectedGroups, group.id];
                          setEditor({
                            ...editor,
                            input: { ...editor.input, group: joinGroupIds(next) }
                          });
                        }}
                      >
                        <Icon name={group.icon} size={14} />
                        <span>{group.title}</span>
                      </button>
                    );
                  })}
                </div>
              </label>
              <label className="wide-field">
                子目录（可选）
                <div className="subtag-select-wrapper" style={{ display: "flex", gap: "8px" }}>
                  <input
                    value={editor.input.subTag ? `${editor.input.subTag}` : "无（处于主目录）"}
                    readOnly
                    placeholder="未选择子目录"
                    style={{ cursor: "pointer", flex: 1, caretColor: "transparent" }}
                    onClick={() => {
                      setSubTagSelectModal({
                        isOpen: true,
                        currentValue: editor.input.subTag ?? "",
                        onSelect: (val) => {
                          setEditor({
                            ...editor,
                            input: { ...editor.input, subTag: val }
                          });
                        }
                      });
                    }}
                  />
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => {
                      setSubTagSelectModal({
                        isOpen: true,
                        currentValue: editor.input.subTag ?? "",
                        onSelect: (val) => {
                          setEditor({
                            ...editor,
                            input: { ...editor.input, subTag: val }
                          });
                        }
                      });
                    }}
                  >
                    选择子目录
                  </button>
                  {(editor.input.subTag ?? "") !== "" && (
                    <button
                      type="button"
                      className="secondary-action danger-action"
                      style={{ padding: "0 12px" }}
                      onClick={() => {
                        setEditor({
                          ...editor,
                          input: { ...editor.input, subTag: "" }
                        });
                      }}
                    >
                      移回主目录
                    </button>
                  )}
                </div>
              </label>
              <label>
                颜色
                <input
                  type="color"
                  value={editor.input.accent}
                  onChange={(event) => setEditor({ ...editor, input: { ...editor.input, accent: event.target.value } })}
                />
              </label>
              <label className="wide-field">
                自定义图标
                <div className="icon-picker-row">
                  <span
                    className="resource-icon"
                    style={{
                      "--accent": editor.input.accent,
                      "--asset-icon-base": isLocalGalaxyTheme ? `url("${iconBaseFor(editor.input as OrbitItem)}")` : "none"
                    } as CSSProperties}
                  >
                    <Icon name={editor.input.icon} size={26} />
                  </span>
                  <button type="button" className="secondary-action" onClick={() => void chooseCustomIcon()} disabled={busy}>
                    <Image size={16} />
                    选择图片
                  </button>
                  <button type="button" className="secondary-action" onClick={resetEditorIcon} disabled={busy}>
                    恢复默认
                  </button>
                </div>
              </label>
              <label className="wide-field">
                别名
                <input
                  value={listToText(editor.input.aliases)}
                  onChange={(event) => setEditor({ ...editor, input: { ...editor.input, aliases: normalizeList(event.target.value) } })}
                  placeholder="用逗号分隔，例如 code, ide, 编辑器"
                />
              </label>
              <label className="wide-field">
                标签
                <input
                  value={listToText(editor.input.tags)}
                  onChange={(event) => setEditor({ ...editor, input: { ...editor.input, tags: normalizeList(event.target.value) } })}
                  placeholder="用逗号分隔，例如 dev, daily"
                />
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={editor.input.favorite}
                  onChange={(event) => setEditor({ ...editor, input: { ...editor.input, favorite: event.target.checked } })}
                />
                加入收藏
              </label>
            </div>

            <div className="modal-actions">
              <button className="secondary-action" onClick={() => setEditor(null)}>
                取消
              </button>
              <button className="primary-action" onClick={saveEditor} disabled={busy}>
                <Save size={18} />
                保存
              </button>
            </div>
          </div>
        </section>
      )}

      {selectedPlugin && (
        <section className="palette-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setSelectedPlugin(null); }}>
          <div className="modal-panel plugin-detail-panel">
            <div className="modal-head">
              <div>
                <p className="eyebrow">Plugin Detail</p>
                <h2>{selectedPlugin.name}</h2>
              </div>
              <button className="icon-action" onClick={() => setSelectedPlugin(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="plugin-detail-body">
              {(() => {
                const detail = pluginDetail(selectedPlugin);
                return (
                  <>
                    <div className="detail-kv">
                      <span>作者</span>
                      <strong>{detail.author}</strong>
                    </div>
                    <div className="detail-kv">
                      <span>版本</span>
                      <strong className="mono-value">{selectedPlugin.version}</strong>
                    </div>
                    <div className="detail-kv">
                      <span>状态</span>
                      <strong>{selectedPlugin.enabled ? "启用" : "停用"}</strong>
                    </div>
                    <div>
                      <h3>功能</h3>
                      <div className="detail-tags">
                        {detail.features.map((feature) => (
                          <em key={feature}>{feature}</em>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3>权限</h3>
                      <div className="detail-tags">
                        {selectedPlugin.permissions.map((permission) => (
                          <em key={permission.id} className={`risk-${permission.risk}`}>{permission.label}</em>
                        ))}
                      </div>
                    </div>
                    <div className="demo-box">
                      <h3>演示</h3>
                      <p>{detail.demo}</p>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </section>
      )}

      {backupOpen && (
        <section className="palette-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setBackupOpen(false); }}>
          <div className="modal-panel backup-panel">
            <div className="modal-head">
              <div>
                <p className="eyebrow">Backup</p>
                <h2>JSON 导入导出</h2>
              </div>
              <button className="icon-action" onClick={() => setBackupOpen(false)}>
                <X size={18} />
              </button>
            </div>
            {backupPath && <p className="backup-path">上次导出：{backupPath}</p>}
            <textarea
              value={backupJson}
              onChange={(event) => setBackupJson(event.target.value)}
              placeholder="点击导出生成 JSON，或在这里粘贴要导入的 OrbitStart JSON。"
            />
            <div className="modal-actions">
              <button className="secondary-action" onClick={runExport} disabled={busy}>
                <Download size={18} />
                导出
              </button>
              <button className="primary-action" onClick={runImport} disabled={busy}>
                <Upload size={18} />
                导入
              </button>
            </div>
          </div>
        </section>
      )}

      {localAuxPanel && (
        <section className="palette-backdrop centered-backdrop aux-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setLocalAuxPanel(null); }}>
          <div className="modal-panel settings-modal-panel">
            <div className="modal-head">
              <div>
                <p className="eyebrow">{localAuxPanel === "plugins" ? "Plugins" : localAuxPanel === "themes" ? "Themes" : localAuxPanel === "about" ? "About" : "Settings"}</p>
                <h2>{localAuxPanel === "plugins" ? "插件管理" : localAuxPanel === "themes" ? "主题工作室" : localAuxPanel === "about" ? "关于 OrbitStart" : "系统设置"}</h2>
              </div>
              <button type="button" className="icon-action" onClick={() => setLocalAuxPanel(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="aux-workspace" style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              {localAuxPanel === "about" ? renderAbout() : renderSettings()}
            </div>
          </div>
        </section>
      )}
      {importPreview && renderImportPreviewDialog()}
      </main>
      {activeLaunch && (
        <div className="workspace-launch-progress-overlay">
          <div className="workspace-launch-progress-panel">
            <div className="launch-panel-header">
              <Workflow size={20} className="spin-slow" />
              <div>
                <h3>正在启动工作区</h3>
                <p>{activeLaunch.workspaceName}</p>
              </div>
            </div>
            
            <div className="launch-progress-bar-wrapper">
              <div 
                className="launch-progress-bar-fill" 
                style={{ 
                  width: `${(activeLaunch.currentStepIndex / activeLaunch.totalSteps) * 100}%` 
                }}
              />
            </div>
            
            <div className="launch-panel-footer">
              <span>步骤 {activeLaunch.currentStepIndex + 1} / {activeLaunch.totalSteps}</span>
              <strong>{activeLaunch.currentStepTitle}</strong>
            </div>
          </div>
        </div>
      )}
      {subTagSelectModal?.isOpen && createPortal(
        <section
          className="dialog-backdrop"
          role="dialog"
          aria-modal="true"
          style={{ zIndex: 11000 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSubTagSelectModal(null);
              setSubTagSelectSearch("");
            }
          }}
        >
          <div className="dialog-panel" style={{ maxWidth: "420px", width: "100%" }}>
            <div className="dialog-head">
              <h3>选择子目录</h3>
              <button
                type="button"
                className="close-button"
                onClick={() => {
                  setSubTagSelectModal(null);
                  setSubTagSelectSearch("");
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: "12px", maxHeight: "400px", overflowY: "auto" }}>
              <div className="search-shell" style={{ margin: 0, width: "100%", boxSizing: "border-box" }}>
                <Search size={16} />
                <input
                  value={subTagSelectSearch}
                  onChange={(e) => setSubTagSelectSearch(e.target.value)}
                  placeholder="搜索已创建的子目录..."
                  style={{ fontSize: "14px", width: "100%" }}
                  autoFocus
                />
                {subTagSelectSearch && (
                  <button type="button" title="清空" onClick={() => setSubTagSelectSearch("")} className="palette-clear-btn" style={{ right: "8px" }}>
                    <X size={14} />
                  </button>
                )}
              </div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
                {/* None Option */}
                {(!subTagSelectSearch || "无（处于主目录）".includes(subTagSelectSearch.toLowerCase())) && (
                  <button
                    type="button"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      background: "rgba(255, 255, 255, 0.03)",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: "6px",
                      cursor: "pointer",
                      textAlign: "left",
                      color: "var(--foreground-muted)",
                      fontWeight: subTagSelectModal.currentValue === "" ? "bold" : "normal"
                    }}
                    onClick={() => {
                      subTagSelectModal.onSelect("");
                      setSubTagSelectModal(null);
                      setSubTagSelectSearch("");
                    }}
                  >
                    <span>无（移回主目录/根目录）</span>
                    {subTagSelectModal.currentValue === "" && <span style={{ color: "var(--accent)" }}>✓</span>}
                  </button>
                )}

                {existingSubTags
                  .filter((tag) => tag.toLowerCase().includes(subTagSelectSearch.toLowerCase()))
                  .map((tag) => {
                    const isSelected = subTagSelectModal.currentValue === tag;
                    return (
                      <button
                        type="button"
                        key={tag}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 14px",
                          background: isSelected ? "rgba(255, 255, 255, 0.1)" : "rgba(255, 255, 255, 0.03)",
                          border: isSelected ? "1px solid var(--accent)" : "1px solid rgba(255, 255, 255, 0.08)",
                          borderRadius: "6px",
                          cursor: "pointer",
                          textAlign: "left",
                          color: "var(--foreground)",
                          fontWeight: isSelected ? "bold" : "normal"
                        }}
                        onClick={() => {
                          subTagSelectModal.onSelect(tag);
                          setSubTagSelectModal(null);
                          setSubTagSelectSearch("");
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ opacity: 0.6 }}>📂</span>
                          <span>{tag}</span>
                        </div>
                        {isSelected && <span style={{ color: "var(--accent)" }}>✓</span>}
                      </button>
                    );
                  })}

                {existingSubTags.filter((tag) => tag.toLowerCase().includes(subTagSelectSearch.toLowerCase())).length === 0 &&
                  (subTagSelectSearch ? (
                    <div style={{ textAlign: "center", padding: "20px", color: "var(--foreground-muted)", fontSize: "14px" }}>
                      没有找到匹配的子目录
                    </div>
                  ) : existingSubTags.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "20px", color: "var(--foreground-muted)", fontSize: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                      <span>当前没有已创建的子目录</span>
                      <small style={{ fontSize: "12px", opacity: 0.8 }}>请先在主页以‘添加子目录’创建子目录。</small>
                    </div>
                  ) : null)}
              </div>
            </div>
          </div>
        </section>,
        document.body
      )}
      {contextMenu && renderContextMenu()}
    </>
  );
}
