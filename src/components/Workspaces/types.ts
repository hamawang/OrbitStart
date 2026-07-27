import type { OrbitItem } from "../../types";

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastLaunchedAt?: string;
  launchCount: number;
  hotkey?: string;
  preventDuplicate?: boolean;
}

export interface WorkspaceStep {
  id: string;
  workspaceId: string;
  order: number;
  type: "item" | "app" | "website" | "folder" | "file" | "script" | "wait";
  itemId?: string;
  title: string;
  target: string;
  color?: string;
  arguments?: string;
  workingDirectory?: string;
  failurePolicy?: "continue" | "stop";
  enabled: boolean;
  delayMs?: number;
  waitCondition?: {
    type: "time" | "process" | "process_start" | "process_stop" | "port" | "path" | "url";
    value: string;
    timeoutMs?: number;
  };
  scriptConfig?: {
    type: "bat" | "ps1";
    content: string;
    useFile?: boolean;
    filePath?: string;
  };
  dependsOn?: string[];
  windowLayout?: WorkspaceWindowLayout;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceWindowLayout {
  processName: string;
  windowTitle?: string;
  executablePath?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized?: boolean;
  capturedAt: string;
  alwaysOnTop?: boolean;
}

export interface WorkspacePluginHost {
  commands?: {
    run?: (commandId: string) => Promise<unknown>;
  };
}

export interface WorkspacesProps {
  pluginHost?: WorkspacePluginHost | null;
  items: OrbitItem[];
}

export interface WorkspaceLaunchLog {
  id: string | number;
  workspaceName: string;
  status: "success" | "partial" | "failed" | string;
  launchedAt: string;
  durationMs: number;
  totalSteps: number;
  successSteps: number;
  failedSteps: number;
  errors?: Array<{
    stepTitle: string;
    errorMsg: string;
  }>;
}

export interface ThemedAlert {
  title: string;
  message: string;
  type: "success" | "error" | "info";
}

export interface WorkspaceContextMenu {
  x: number;
  y: number;
  workspace: Workspace;
}

export interface NodeContextMenu {
  x: number;
  y: number;
  nodeId: string;
}

export const STORAGE_KEY_WORKSPACES = "orbitstart.plugin.workspaces.storage.workspaces";
export const STORAGE_KEY_STEPS = "orbitstart.plugin.workspaces.storage.steps";
export const STORAGE_KEY_LOGS = "orbitstart.plugin.workspaces.storage.logs";

export const COLOR_PRESETS = [
  "#E0533C",
  "#5cc8ff",
  "#8bd450",
  "#f6b95b",
  "#bf5cff",
  "#ff7a90",
  "#37d6bf",
  "#a0aec0"
];

export const ICON_PRESETS = [
  "Briefcase",
  "AppWindow",
  "Globe",
  "FolderOpen",
  "FileText",
  "Settings"
];
