import React, { useState, useEffect, useRef } from "react";
import {
  AlertCircle,
  AppWindow,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit3,
  FileText,
  FolderOpen,
  HelpCircle,
  Plus,
  Save,
  Trash2,
  Workflow,
  X
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { WorkspaceContextMenus } from "./WorkspaceContextMenus";
import { WorkspaceListView } from "./WorkspaceListView";
import {
  DeleteWorkspaceDialog,
  LaunchLogsDialog,
  ResourceSelectorModal,
  ThemedAlertDialog,
  WindowLayoutImportDialog
} from "./WorkspaceModals";
import {
  COLOR_PRESETS,
  ICON_PRESETS,
  STORAGE_KEY_LOGS,
  STORAGE_KEY_STEPS,
  STORAGE_KEY_WORKSPACES,
  type NodeContextMenu,
  type ThemedAlert,
  type Workspace,
  type WorkspaceContextMenu,
  type WorkspaceLaunchLog,
  type WorkspaceStep,
  type WorkspaceWindowLayout,
  type WorkspacesProps
} from "./types";
import { getWorkspaceGraphLayout } from "./workspaceGraph";
import { getStepIcon, getWorkspaceIcon } from "./workspaceIcons";

function sanitizeCommandId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
}

export function Workspaces({ pluginHost, items }: WorkspacesProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [steps, setSteps] = useState<WorkspaceStep[]>([]);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [editingSteps, setEditingSteps] = useState<WorkspaceStep[]>([]);
  const [isNew, setIsNew] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [selectorStepId, setSelectorStepId] = useState<string | null>(null);
  const [selectorSearch, setSelectorSearch] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [launchLogs, setLaunchLogs] = useState<WorkspaceLaunchLog[]>([]);
  const [themedAlert, setThemedAlert] = useState<ThemedAlert | null>(null);
  const [scanLayoutModalOpen, setScanLayoutModalOpen] = useState(false);
  const [scannedWindows, setScannedWindows] = useState<WorkspaceWindowLayout[]>([]);
  const [selectedWindowIndices, setSelectedWindowIndices] = useState<number[]>([]);
  const [windowBindings, setWindowBindings] = useState<{ [index: number]: string }>({});
  const [isRecordingHotkey, setIsRecordingHotkey] = useState(false);
  const [workspaceContextMenu, setWorkspaceContextMenu] = useState<WorkspaceContextMenu | null>(null);
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenu | null>(null);
  const [copiedStep, setCopiedStep] = useState<Partial<WorkspaceStep> | null>(null);
  const graphViewportRef = useRef<HTMLDivElement | null>(null);
  const hotkeyInputRef = useRef<HTMLInputElement | null>(null);
  const [expandedStepIds, setExpandedStepIds] = useState<string[]>([]);
  const [editorViewMode, setEditorViewMode] = useState<"card" | "list" | "graph">("graph");
  const [graphPanOffset, setGraphPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [graphZoomLevel, setGraphZoomLevel] = useState<number>(1);
  const [isGraphDragging, setIsGraphDragging] = useState<boolean>(false);
  const [graphDragStart, setGraphDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isGraphLocked, setIsGraphLocked] = useState<boolean>(false);
  const [isGraphFullscreen, setIsGraphFullscreen] = useState<boolean>(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    const handleGlobalClick = () => {
      setWorkspaceContextMenu(null);
      setNodeContextMenu(null);
    };
    window.addEventListener("click", handleGlobalClick);
    return () => {
      window.removeEventListener("click", handleGlobalClick);
    };
  }, []);

  useEffect(() => {
    if (isRecordingHotkey && hotkeyInputRef.current) {
      hotkeyInputRef.current.focus();
    }
  }, [isRecordingHotkey]);

  useEffect(() => {
    const viewport = graphViewportRef.current;
    if (!viewport) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (isGraphLocked) return;
      const zoomFactor = 0.05;
      setGraphZoomLevel((prevZoom) => {
        let nextZoom = prevZoom - e.deltaY * zoomFactor * 0.005;
        return Math.max(0.3, Math.min(2.0, nextZoom));
      });
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", handleWheel);
    };
  }, [isGraphLocked, editingWorkspace, editorViewMode, isGraphFullscreen]);

  const loadLogs = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_LOGS);
      if (raw) {
        setLaunchLogs(JSON.parse(raw));
      } else {
        setLaunchLogs([]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (showLogsModal) {
      loadLogs();
    }
  }, [showLogsModal]);

  // Load from LocalStorage
  useEffect(() => {
    const rawWs = localStorage.getItem(STORAGE_KEY_WORKSPACES);
    const rawSteps = localStorage.getItem(STORAGE_KEY_STEPS);
    if (rawWs) {
      try {
        setWorkspaces(JSON.parse(rawWs));
      } catch (e) {
        console.error("Failed to parse workspaces", e);
      }
    }
    if (rawSteps) {
      try {
        setSteps(JSON.parse(rawSteps));
      } catch (e) {
        console.error("Failed to parse steps", e);
      }
    }
  }, []);

  // Handle cross-component editing signal
  useEffect(() => {
    const editId = localStorage.getItem("orbitstart.workspaces.editing_id");
    if (editId && workspaces.length > 0) {
      localStorage.removeItem("orbitstart.workspaces.editing_id");
      const found = workspaces.find((w) => w.id === editId);
      if (found) {
        setEditingWorkspace(found);
        const wsSteps = steps
          .filter((s) => s.workspaceId === editId)
          .sort((a, b) => a.order - b.order);
        setEditingSteps([...wsSteps]);
        setIsNew(false);
      }
    }
  }, [workspaces, steps]);

  // Save to LocalStorage and reload plugin commands
  const saveAllData = (nextWs: Workspace[], nextSteps: WorkspaceStep[]) => {
    localStorage.setItem(STORAGE_KEY_WORKSPACES, JSON.stringify(nextWs));
    localStorage.setItem(STORAGE_KEY_STEPS, JSON.stringify(nextSteps));
    setWorkspaces(nextWs);
    setSteps(nextSteps);

    // Sync workspaces to the background worker runtime
    if (pluginHost && pluginHost.commands && typeof pluginHost.commands.run === "function") {
      pluginHost.commands.run("workspaces.reload").catch((err: any) => {
        console.error("Failed to reload workspaces in plugin", err);
      });
    }
  };

  const handleCreateWorkspace = () => {
    setEditingWorkspace({
      id: "ws_" + Math.random().toString(36).substr(2, 9),
      name: "",
      description: "",
      icon: "Briefcase",
      color: COLOR_PRESETS[0],
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      launchCount: 0
    });
    setEditingSteps([]);
    setExpandedStepIds([]);
    setEditorViewMode("graph");
    setGraphPanOffset({ x: 0, y: 0 });
    setGraphZoomLevel(1);
    setIsGraphLocked(false);
    setIsGraphFullscreen(false);
    setSelectedNodeId(null);
    setIsNew(true);
  };

  const handleEditWorkspace = (ws: Workspace) => {
    setEditingWorkspace({ ...ws });
    const wsSteps = steps
      .filter((s) => s.workspaceId === ws.id)
      .sort((a, b) => a.order - b.order);
    setEditingSteps([...wsSteps]);
    setExpandedStepIds([]);
    setEditorViewMode("graph");
    setGraphPanOffset({ x: 0, y: 0 });
    setGraphZoomLevel(1);
    setIsGraphLocked(false);
    setIsGraphFullscreen(false);
    setSelectedNodeId(null);
    setIsNew(false);
  };

  const handleDeleteWorkspace = (id: string) => {
    setDeleteConfirmId(id);
  };

  const getGraphLayout = () => getWorkspaceGraphLayout(editingSteps);

  const handleZoomToFit = () => {
    const { nodes } = getGraphLayout();
    if (nodes.length === 0) return;
    const xs = nodes.map(n => n.x);
    const ys = nodes.map(n => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    const graphW = maxX - minX + 220;
    const graphH = maxY - minY + 150;
    
    const canvasW = 550;
    const canvasH = 360;
    
    const scaleX = canvasW / graphW;
    const scaleY = canvasH / graphH;
    const newZoom = Math.max(0.5, Math.min(1.2, Math.min(scaleX, scaleY)));
    
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    
    setGraphZoomLevel(newZoom);
    setGraphPanOffset({
      x: 275 - midX * newZoom,
      y: 160 - midY * newZoom
    });
  };

  const handleNodeContextMenu = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setNodeContextMenu({
      x: e.clientX,
      y: e.clientY,
      nodeId
    });
  };

  const handleGraphMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isGraphLocked) return;
    if (e.button !== 0) return;
    setIsGraphDragging(true);
    setGraphDragStart({ x: e.clientX - graphPanOffset.x, y: e.clientY - graphPanOffset.y });
  };

  const handleGraphMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isGraphDragging) return;
    setGraphPanOffset({
      x: e.clientX - graphDragStart.x,
      y: e.clientY - graphDragStart.y
    });
  };

  const handleGraphMouseUp = () => {
    setIsGraphDragging(false);
  };

  useEffect(() => {
    if (editorViewMode === "graph") {
      setTimeout(() => {
        handleZoomToFit();
      }, 50);
    }
  }, [editorViewMode]);

  const handleHotkeyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const keys: string[] = [];
    if (e.ctrlKey) keys.push("Ctrl");
    if (e.altKey) keys.push("Alt");
    if (e.shiftKey) keys.push("Shift");
    if (e.metaKey) keys.push("Win");

    const ignoreKeys = ["Control", "Alt", "Shift", "Meta", "CapsLock", "Tab"];
    if (!ignoreKeys.includes(e.key)) {
      let keyName = e.key;
      if (keyName === " ") keyName = "Space";
      else if (keyName.length === 1) keyName = keyName.toUpperCase();
      
      keys.push(keyName);
      const hotkeyStr = keys.join("+");
      
      if (editingWorkspace) {
        setEditingWorkspace({ ...editingWorkspace, hotkey: hotkeyStr });
      }
      setIsRecordingHotkey(false);
    }
  };

  const handleSaveEdit = () => {
    if (!editingWorkspace) return;
    if (!editingWorkspace.name.trim()) {
      setThemedAlert({ title: "提示", message: "工作区名称不能为空", type: "error" });
      return;
    }

    let nextWs = [...workspaces];
    if (isNew) {
      nextWs.push(editingWorkspace);
    } else {
      nextWs = nextWs.map((w) => (w.id === editingWorkspace.id ? editingWorkspace : w));
    }

    // Filter out step updates for this workspace, then merge new steps
    const cleanSteps = steps.filter((s) => s.workspaceId !== editingWorkspace.id);
    const updatedSteps = editingSteps.map((s, idx) => ({
      ...s,
      order: idx + 1,
      updatedAt: new Date().toISOString()
    }));

    // Sync shortcut to the system
    invoke("update_workspace_hotkey", { 
      workspaceId: editingWorkspace.id, 
      newHotkey: editingWorkspace.hotkey || null 
    }).catch((err) => {
      console.error("Failed to update workspace hotkey:", err);
    });

    saveAllData(nextWs, [...cleanSteps, ...updatedSteps]);
    setEditingWorkspace(null);
    setEditingSteps([]);
  };

  const handleCaptureWindowLayout = async () => {
    try {
      const activeWindows = await invoke<WorkspaceWindowLayout[]>("workspaces_capture_active_windows");
      if (!activeWindows || activeWindows.length === 0) {
        setThemedAlert({
          title: "提示",
          message: "未检测到任何正在运行的活跃应用窗口，请确认是否有程序处于打开且非最小化状态。",
          type: "info"
        });
        return;
      }

      setScannedWindows(activeWindows);

      const initialBindings: { [index: number]: string } = {};
      const initialSelected: number[] = [];

      activeWindows.forEach((win, index) => {
        const procLower = win.processName.toLowerCase();
        const cleanProc = procLower.replace(/\.exe$/, "");
        const winTitleLower = (win.windowTitle || "").toLowerCase();

        const matchedStep = editingSteps.find((step) => {
          if (step.type === "script" || step.type === "wait") return false;

          const targetLower = (step.target || "").toLowerCase();
          const titleLower = (step.title || "").toLowerCase();

          if (step.type === "folder") {
            const folderBase = step.target.split(/[\\/]/).pop()?.toLowerCase();
            if (folderBase && (winTitleLower === folderBase || winTitleLower.includes(folderBase))) return true;
          }

          if (titleLower && (titleLower.includes(cleanProc) || cleanProc.includes(titleLower))) return true;
          if (targetLower && targetLower.includes(procLower)) return true;

          return false;
        });

        if (matchedStep) {
          initialBindings[index] = matchedStep.id;
          initialSelected.push(index);
        } else {
          initialBindings[index] = "new";
          const isExplorerFolder = procLower === "explorer.exe" && winTitleLower.length > 0;
          if (isExplorerFolder || (!procLower.includes("explorer") && !procLower.includes("host") && !procLower.includes("wmi") && !procLower.includes("ime"))) {
            initialSelected.push(index);
          }
        }
      });

      setWindowBindings(initialBindings);
      setSelectedWindowIndices(initialSelected);
      setScanLayoutModalOpen(true);
    } catch (err) {
      console.error("Failed to capture active windows layout:", err);
      setThemedAlert({
        title: "错误",
        message: "获取活跃窗口失败：" + String(err),
        type: "error"
      });
    }
  };

  const handleImportScannedLayouts = () => {
    let nextSteps = [...editingSteps];
    let newStepsAdded = 0;
    let boundStepsCount = 0;

    selectedWindowIndices.forEach((index) => {
      const win = scannedWindows[index];
      if (!win) return;

      const binding = windowBindings[index] || "new";

      if (binding === "new") {
        const cleanName = win.processName.replace(/\.exe$/i, "");
        const newStep: WorkspaceStep = {
          id: "step_" + Math.random().toString(36).substr(2, 9),
          workspaceId: editingWorkspace?.id || "",
          order: nextSteps.length + 1,
          type: "app",
          title: win.windowTitle || cleanName,
          target: win.executablePath || win.processName,
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          windowLayout: {
            processName: win.processName,
            windowTitle: win.windowTitle,
            executablePath: win.executablePath,
            x: win.x,
            y: win.y,
            width: win.width,
            height: win.height,
            isMaximized: win.isMaximized,
            capturedAt: new Date().toISOString()
          }
        };
        nextSteps.push(newStep);
        newStepsAdded++;
      } else {
        nextSteps = nextSteps.map((step) => {
          if (step.id !== binding) return step;
          return {
            ...step,
            windowLayout: {
              processName: win.processName,
              windowTitle: win.windowTitle,
              executablePath: win.executablePath,
              x: win.x,
              y: win.y,
              width: win.width,
              height: win.height,
              isMaximized: win.isMaximized,
              capturedAt: new Date().toISOString()
            }
          };
        });
        boundStepsCount++;
      }
    });

    setEditingSteps(nextSteps);
    setScanLayoutModalOpen(false);

    setThemedAlert({
      title: "导入成功",
      message: `成功新建了 ${newStepsAdded} 个启动步骤，并关联更新了 ${boundStepsCount} 个步骤的窗口坐标！\n（请保存工作区以使其生效）`,
      type: "success"
    });
  };

  const handleCaptureSingleStepLayout = async (stepId: string) => {
    try {
      const activeWindows = await invoke<WorkspaceWindowLayout[]>("workspaces_capture_active_windows");
      const step = editingSteps.find((s) => s.id === stepId);
      if (!step) return;
      
      const targetLower = (step.target || "").toLowerCase();
      const titleLower = (step.title || "").toLowerCase();
      const itemIdLower = (step.itemId || "").toLowerCase();
      
      const matches = activeWindows.filter((win) => {
        const procLower = win.processName.toLowerCase();
        const winTitleLower = (win.windowTitle || "").toLowerCase();
        
        if (step.type === "folder") {
          const folderBase = step.target.split(/[\\/]/).pop()?.toLowerCase();
          if (folderBase && (winTitleLower === folderBase || winTitleLower.includes(folderBase))) return true;
        }

        if (titleLower && winTitleLower.includes(titleLower)) {
          return true;
        }
        
        if (targetLower && (targetLower.includes(procLower) || procLower.includes(targetLower))) {
          return true;
        }
        
        if (itemIdLower && (itemIdLower.includes(procLower) || procLower.includes(itemIdLower))) {
          return true;
        }
        
        return false;
      });
      
      if (matches.length > 0) {
        const matchedWin = matches[0];
        handleUpdateStep(stepId, {
          windowLayout: {
            ...matchedWin,
            capturedAt: new Date().toISOString()
          }
        });
        setThemedAlert({
          title: "捕获成功",
          message: `已成功捕获并关联窗口：\n${matchedWin.windowTitle || matchedWin.processName}`,
          type: "success"
        });
      } else {
        const winListStr = activeWindows.length > 0 
          ? activeWindows.map(w => `• [${w.processName}] ${w.windowTitle || "无标题"}`).slice(0, 15).join("\n") 
          : "（无）";
        setThemedAlert({
          title: "提示",
          message: `未在屏幕上检测到与「${step.title || step.target}」相关的正在运行的窗口。\n\n当前检测到的活跃窗口有：\n${winListStr}\n(共 ${activeWindows.length} 个)`,
          type: "info"
        });
      }
    } catch (err) {
      setThemedAlert({
        title: "错误",
        message: "捕获窗口失败: " + String(err),
        type: "error"
      });
    }
  };

  const handlePickFile = async (filter = "*.*", title = "选择文件"): Promise<string | null> => {
    try {
      const picked = await invoke<string | null>("workspaces_pick_file", { filter, title });
      return picked;
    } catch (err) {
      console.error("Failed to pick file:", err);
      return null;
    }
  };

  const handlePickFolder = async (): Promise<string | null> => {
    try {
      const picked = await invoke<string | null>("workspaces_pick_folder");
      return picked;
    } catch (err) {
      console.error("Failed to pick folder:", err);
      return null;
    }
  };

  const handleAddStep = (dependsOnId?: string) => {
    if (!editingWorkspace) return;
    const newStep: WorkspaceStep = {
      id: "step_" + Math.random().toString(36).substr(2, 9),
      workspaceId: editingWorkspace.id,
      order: editingSteps.length + 1,
      type: "item",
      title: "启动项",
      target: "",
      arguments: "",
      workingDirectory: "",
      failurePolicy: "continue",
      enabled: true,
      delayMs: 0,
      dependsOn: dependsOnId ? [dependsOnId] : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setEditingSteps([...editingSteps, newStep]);
    setExpandedStepIds([...expandedStepIds, newStep.id]);
    setSelectedNodeId(newStep.id);
  };

  const handleUpdateStep = (stepId: string, updates: Partial<WorkspaceStep>) => {
    setEditingSteps(
      editingSteps.map((s) => {
        if (s.id !== stepId) return s;
        const merged = { ...s, ...updates };
        if (updates.itemId) {
          const item = items.find((i) => i.id === updates.itemId);
          if (item) {
            merged.title = item.title;
            merged.target = item.target;
            merged.type = item.kind as any;
            merged.arguments = item.arguments || "";
          }
        }
        return merged;
      })
    );
  };

  const handleDeleteStep = (stepId: string) => {
    setEditingSteps(editingSteps.filter((s) => s.id !== stepId));
  };

  const handleCopyNode = (stepId: string) => {
    const step = editingSteps.find(s => s.id === stepId);
    if (!step) return;
    const { id, workspaceId, order, dependsOn, createdAt, updatedAt, ...rest } = step;
    setCopiedStep(rest);
  };

  const handlePasteNodeAfter = (targetStepId: string) => {
    if (!editingWorkspace || !copiedStep) return;

    const newStepId = "step_" + Math.random().toString(36).substr(2, 9);
    let targetOrder = 0;
    let newDependsOn: string[] = [];

    if (targetStepId === "ROOT") {
      targetOrder = 0;
      newDependsOn = [];
    } else {
      const targetStep = editingSteps.find(s => s.id === targetStepId);
      if (!targetStep) return;
      targetOrder = targetStep.order;
      newDependsOn = [targetStepId];
    }

    const newStep: WorkspaceStep = {
      id: newStepId,
      workspaceId: editingWorkspace.id,
      order: targetOrder + 0.5,
      type: copiedStep.type || "item",
      title: copiedStep.title || "粘贴的启动项",
      target: copiedStep.target || "",
      arguments: copiedStep.arguments || "",
      workingDirectory: copiedStep.workingDirectory || "",
      failurePolicy: copiedStep.failurePolicy || "continue",
      enabled: copiedStep.enabled !== false,
      delayMs: copiedStep.delayMs || 0,
      dependsOn: newDependsOn,
      scriptConfig: copiedStep.scriptConfig ? { ...copiedStep.scriptConfig } : undefined,
      waitCondition: copiedStep.waitCondition ? { ...copiedStep.waitCondition } : undefined,
      windowLayout: copiedStep.windowLayout ? { ...copiedStep.windowLayout } : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    let updatedSteps = [...editingSteps];
    if (targetStepId !== "ROOT") {
      updatedSteps = updatedSteps.map(step => {
        if (step.dependsOn && step.dependsOn.includes(targetStepId)) {
          return {
            ...step,
            dependsOn: step.dependsOn.map(id => id === targetStepId ? newStepId : id)
          };
        }
        return step;
      });
    }

    const allSteps = [...updatedSteps, newStep].sort((a, b) => a.order - b.order);
    allSteps.forEach((step, idx) => {
      step.order = idx + 1;
    });

    setEditingSteps(allSteps);
    setExpandedStepIds([...expandedStepIds, newStepId]);
    setSelectedNodeId(newStepId);
  };

  const handleReplaceNode = (targetStepId: string) => {
    if (!copiedStep) return;
    setEditingSteps(prevSteps => prevSteps.map(step => {
      if (step.id === targetStepId) {
        return {
          ...step,
          type: copiedStep.type || "item",
          title: copiedStep.title || "替换的启动项",
          target: copiedStep.target || "",
          arguments: copiedStep.arguments || "",
          workingDirectory: copiedStep.workingDirectory || "",
          failurePolicy: copiedStep.failurePolicy || "continue",
          enabled: copiedStep.enabled !== false,
          delayMs: copiedStep.delayMs || 0,
          scriptConfig: copiedStep.scriptConfig ? { ...copiedStep.scriptConfig } : undefined,
          waitCondition: copiedStep.waitCondition ? { ...copiedStep.waitCondition } : undefined,
          windowLayout: copiedStep.windowLayout ? { ...copiedStep.windowLayout } : undefined,
          updatedAt: new Date().toISOString()
        };
      }
      return step;
    }));
    
    if (selectedNodeId === targetStepId) {
      setSelectedNodeId(null);
      setTimeout(() => setSelectedNodeId(targetStepId), 50);
    }
  };

  const handleMoveStep = (index: number, direction: "up" | "down") => {
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= editingSteps.length) return;

    const list = [...editingSteps];
    const temp = list[index];
    list[index] = list[nextIndex];
    list[nextIndex] = temp;

    setEditingSteps(list);
  };

  const handleLaunch = async (workspace: Workspace) => {
    setLaunchingId(workspace.id);
    try {
      const commandId = `workspaces.run-workspace-${sanitizeCommandId(workspace.id)}`;
      if (pluginHost && pluginHost.commands && typeof pluginHost.commands.run === "function") {
        await pluginHost.commands.run(commandId);
        // Refresh local view count and launched stats
        setTimeout(() => {
          const rawWs = localStorage.getItem(STORAGE_KEY_WORKSPACES);
          if (rawWs) {
            try {
              setWorkspaces(JSON.parse(rawWs));
            } catch (e) {}
          }
        }, 1500);
      } else {
        setThemedAlert({
          title: "错误",
          message: "插件系统不可用，无法启动工作区",
          type: "error"
        });
      }
    } catch (e) {
      console.error("Workspace launch failed", e);
      setThemedAlert({
        title: "启动失败",
        message: `启动失败，错误信息：${String(e)}`,
        type: "error"
      });
    } finally {
      setLaunchingId(null);
    }
  };

  return (
    <div className="tab-pane-content workspace-panel">
      {editingWorkspace ? (
        // EDIT MODE UI
        <div className="workspace-editor glass-panel">
          <div className="panel-header">
            <h2>{isNew ? "新建工作区" : "编辑工作区"}</h2>
            <button className="icon-button" onClick={() => setEditingWorkspace(null)}>
              <X size={20} />
            </button>
          </div>

          <div className="editor-body">
            <div className="meta-section">
              <div className="input-group">
                <label>工作区名称</label>
                <input 
                  type="text" 
                  value={editingWorkspace.name}
                  onChange={(e) => setEditingWorkspace({ ...editingWorkspace, name: e.target.value })}
                  placeholder="例如：开发环境、早间办公"
                />
              </div>

              <div className="input-group">
                <label>描述</label>
                <input 
                  type="text" 
                  value={editingWorkspace.description || ""}
                  onChange={(e) => setEditingWorkspace({ ...editingWorkspace, description: e.target.value })}
                  placeholder="描述此工作区一键启动的场景"
                />
              </div>

              <div className="input-group">
                <label>全局快捷键</label>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  <input 
                    ref={hotkeyInputRef}
                    type="text" 
                    value={isRecordingHotkey ? "请在键盘上按下快捷键..." : (editingWorkspace.hotkey || "未绑定")}
                    readOnly
                    onKeyDown={isRecordingHotkey ? handleHotkeyKeyDown : undefined}
                    placeholder="点击右侧按钮绑定快捷键"
                    style={{ 
                      flexGrow: 1, 
                      color: isRecordingHotkey ? "var(--accent, var(--gold))" : (editingWorkspace.hotkey ? "var(--text)" : "var(--text-muted)"),
                      fontWeight: isRecordingHotkey ? "bold" : "normal",
                      caretColor: "transparent",
                      cursor: "default"
                    }}
                  />
                  {isRecordingHotkey ? (
                    <button 
                      type="button" 
                      className="secondary-action compact-action" 
                      onClick={() => setIsRecordingHotkey(false)}
                    >
                      取消录制
                    </button>
                  ) : (
                    <>
                      <button 
                        type="button" 
                        className="secondary-action compact-action" 
                        onClick={() => setIsRecordingHotkey(true)}
                      >
                        录制快捷键
                      </button>
                      {editingWorkspace.hotkey && (
                        <button 
                          type="button" 
                          className="secondary-action compact-action danger-action" 
                          onClick={() => setEditingWorkspace({ ...editingWorkspace, hotkey: undefined })}
                        >
                          清除
                        </button>
                      )}
                    </>
                  )}
                </div>
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  绑定后，您可以在后台或任意界面通过该快捷键一键启动此工作区。（例如：Ctrl+Alt+F1）
                </span>
              </div>

              <div className="input-group" style={{ flexDirection: "row", alignItems: "center", gap: "10px", margin: "var(--space-2) 0" }}>
                <input 
                  type="checkbox" 
                  id="prevent-duplicate-toggle"
                  checked={editingWorkspace.preventDuplicate !== false}
                  onChange={(e) => setEditingWorkspace({ ...editingWorkspace, preventDuplicate: e.target.checked })}
                  style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "var(--gold)" }}
                />
                <label htmlFor="prevent-duplicate-toggle" style={{ margin: 0, cursor: "pointer", fontSize: "0.85rem", color: "var(--text)" }}>
                  防重复启动 (若已运行则仅移动位置，不重复打开新实例)
                </label>
              </div>

              <div className="presets-row">
                <div className="preset-group">
                  <label>主题色</label>
                  <div className="preset-colors">
                    {COLOR_PRESETS.map((color) => (
                      <button
                        key={color}
                        className={`preset-color ${editingWorkspace.color === color ? "active" : ""}`}
                        style={{ backgroundColor: color }}
                        onClick={() => setEditingWorkspace({ ...editingWorkspace, color })}
                      />
                    ))}
                  </div>
                </div>

                <div className="preset-group">
                  <label>图标</label>
                  <div className="preset-icons">
                    {ICON_PRESETS.map((icon) => (
                      <button
                        key={icon}
                        className={`preset-icon ${editingWorkspace.icon === icon ? "active" : ""}`}
                        onClick={() => setEditingWorkspace({ ...editingWorkspace, icon })}
                      >
                        {getWorkspaceIcon(icon, editingWorkspace.color, 18)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="steps-section" style={{ marginTop: "24px" }}>
              <div className="steps-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <h3 style={{ margin: 0 }}>启动步骤清单 ({editingSteps.length})</h3>
                  <div style={{ display: "flex", background: "rgba(255,255,255,0.03)", padding: "2px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                    <button 
                      type="button" 
                      onClick={() => setEditorViewMode("graph")}
                      style={{
                        background: editorViewMode === "graph" ? "var(--surface-3)" : "none",
                        border: "none",
                        borderRadius: "6px",
                        color: editorViewMode === "graph" ? "var(--text)" : "var(--text-muted)",
                        padding: "4px 10px",
                        fontSize: "0.72rem",
                        cursor: "pointer",
                        fontWeight: editorViewMode === "graph" ? "bold" : "normal",
                        transition: "all 0.15s ease"
                      }}
                    >
                      图形模式
                    </button>
                    <button 
                      type="button" 
                      onClick={() => setEditorViewMode("card")}
                      style={{
                        background: editorViewMode === "card" ? "var(--surface-3)" : "none",
                        border: "none",
                        borderRadius: "6px",
                        color: editorViewMode === "card" ? "var(--text)" : "var(--text-muted)",
                        padding: "4px 10px",
                        fontSize: "0.72rem",
                        cursor: "pointer",
                        fontWeight: editorViewMode === "card" ? "bold" : "normal",
                        transition: "all 0.15s ease"
                      }}
                    >
                      卡片模式
                    </button>
                    <button 
                      type="button" 
                      onClick={() => setEditorViewMode("list")}
                      style={{
                        background: editorViewMode === "list" ? "var(--surface-3)" : "none",
                        border: "none",
                        borderRadius: "6px",
                        color: editorViewMode === "list" ? "var(--text)" : "var(--text-muted)",
                        padding: "4px 10px",
                        fontSize: "0.72rem",
                        cursor: "pointer",
                        fontWeight: editorViewMode === "list" ? "bold" : "normal",
                        transition: "all 0.15s ease"
                      }}
                    >
                      列表模式
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                  {editingSteps.length > 0 && (
                    <button type="button" className="secondary-action compact-action" onClick={handleCaptureWindowLayout} title="捕获当前屏幕上所有打开软件的窗口大小与坐标并自动匹配绑定到对应步骤">
                      <AppWindow size={16} /> 自动关联当前窗口位置
                    </button>
                  )}
                  <button className="primary-action compact-action" onClick={() => handleAddStep()}>
                    <Plus size={16} /> 添加步骤
                  </button>
                </div>
              </div>

              {editingSteps.length === 0 ? (
                <div className="empty-steps">
                  <HelpCircle size={32} className="text-muted" />
                  <p>暂无启动步骤，点击上方“添加步骤”开始配置</p>
                </div>
              ) : (
                <>
                  {editorViewMode === "card" && (
                    <div className="steps-list">
                  {editingSteps.map((step, index) => {
                    const isExpanded = expandedStepIds.includes(step.id);
                    return (
                      <div key={step.id} className="step-item glass-card" style={{ padding: isExpanded ? "var(--space-4)" : "10px 16px" }}>
                        <div className="step-drag-handle" style={{ alignSelf: isExpanded ? "flex-start" : "center", marginTop: isExpanded ? "10px" : "0" }}>
                          <button 
                            className="sort-btn" 
                            disabled={index === 0} 
                            onClick={() => handleMoveStep(index, "up")}
                          >
                            <ArrowUp size={14} />
                          </button>
                          <span className="step-number">{index + 1}</span>
                          <button 
                            className="sort-btn" 
                            disabled={index === editingSteps.length - 1} 
                            onClick={() => handleMoveStep(index, "down")}
                          >
                            <ArrowDown size={14} />
                          </button>
                        </div>

                        {!isExpanded ? (
                          <div 
                            className="step-collapsed-summary" 
                            style={{ display: "flex", alignItems: "center", gap: "12px", width: "100%", cursor: "pointer", minWidth: 0, paddingLeft: "16px" }}
                            onClick={() => setExpandedStepIds([...expandedStepIds, step.id])}
                          >
                            <div className="step-info-badge" style={{ display: "flex", alignItems: "center", gap: "8px", flexGrow: 1, minWidth: 0 }}>
                              {getStepIcon(step.type)}
                              <span style={{ fontWeight: "bold", fontSize: "0.85rem", color: "var(--text)", whiteSpace: "nowrap" }}>
                                {step.title || (step.type === "item" ? "未关联资源" : step.type)}
                              </span>
                              <span className="type-tag" style={{ fontSize: "0.7rem", padding: "2px 6px", borderRadius: "4px", background: "var(--surface-3)", color: "var(--text-muted)", flexShrink: 0 }}>
                                {step.type === "item" ? "已存资源" :
                                 step.type === "app" ? "应用" :
                                 step.type === "website" ? "网站" :
                                 step.type === "folder" ? "文件夹" :
                                 step.type === "file" ? "文件" :
                                 step.type === "script" ? "脚本" :
                                 step.type === "wait" ? "等待" : "未知"}
                              </span>
                              {step.target && (
                                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexGrow: 1, maxWidth: "300px" }}>
                                  {step.target}
                                </span>
                              )}
                            </div>

                            {/* Indicators */}
                            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexShrink: 0 }}>
                              {(step.delayMs || 0) > 0 && (
                                <span title={`延迟: ${step.delayMs}ms`} style={{ fontSize: "0.7rem", color: "var(--gold)", background: "rgba(197,160,89,0.1)", padding: "2px 6px", borderRadius: "4px", display: "flex", alignItems: "center", gap: "3px" }}>
                                  <Clock size={11} /> {step.delayMs}ms
                                </span>
                              )}
                              {step.windowLayout && (
                                <span title="窗口位置已捕获" style={{ fontSize: "0.7rem", color: "#37d6bf", background: "rgba(55,214,191,0.1)", padding: "2px 6px", borderRadius: "4px", display: "flex", alignItems: "center", gap: "3px" }}>
                                  <AppWindow size={11} />
                                  {step.windowLayout.alwaysOnTop && <span style={{ color: "var(--gold)", fontWeight: "bold" }}>置顶</span>}
                                </span>
                              )}
                            </div>

                            {/* Toggle expand / Delete */}
                            <div style={{ display: "flex", gap: "4px", alignItems: "center", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                              <button 
                                type="button" 
                                className="icon-button" 
                                title="展开设置"
                                onClick={() => setExpandedStepIds([...expandedStepIds, step.id])}
                              >
                                <ChevronDown size={16} />
                              </button>
                              <button 
                                type="button" 
                                className="icon-button text-danger" 
                                title="删除此步骤"
                                onClick={() => handleDeleteStep(step.id)}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="step-config" style={{ width: "100%" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)", width: "100%" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                {getStepIcon(step.type)}
                                <strong style={{ fontSize: "0.9rem" }}>配置步骤 #{index + 1}: {step.title}</strong>
                              </div>
                              <div style={{ display: "flex", gap: "4px" }}>
                                <button 
                                  type="button" 
                                  className="icon-button"
                                  title="收起步骤"
                                  onClick={() => setExpandedStepIds(expandedStepIds.filter(id => id !== step.id))}
                                >
                                  <ChevronUp size={16} />
                                </button>
                                <button 
                                  type="button" 
                                  className="icon-button text-danger" 
                                  title="删除"
                                  onClick={() => handleDeleteStep(step.id)}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </div>

                            <div className="step-resource-select">
                          <label>步骤类型</label>
                          <div style={{ display: "flex", gap: "var(--space-2)", width: "100%" }}>
                            <select
                              value={step.type === "item" ? "item" : (step.itemId ? "item" : step.type)}
                              onChange={(e) => {
                                const newType = e.target.value as any;
                                if (newType === "item") {
                                  handleUpdateStep(step.id, { type: "item", itemId: undefined, title: "未关联资源", target: "" });
                                } else if (newType === "script") {
                                  handleUpdateStep(step.id, { 
                                    type: "script", 
                                    itemId: undefined, 
                                    title: "运行脚本", 
                                    target: "",
                                    scriptConfig: { type: "bat", content: "@echo off\necho Hello World", useFile: false, filePath: "" } 
                                  });
                                } else if (newType === "wait") {
                                  handleUpdateStep(step.id, { 
                                    type: "wait", 
                                    itemId: undefined, 
                                    title: "等待条件", 
                                    target: "",
                                    waitCondition: { type: "time", value: "5000", timeoutMs: 30000 } 
                                  });
                                } else {
                                  handleUpdateStep(step.id, { type: newType, itemId: undefined, title: "", target: "" });
                                }
                              }}
                              className="select-type-dropdown"
                              style={{ width: "130px", background: "var(--field)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", color: "var(--text)", padding: "0 8px", height: "32px", fontSize: "0.8rem" }}
                            >
                              <option value="item">关联已有资源</option>
                              <option value="app">自定义程序</option>
                              <option value="website">自定义网址</option>
                              <option value="folder">自定义文件夹</option>
                              <option value="file">自定义文件</option>
                              <option value="script">脚本命令</option>
                              <option value="wait">条件等待</option>
                            </select>
                            
                            {(step.type === "item" || step.itemId) && (
                              <button 
                                type="button" 
                                className="select-resource-btn"
                                onClick={() => {
                                  setSelectorStepId(step.id);
                                  setSelectorSearch("");
                                }}
                                style={{ flexGrow: 1 }}
                              >
                                {step.itemId ? (
                                  <>
                                    {getStepIcon(step.type)}
                                    <span className="btn-text">{step.title}</span>
                                  </>
                                ) : (
                                  <>
                                    <Plus size={14} />
                                    <span className="btn-text">选择资源...</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Script Step Configuration */}
                        {step.type === "script" && (
                          <div className="step-script-config" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", width: "100%", marginTop: "var(--space-2)" }}>
                            <div style={{ display: "flex", gap: "var(--space-2)" }}>
                              <div className="step-input" style={{ width: "150px" }}>
                                <label>脚本类型</label>
                                <select
                                  value={step.scriptConfig?.type || "bat"}
                                  onChange={(e) => handleUpdateStep(step.id, { 
                                    scriptConfig: { ...(step.scriptConfig || { content: "", useFile: false, filePath: "" }), type: e.target.value as any } 
                                  })}
                                >
                                  <option value="bat">Batch (.bat/.cmd)</option>
                                  <option value="ps1">PowerShell (.ps1)</option>
                                </select>
                              </div>
                              <div className="step-input" style={{ flexGrow: 1 }}>
                                <label>脚本标题</label>
                                <input
                                  type="text"
                                  value={step.title}
                                  onChange={(e) => handleUpdateStep(step.id, { title: e.target.value })}
                                  placeholder="运行脚本的描述标题"
                                />
                              </div>
                            </div>
                            
                            <div style={{ display: "flex", gap: "var(--space-4)", marginTop: "4px" }}>
                              <label className="toggle-label" style={{ fontSize: "0.8rem" }}>
                                <input
                                  type="radio"
                                  name={`script-source-${step.id}`}
                                  checked={!step.scriptConfig?.useFile}
                                  onChange={() => handleUpdateStep(step.id, { 
                                    scriptConfig: { ...(step.scriptConfig || { type: "bat", content: "", filePath: "" }), useFile: false } 
                                  })}
                                />
                                在线编写脚本内容
                              </label>
                              <label className="toggle-label" style={{ fontSize: "0.8rem" }}>
                                <input
                                  type="radio"
                                  name={`script-source-${step.id}`}
                                  checked={step.scriptConfig?.useFile}
                                  onChange={() => handleUpdateStep(step.id, { 
                                    scriptConfig: { ...(step.scriptConfig || { type: "bat", content: "", filePath: "" }), useFile: true } 
                                  })}
                                />
                                执行本地脚本文件
                              </label>
                            </div>
                            
                            {!step.scriptConfig?.useFile ? (
                              <div className="step-input" style={{ width: "100%" }}>
                                <label>脚本内容</label>
                                <textarea
                                  value={step.scriptConfig?.content || ""}
                                  onChange={(e) => handleUpdateStep(step.id, { 
                                    scriptConfig: { ...(step.scriptConfig || { type: "bat", useFile: false, filePath: "" }), content: e.target.value } 
                                  })}
                                  placeholder={step.scriptConfig?.type === "ps1" ? "Write PowerShell script here...\ne.g. Get-Process | select -First 5" : "Write Batch script here...\ne.g. echo Hello World"}
                                  rows={4}
                                  style={{ width: "100%", background: "var(--field)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", color: "var(--text)", padding: "8px", fontFamily: "monospace", fontSize: "0.8rem" }}
                                />
                                <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--gold)", fontSize: "0.72rem", marginTop: "4px", background: "rgba(197, 160, 89, 0.05)", padding: "4px 8px", borderRadius: "4px", border: "1px solid rgba(197, 160, 89, 0.15)" }}>
                                  <AlertCircle size={12} />
                                  <span>安全提示：脚本会在本机执行，请只运行您信任的脚本。</span>
                                </div>
                              </div>
                            ) : (
                              <div className="step-input" style={{ width: "100%" }}>
                                <label>脚本文件路径</label>
                                <div style={{ display: "flex", gap: "var(--space-1)", width: "100%" }}>
                                  <input
                                    type="text"
                                    value={step.scriptConfig?.filePath || ""}
                                    onChange={(e) => handleUpdateStep(step.id, { 
                                      scriptConfig: { ...(step.scriptConfig || { type: "bat", useFile: true, content: "" }), filePath: e.target.value } 
                                    })}
                                    placeholder="C:\path\to\script.ps1 或 .bat"
                                    style={{ flexGrow: 1 }}
                                  />
                                  <button
                                    type="button"
                                    className="compact-action"
                                    title="选择脚本文件"
                                    style={{ padding: "0 8px", background: "var(--surface-3)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", height: "32px", cursor: "pointer" }}
                                    onClick={async () => {
                                      const filter = step.scriptConfig?.type === "ps1"
                                        ? "PowerShell scripts|*.ps1|All files|*.*"
                                        : "Batch scripts|*.bat;*.cmd|All files|*.*";
                                      const picked = await handlePickFile(filter, "选择脚本文件");
                                      if (picked) {
                                        handleUpdateStep(step.id, {
                                          scriptConfig: { ...(step.scriptConfig || { type: "bat", useFile: true, content: "" }), filePath: picked }
                                        });
                                      }
                                    }}
                                  >
                                    <FileText size={15} />
                                  </button>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--gold)", fontSize: "0.72rem", marginTop: "4px", background: "rgba(197, 160, 89, 0.05)", padding: "4px 8px", borderRadius: "4px", border: "1px solid rgba(197, 160, 89, 0.15)" }}>
                                  <AlertCircle size={12} />
                                  <span>安全提示：脚本会在本机执行，请只运行您信任的脚本。</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Wait Condition Configuration */}
                        {step.type === "wait" && (
                          <div className="step-wait-config" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", width: "100%", marginTop: "var(--space-2)" }}>
                            <div style={{ display: "flex", gap: "var(--space-2)" }}>
                              <div className="step-input" style={{ width: "130px" }}>
                                <label>等待条件类型</label>
                                <select
                                  value={step.waitCondition?.type || "time"}
                                  onChange={(e) => handleUpdateStep(step.id, { 
                                    waitCondition: { ...(step.waitCondition || { value: "", timeoutMs: 30000 }), type: e.target.value as any } 
                                  })}
                                >
                                  <option value="time">固定时间</option>
                                  <option value="process">进程运行中</option>
                                  <option value="port">TCP端口可访问</option>
                                  <option value="path">文件路径存在</option>
                                  <option value="url">URL可访问</option>
                                </select>
                              </div>
                              <div className="step-input" style={{ flexGrow: 1 }}>
                                <label>等待标题描述</label>
                                <input
                                  type="text"
                                  value={step.title}
                                  onChange={(e) => handleUpdateStep(step.id, { title: e.target.value })}
                                  placeholder="描述（例如：等待 localhost:3000）"
                                />
                              </div>
                            </div>
                            
                            <div style={{ display: "flex", gap: "var(--space-2)", width: "100%", flexWrap: "nowrap" }}>
                              <div className="step-input" style={{ flex: 1, minWidth: 0 }}>
                                <label>
                                  {step.waitCondition?.type === "time" && "等待时间 (毫秒)"}
                                  {step.waitCondition?.type === "process" && "进程名称 (例如: vmware.exe)"}
                                  {step.waitCondition?.type === "port" && "端口地址 (例如: localhost:3000)"}
                                  {step.waitCondition?.type === "path" && "本地或共享路径 (例如: E:\\Projects)"}
                                  {step.waitCondition?.type === "url" && "HTTP/HTTPS 链接 (例如: http://127.0.0.1:80)"}
                                </label>
                                <div style={{ display: "flex", gap: "var(--space-1)", width: "100%" }}>
                                  <input
                                    type="text"
                                    value={step.waitCondition?.value || ""}
                                    onChange={(e) => handleUpdateStep(step.id, { 
                                      waitCondition: { ...(step.waitCondition || { type: "time", timeoutMs: 30000 }), value: e.target.value } 
                                    })}
                                    placeholder={
                                      step.waitCondition?.type === "time" ? "5000" :
                                      step.waitCondition?.type === "process" ? "vmware.exe" :
                                      step.waitCondition?.type === "port" ? "localhost:3000" :
                                      step.waitCondition?.type === "path" ? "S:\\SambaShare" :
                                      "http://localhost:3000"
                                    }
                                    style={{ flexGrow: 1, minWidth: 0 }}
                                  />
                                  {step.waitCondition?.type === "path" && (
                                    <>
                                      <button
                                        type="button"
                                        className="compact-action"
                                        title="选择等待文件"
                                        style={{ padding: "0 8px", background: "var(--surface-3)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", height: "32px", cursor: "pointer", flexShrink: 0 }}
                                        onClick={async () => {
                                          const picked = await handlePickFile();
                                          if (picked) {
                                            handleUpdateStep(step.id, {
                                              waitCondition: { ...(step.waitCondition || { type: "path", timeoutMs: 30000 }), value: picked }
                                            });
                                          }
                                        }}
                                      >
                                        <FileText size={15} />
                                      </button>
                                      <button
                                        type="button"
                                        className="compact-action"
                                        title="选择等待文件夹"
                                        style={{ padding: "0 8px", background: "var(--surface-3)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", height: "32px", cursor: "pointer", flexShrink: 0 }}
                                        onClick={async () => {
                                          const picked = await handlePickFolder();
                                          if (picked) {
                                            handleUpdateStep(step.id, {
                                              waitCondition: { ...(step.waitCondition || { type: "path", timeoutMs: 30000 }), value: picked }
                                            });
                                          }
                                        }}
                                      >
                                        <FolderOpen size={15} />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                              {step.waitCondition?.type !== "time" && (
                                <div className="step-input" style={{ width: "110px", flexShrink: 0 }}>
                                  <label>最大超时 (ms)</label>
                                  <input
                                    type="number"
                                    min="1000"
                                    value={step.waitCondition?.timeoutMs || 30000}
                                    onChange={(e) => handleUpdateStep(step.id, { 
                                      waitCondition: { ...(step.waitCondition || { type: "process", value: "" }), timeoutMs: parseInt(e.target.value) || 30000 } 
                                    })}
                                    placeholder="30000"
                                    style={{ width: "100%" }}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Standard Custom Fields */}
                        {!step.itemId && step.type !== "script" && step.type !== "wait" && (
                          <>
                            <div className="step-input">
                              <label>步骤标题</label>
                              <input
                                type="text"
                                value={step.title}
                                onChange={(e) => handleUpdateStep(step.id, { title: e.target.value })}
                                placeholder="步骤说明"
                              />
                            </div>
                            <div className="step-input step-target">
                              <label>自定义目标路径或网址</label>
                              <div style={{ display: "flex", gap: "var(--space-1)", width: "100%" }}>
                                <input
                                  type="text"
                                  value={step.target}
                                  onChange={(e) => handleUpdateStep(step.id, { target: e.target.value })}
                                  placeholder="C:\path\to\app.exe 或 https://..."
                                  style={{ flexGrow: 1 }}
                                />
                                <button
                                  type="button"
                                  className="compact-action"
                                  title="选择文件"
                                  style={{ padding: "0 8px", background: "var(--surface-3)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", height: "32px", cursor: "pointer" }}
                                  onClick={async () => {
                                    const picked = await handlePickFile();
                                    if (picked) handleUpdateStep(step.id, { target: picked });
                                  }}
                                >
                                  <FileText size={15} />
                                </button>
                                <button
                                  type="button"
                                  className="compact-action"
                                  title="选择文件夹"
                                  style={{ padding: "0 8px", background: "var(--surface-3)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", height: "32px", cursor: "pointer" }}
                                  onClick={async () => {
                                    const picked = await handlePickFolder();
                                    if (picked) handleUpdateStep(step.id, { target: picked });
                                  }}
                                >
                                  <FolderOpen size={15} />
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                        
                        {step.itemId && step.type !== "script" && step.type !== "wait" && (
                          <div className="step-preview-info">
                            {getStepIcon(step.type)}
                            <span className="step-preview-title">{step.title}</span>
                            <span className="step-preview-target">{step.target}</span>
                          </div>
                        )}

                        {step.type !== "script" && step.type !== "wait" && (
                          <div className="step-delay">
                            <label>启动后延迟 (毫秒)</label>
                            <input
                              type="number"
                              min="0"
                              step="100"
                              value={step.delayMs || 0}
                              onChange={(e) => handleUpdateStep(step.id, { delayMs: parseInt(e.target.value) || 0 })}
                              placeholder="例如: 1000"
                            />
                          </div>
                        )}

                        <div className="step-actions">
                          <label className="toggle-label">
                            <input
                              type="checkbox"
                              checked={step.enabled}
                              onChange={(e) => handleUpdateStep(step.id, { enabled: e.target.checked })}
                            />
                            启用
                          </label>
                          <button className="icon-button text-danger" onClick={() => handleDeleteStep(step.id)}>
                            <Trash2 size={16} />
                          </button>
                        </div>

                        {/* Preceding Dependencies */}
                        {index > 0 && (
                          <div className="step-input step-depends-on" style={{ marginTop: "var(--space-2)", width: "100%" }}>
                            <label>前置依赖步骤 (仅当前置步骤成功启动才运行该步骤)</label>
                            <div className="depends-on-checkboxes" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "4px" }}>
                              {editingSteps.slice(0, index).map((prevStep, prevIdx) => {
                                const isChecked = (step.dependsOn || []).includes(prevStep.id);
                                return (
                                  <label key={prevStep.id} className="depends-on-checkbox-label">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={(e) => {
                                        const currentDeps = step.dependsOn || [];
                                        const nextDeps = e.target.checked
                                          ? [...currentDeps, prevStep.id]
                                          : currentDeps.filter((id) => id !== prevStep.id);
                                        handleUpdateStep(step.id, { dependsOn: nextDeps });
                                      }}
                                    />
                                    <span>步骤 {prevIdx + 1}: {prevStep.title || prevStep.target || "未命名"}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {step.type !== "script" && step.type !== "wait" && (
                          <div className="step-advanced-row">
                            <div className="step-input step-args">
                              <label>启动参数</label>
                              <input
                                type="text"
                                value={step.arguments || ""}
                                onChange={(e) => handleUpdateStep(step.id, { arguments: e.target.value })}
                                placeholder="参数 (如: --profile-directory=...)"
                              />
                            </div>
                            <div className="step-input step-workdir">
                              <label>工作目录</label>
                              <div style={{ display: "flex", gap: "var(--space-1)", width: "100%" }}>
                                <input
                                  type="text"
                                  value={step.workingDirectory || ""}
                                  onChange={(e) => handleUpdateStep(step.id, { workingDirectory: e.target.value })}
                                  placeholder="工作目录路径 (可选)"
                                  style={{ flexGrow: 1 }}
                                />
                                <button
                                  type="button"
                                  className="compact-action"
                                  title="选择工作目录"
                                  style={{ padding: "0 8px", background: "var(--surface-3)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", height: "32px", cursor: "pointer" }}
                                  onClick={async () => {
                                    const picked = await handlePickFolder();
                                    if (picked) handleUpdateStep(step.id, { workingDirectory: picked });
                                  }}
                                >
                                  <FolderOpen size={15} />
                                </button>
                              </div>
                            </div>
                            <div className="step-input step-policy">
                              <label>失败策略</label>
                              <select
                                value={step.failurePolicy || "continue"}
                                onChange={(e) => handleUpdateStep(step.id, { failurePolicy: e.target.value as any })}
                              >
                                <option value="continue">失败后继续</option>
                                <option value="stop">失败后停止</option>
                              </select>
                            </div>
                          </div>
                        )}

                        {step.type !== "script" && step.type !== "wait" && (
                          <div className="step-window-layout-config" style={{ marginTop: "var(--space-2)", width: "100%", background: "var(--surface-3)", padding: "10px", borderRadius: "var(--radius-sm)", border: "1px dashed var(--line)", display: "flex", flexDirection: "column", gap: "6px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <label style={{ fontSize: "0.75rem", fontWeight: "bold", color: "var(--gold)", display: "flex", alignItems: "center", gap: "4px" }}>
                                <AppWindow size={14} /> 窗口位置布局保存
                              </label>
                              {step.windowLayout ? (
                                <button 
                                  type="button" 
                                  className="text-action compact-action" 
                                  style={{ fontSize: "0.72rem", color: "#ef4444", border: "none", background: "none", cursor: "pointer", padding: 0 }}
                                  onClick={() => handleUpdateStep(step.id, { windowLayout: undefined })}
                                >
                                  清除保存的位置
                                </button>
                              ) : (
                                <button 
                                  type="button" 
                                  className="text-action compact-action" 
                                  style={{ fontSize: "0.72rem", color: "var(--gold)", border: "none", background: "none", cursor: "pointer", padding: 0 }}
                                  onClick={() => handleCaptureSingleStepLayout(step.id)}
                                >
                                  捕获此步骤当前窗口位置
                                </button>
                              )}
                            </div>
                            {step.windowLayout ? (
                              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
                                <div><strong>坐标 (X, Y):</strong> ({step.windowLayout.x}, {step.windowLayout.y})</div>
                                <div><strong>尺寸 (W x H):</strong> {step.windowLayout.width} x {step.windowLayout.height}</div>
                                <div style={{ gridColumn: "span 2" }}><strong>进程名:</strong> {step.windowLayout.processName}</div>
                                {step.windowLayout.isMaximized && <div style={{ gridColumn: "span 2", color: "var(--gold)" }}><strong>状态:</strong> 启动后自动最大化</div>}
                                <div style={{ gridColumn: "span 2", display: "flex", alignItems: "center", gap: "6px", margin: "2px 0" }}>
                                  <input 
                                    type="checkbox" 
                                    id={`always-on-top-${step.id}`}
                                    checked={step.windowLayout.alwaysOnTop === true}
                                    onChange={(e) => {
                                      const nextLayout = { ...step.windowLayout, alwaysOnTop: e.target.checked };
                                      handleUpdateStep(step.id, { windowLayout: nextLayout as any });
                                    }}
                                    style={{ cursor: "pointer", accentColor: "var(--gold)", width: "13px", height: "13px" }}
                                  />
                                  <label htmlFor={`always-on-top-${step.id}`} style={{ margin: 0, cursor: "pointer", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                                    启动后置于顶层 (始终置顶)
                                  </label>
                                </div>
                                <div style={{ gridColumn: "span 2", fontSize: "0.68rem", color: "var(--muted)" }}>捕获时间: {new Date(step.windowLayout.capturedAt).toLocaleString()}</div>
                              </div>
                            ) : (
                              <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                                尚未关联窗口位置。启动工作区时将以默认大小和位置启动该程序。
                              </div>
                            )}
                          </div>
                        )}

                        {(step.type === "script" || step.type === "wait") && (
                          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)", width: "200px" }}>
                            <div className="step-input" style={{ width: "100%" }}>
                              <label>失败策略</label>
                              <select
                                value={step.failurePolicy || "continue"}
                                onChange={(e) => handleUpdateStep(step.id, { failurePolicy: e.target.value as any })}
                              >
                                <option value="continue">失败后继续</option>
                                <option value="stop">失败后停止</option>
                              </select>
                            </div>
                          </div>
                        )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                    </div>
                  )}

                  {editorViewMode === "list" && (
                    <div className="steps-list-table" style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-md)", overflow: "hidden", marginTop: "var(--space-3)" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", textAlign: "left" }}>
                        <thead>
                          <tr style={{ background: "var(--surface-3)", borderBottom: "1px solid var(--line)", color: "var(--text-muted)" }}>
                            <th style={{ padding: "10px 12px", width: "40px" }}>#</th>
                            <th style={{ padding: "10px 12px" }}>标题</th>
                            <th style={{ padding: "10px 12px", width: "100px" }}>类型</th>
                            <th style={{ padding: "10px 12px" }}>自定义目标 / 网址 / 脚本</th>
                            <th style={{ padding: "10px 12px", width: "90px" }}>延迟 (ms)</th>
                            <th style={{ padding: "10px 12px", width: "100px" }}>置顶状态</th>
                            <th style={{ padding: "10px 12px", width: "120px", textAlign: "right" }}>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {editingSteps.map((step, index) => (
                            <tr key={step.id} style={{ borderBottom: "1px solid var(--line)", color: "var(--text)" }}>
                              <td style={{ padding: "10px 12px", color: "var(--text-muted)" }}>{index + 1}</td>
                              <td style={{ padding: "10px 12px", fontWeight: "bold" }}>{step.title}</td>
                              <td style={{ padding: "10px 12px" }}>
                                <span className="type-tag" style={{ fontSize: "0.7rem", padding: "2px 6px", borderRadius: "4px", background: "var(--surface-3)", color: "var(--text-muted)" }}>
                                  {step.type === "item" ? "已存资源" :
                                   step.type === "app" ? "应用" :
                                   step.type === "website" ? "网站" :
                                   step.type === "folder" ? "文件夹" :
                                   step.type === "file" ? "文件" :
                                   step.type === "script" ? "脚本" :
                                   step.type === "wait" ? "等待" : "未知"}
                                </span>
                              </td>
                              <td style={{ padding: "10px 12px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "250px" }}>
                                {step.type === "script" ? (step.scriptConfig?.useFile ? step.scriptConfig.filePath : "在线脚本内容") : step.target}
                              </td>
                              <td style={{ padding: "10px 12px" }}>{step.delayMs || 0}</td>
                              <td style={{ padding: "10px 12px" }}>
                                {step.windowLayout?.alwaysOnTop ? (
                                  <span style={{ color: "var(--gold)" }}>始终置顶</span>
                                ) : (
                                  <span style={{ color: "var(--text-muted)" }}>-</span>
                                )}
                              </td>
                              <td style={{ padding: "10px 12px", textAlign: "right" }}>
                                <div style={{ display: "inline-flex", gap: "8px" }}>
                                  <button 
                                    type="button" 
                                    className="icon-button"
                                    onClick={() => {
                                      setExpandedStepIds([...expandedStepIds, step.id]);
                                      setEditorViewMode("card");
                                    }}
                                    title="在卡片模式下展开编辑"
                                  >
                                    <Edit3 size={14} />
                                  </button>
                                  <button 
                                    type="button" 
                                    className="icon-button text-danger"
                                    onClick={() => handleDeleteStep(step.id)}
                                    title="删除"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {editorViewMode === "graph" && (() => {
                    const { nodes, edges } = getGraphLayout();
                    const selectedNode = nodes.find(n => n.id === selectedNodeId);
                    const selectedStep = selectedNode?.step;
                    
                    const xs = nodes.map(n => n.x);
                    const ys = nodes.map(n => n.y);
                    const minX = xs.length ? Math.min(...xs) - 100 : -100;
                    const maxX = xs.length ? Math.max(...xs) + 100 : 100;
                    const minY = ys.length ? Math.min(...ys) - 50 : -50;
                    const maxY = ys.length ? Math.max(...ys) + 100 : 200;
                    const boundaryW = maxX - minX;
                    const boundaryH = maxY - minY;

                    return (
                      <div 
                        className={`graph-canvas-container ${isGraphFullscreen ? "fullscreen-graph" : ""}`}
                        style={isGraphFullscreen ? {
                          position: "fixed",
                          left: 0,
                          top: 0,
                          width: "100vw",
                          height: "100vh",
                          zIndex: 9999,
                          background: "var(--bg-deep)",
                          padding: "24px",
                          display: "flex",
                          flexDirection: "column"
                        } : {
                          position: "relative",
                          width: "100%",
                          height: "540px",
                          background: "var(--bg-deep)",
                          borderRadius: "12px",
                          border: "1px solid var(--line-strong)",
                          overflow: "hidden",
                          marginTop: "var(--space-3)"
                        }}
                      >
                        {isGraphFullscreen && (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexShrink: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <Workflow size={20} style={{ color: "var(--gold)" }} />
                              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>{editingWorkspace?.name} - 拓扑图形编排模式</h3>
                            </div>
                            <button 
                              type="button" 
                              className="secondary-action compact-action" 
                              onClick={() => setIsGraphFullscreen(false)}
                            >
                              <X size={16} /> 退出全屏
                            </button>
                          </div>
                        )}

                        <div 
                          className="graph-viewport"
                          ref={graphViewportRef}
                          onMouseDown={handleGraphMouseDown}
                          onMouseMove={handleGraphMouseMove}
                          onMouseUp={handleGraphMouseUp}
                          onMouseLeave={handleGraphMouseUp}
                          style={{
                            position: "relative",
                            width: "100%",
                            height: "100%",
                            flexGrow: 1,
                            overflow: "hidden",
                            cursor: isGraphDragging ? "grabbing" : "grab",
                            background: "radial-gradient(var(--graph-dot, color-mix(in srgb, var(--text) 8%, transparent)) 1px, transparent 0)",
                            backgroundSize: "24px 24px"
                          }}
                        >
                          <div 
                            style={{
                              transform: `translate(${graphPanOffset.x}px, ${graphPanOffset.y}px) scale(${graphZoomLevel})`,
                              transformOrigin: "0 0",
                              width: "100%",
                              height: "100%",
                              position: "absolute",
                              left: 0,
                              top: 0,
                              pointerEvents: "none"
                            }}
                          >
                            <div style={{ pointerEvents: "auto", position: "relative", width: "1px", height: "1px" }}>
                              <svg 
                                style={{
                                  position: "absolute",
                                  overflow: "visible",
                                  pointerEvents: "none",
                                  left: 0,
                                  top: 0
                                }}
                              >
                                <defs>
                                  <filter id="glow-connector" x="-20%" y="-20%" width="140%" height="140%">
                                    <feGaussianBlur stdDeviation="3" result="blur" />
                                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                  </filter>
                                </defs>
                                {edges.map(edge => {
                                  const fromY = edge.py + (edge.fromId === "ROOT" ? 33 : 31);
                                  const toY = edge.cy - 31;
                                  const midY = (fromY + toY) / 2;
                                  const pathD = `M ${edge.px} ${fromY} C ${edge.px} ${midY}, ${edge.cx} ${midY}, ${edge.cx} ${toY}`;
                                  
                                  return (
                                    <g key={edge.id}>
                                      <path 
                                        d={pathD}
                                        fill="none"
                                        stroke={editingWorkspace?.color || "var(--accent, var(--gold))"}
                                        strokeWidth={4}
                                        style={{ opacity: 0.15, filter: "url(#glow-connector)" }}
                                      />
                                      <path 
                                        d={pathD}
                                        fill="none"
                                        stroke={editingWorkspace?.color || "var(--accent, var(--gold))"}
                                        strokeWidth={1.5}
                                        style={{ opacity: 0.8 }}
                                      />
                                      <rect 
                                        x={edge.px - 3} 
                                        y={fromY - 3} 
                                        width={6} 
                                        height={6} 
                                        fill="var(--surface)"
                                        stroke={editingWorkspace?.color || "var(--accent, var(--gold))"}
                                        strokeWidth={1}
                                        transform={`rotate(45 ${edge.px} ${fromY})`}
                                      />
                                      <rect 
                                        x={edge.cx - 3.5} 
                                        y={toY - 3.5} 
                                        width={7} 
                                        height={7} 
                                        fill={editingWorkspace?.color || "var(--accent, var(--gold))"}
                                        stroke="var(--surface)"
                                        strokeWidth={1.2}
                                        transform={`rotate(45 ${edge.cx} ${toY})`}
                                      />
                                    </g>
                                  );
                                })}
                              </svg>

                              {nodes.map(node => {
                                const isRoot = node.id === "ROOT";
                                const isSelected = node.id === selectedNodeId;
                                const stepColor = node.step?.color || (
                                  node.type === "app" ? "#37d6bf" :
                                  node.type === "website" ? "#5cc8ff" :
                                  node.type === "folder" ? "#f6b95b" :
                                  node.type === "script" ? "#bf5cff" :
                                  node.type === "wait" ? "#a0aec0" : "var(--gold)"
                                );

                                if (isRoot) {
                                  return (
                                    <div 
                                      key={node.id}
                                      onClick={() => setSelectedNodeId(null)}
                                      onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
                                      style={{
                                        position: "absolute",
                                        left: `${node.x - 90}px`,
                                        top: `${node.y - 33}px`,
                                        width: "180px",
                                        height: "66px",
                                        borderRadius: "10px",
                                        background: "var(--surface-3, var(--surface))",
                                        border: "2px solid var(--accent, var(--gold))",
                                        boxShadow: "var(--shadow-card)",
                                        display: "flex",
                                        flexDirection: "column",
                                        justifyContent: "center",
                                        alignItems: "center",
                                        gap: "2px",
                                        cursor: "pointer",
                                        zIndex: 5
                                      }}
                                    >
                                      <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--accent, var(--gold))" }}>
                                        <Workflow size={14} />
                                        <span style={{ fontWeight: "bold", fontSize: "0.85rem", letterSpacing: "1px" }}>启动工作区</span>
                                      </div>
                                      <span style={{ fontSize: "0.65rem", color: "var(--accent, var(--gold))", opacity: 0.8 }}>根节点</span>
                                    </div>
                                  );
                                }

                                return (
                                  <div 
                                    key={node.id}
                                    onClick={() => setSelectedNodeId(node.id)}
                                    onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
                                    style={{
                                      position: "absolute",
                                      left: `${node.x - 77}px`,
                                      top: `${node.y - 31}px`,
                                      width: "155px",
                                      height: "62px",
                                      borderRadius: "8px",
                                      background: "var(--surface)",
                                      border: isSelected ? `2px solid ${stepColor}` : "1px solid var(--line-strong)",
                                      boxShadow: isSelected 
                                        ? `0 0 14px ${stepColor}40`
                                        : "var(--shadow-card)",
                                      display: "flex",
                                      alignItems: "center",
                                      padding: "8px",
                                      gap: "8px",
                                      cursor: "pointer",
                                      zIndex: 4,
                                      transition: "border-color 0.2s, box-shadow 0.2s"
                                    }}
                                  >
                                    <div 
                                      style={{
                                        width: "28px",
                                        height: "28px",
                                        borderRadius: "6px",
                                        background: `${stepColor}15`,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        color: stepColor,
                                        flexShrink: 0
                                      }}
                                    >
                                      {getStepIcon(node.type)}
                                    </div>
                                    
                                    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1 }}>
                                      <span 
                                        style={{ 
                                          fontWeight: "bold", 
                                          fontSize: "0.75rem", 
                                          color: isSelected ? "var(--text-strong)" : "var(--text)", 
                                          overflow: "hidden", 
                                          textOverflow: "ellipsis", 
                                          whiteSpace: "nowrap" 
                                        }}
                                      >
                                        {node.title}
                                      </span>
                                      <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", marginTop: "2px" }}>
                                        {node.type === "item" ? "已存资源" :
                                         node.type === "app" ? "应用" :
                                         node.type === "website" ? "网站" :
                                         node.type === "folder" ? "文件夹" :
                                         node.type === "file" ? "文件" :
                                         node.type === "script" ? "脚本" :
                                         node.type === "wait" ? "等待" : "未知"}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div 
                            className="graph-minimap glass-panel"
                            style={{
                              position: "absolute",
                              left: "12px",
                              bottom: "12px",
                              width: "120px",
                              height: "90px",
                              background: "var(--surface)",
                              border: "1px solid var(--line-strong)",
                              borderRadius: "8px",
                              overflow: "hidden",
                              pointerEvents: "none",
                              zIndex: 10
                            }}
                          >
                            <div 
                              style={{ 
                                position: "relative", 
                                width: "100%", 
                                height: "100%",
                                background: "rgba(255, 255, 255, 0.01)"
                              }}
                            >
                              {nodes.map(node => {
                                const isRoot = node.id === "ROOT";
                                const isSelected = node.id === selectedNodeId;
                                const stepColor = isRoot ? "var(--gold)" : (
                                  node.type === "app" ? "#37d6bf" :
                                  node.type === "website" ? "#5cc8ff" :
                                  node.type === "folder" ? "#f6b95b" :
                                  node.type === "script" ? "#bf5cff" :
                                  node.type === "wait" ? "#a0aec0" : "var(--gold)"
                                );

                                const scaleX = 100 / boundaryW;
                                const scaleY = 70 / boundaryH;
                                const scale = Math.min(scaleX, scaleY);
                                const mapX = (node.x - minX) * scale + 10;
                                const mapY = (node.y - minY) * scale + 10;

                                return (
                                  <div 
                                    key={`map-${node.id}`}
                                    style={{
                                      position: "absolute",
                                      left: `${mapX}px`,
                                      top: `${mapY}px`,
                                      width: isRoot ? "14px" : "10px",
                                      height: isRoot ? "8px" : "6px",
                                      borderRadius: "1px",
                                      background: stepColor,
                                      border: isSelected ? "1px solid #ffffff" : "none",
                                      transform: "translate(-50%, -50%)",
                                      opacity: isSelected ? 1 : 0.6
                                    }}
                                  />
                                );
                              })}
                            </div>
                          </div>

                          <div 
                            className="graph-controls glass-panel"
                            style={{
                              position: "absolute",
                              right: "12px",
                              bottom: "12px",
                              background: "var(--surface)",
                              border: "1px solid var(--line-strong)",
                              borderRadius: "8px",
                              display: "flex",
                              alignItems: "center",
                              padding: "4px 8px",
                              gap: "8px",
                              zIndex: 10,
                              pointerEvents: "auto"
                            }}
                          >
                            <button 
                              type="button" 
                              className="icon-button"
                              title={isGraphLocked ? "解锁画幅编辑" : "锁定画幅编辑"}
                              onClick={() => setIsGraphLocked(!isGraphLocked)}
                              style={{ color: isGraphLocked ? "#ef4444" : "var(--text)" }}
                            >
                              {isGraphLocked ? <X size={14} /> : <Save size={14} />}
                            </button>
                            <div style={{ width: "1px", height: "14px", background: "var(--line)" }} />
                            <button 
                              type="button" 
                              className="icon-button"
                              title="自适应居中"
                              onClick={handleZoomToFit}
                            >
                              <Workflow size={14} />
                            </button>
                            <button 
                              type="button" 
                              className="icon-button"
                              title="缩小"
                              onClick={() => setGraphZoomLevel(Math.max(0.3, graphZoomLevel - 0.1))}
                            >
                              <ArrowDown size={14} />
                            </button>
                            <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", minWidth: "32px", textAlign: "center" }}>
                              {Math.round(graphZoomLevel * 100)}%
                            </span>
                            <button 
                              type="button" 
                              className="icon-button"
                              title="放大"
                              onClick={() => setGraphZoomLevel(Math.min(2.0, graphZoomLevel + 0.1))}
                            >
                              <ArrowUp size={14} />
                            </button>
                          </div>

                          <button 
                            type="button" 
                            className="secondary-action compact-action"
                            onClick={() => setIsGraphFullscreen(!isGraphFullscreen)}
                            style={{
                              position: "absolute",
                              right: selectedNodeId ? "348px" : "12px",
                              top: "12px",
                              zIndex: 11,
                              height: "30px",
                              padding: "0 12px",
                              fontSize: "0.75rem",
                              borderRadius: "6px",
                              background: "var(--surface)",
                              border: "1px solid var(--line-strong)",
                              color: "var(--text)",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              transition: "all 0.15s ease",
                              pointerEvents: "auto"
                            }}
                          >
                            {isGraphFullscreen ? "退出全屏" : "全屏"}
                          </button>

                          {selectedNode && selectedStep && (
                            <div 
                              className="graph-node-details-drawer glass-panel"
                              style={{
                                position: "absolute",
                                right: "12px",
                                top: "12px",
                                bottom: "12px",
                                width: "320px",
                                background: "var(--surface)",
                                border: "1px solid var(--line-strong)",
                                borderRadius: "8px",
                                padding: "16px",
                                zIndex: 12,
                                display: "flex",
                                flexDirection: "column",
                                gap: "12px",
                                boxShadow: "-4px 0 16px rgba(0,0,0,0.12)",
                                pointerEvents: "auto"
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", paddingBottom: "8px" }}>
                                <span style={{ fontWeight: "bold", fontSize: "0.85rem", color: "var(--accent, var(--gold))" }}>步骤节点配置</span>
                                <button 
                                  type="button" 
                                  className="icon-button"
                                  onClick={() => setSelectedNodeId(null)}
                                >
                                  <X size={14} />
                                </button>
                              </div>

                              <div style={{ overflowY: "auto", flexGrow: 1, display: "flex", flexDirection: "column", gap: "12px", paddingRight: "4px" }}>
                                <div className="step-input" style={{ width: "100%" }}>
                                  <label style={{ fontSize: "0.7rem" }}>步骤类型</label>
                                  <select
                                    value={selectedStep.type === "item" ? "item" : (selectedStep.itemId ? "item" : selectedStep.type)}
                                    onChange={(e) => {
                                      const newType = e.target.value as any;
                                      if (newType === "item") {
                                        handleUpdateStep(selectedNode.id, { type: "item", itemId: undefined, title: "未关联资源", target: "" });
                                      } else if (newType === "script") {
                                        handleUpdateStep(selectedNode.id, { 
                                          type: "script", 
                                          itemId: undefined, 
                                          title: "运行脚本", 
                                          target: "",
                                          scriptConfig: { type: "bat", content: "@echo off\necho Hello World", useFile: false, filePath: "" } 
                                        });
                                      } else if (newType === "wait") {
                                        handleUpdateStep(selectedNode.id, { 
                                          type: "wait", 
                                          itemId: undefined, 
                                          title: "等待条件", 
                                          target: "",
                                          waitCondition: { type: "time", value: "5000", timeoutMs: 30000 } 
                                        });
                                      } else {
                                        handleUpdateStep(selectedNode.id, { type: newType, itemId: undefined, title: "", target: "" });
                                      }
                                    }}
                                    style={{ width: "100%", height: "28px", fontSize: "0.75rem", background: "var(--field)", border: "1px solid var(--line)", color: "var(--text)" }}
                                  >
                                    <option value="item">关联已有资源</option>
                                    <option value="app">自定义程序</option>
                                    <option value="website">自定义网址</option>
                                    <option value="folder">自定义文件夹</option>
                                    <option value="file">自定义文件</option>
                                    <option value="script">脚本命令</option>
                                    <option value="wait">条件等待</option>
                                  </select>
                                </div>

                                {(selectedStep.type === "item" || selectedStep.itemId) && (
                                  <div className="step-input" style={{ width: "100%" }}>
                                    <label style={{ fontSize: "0.7rem" }}>关联资源</label>
                                    <button 
                                      type="button" 
                                      className="select-resource-btn"
                                      onClick={() => {
                                        setSelectorStepId(selectedNode.id);
                                        setSelectorSearch("");
                                      }}
                                      style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", height: "30px", background: "var(--surface-3)", border: "1px dashed var(--line)", borderRadius: "var(--radius-sm)", color: "var(--text)", cursor: "pointer", fontSize: "0.75rem" }}
                                    >
                                      {selectedStep.itemId ? (
                                        <>
                                          {getStepIcon(selectedStep.type)}
                                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedStep.title}</span>
                                        </>
                                      ) : (
                                        <>
                                          <Plus size={12} />
                                          <span>选择资源...</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                )}

                                <div className="step-input" style={{ width: "100%" }}>
                                  <label style={{ fontSize: "0.7rem" }}>标题</label>
                                  <input 
                                    type="text"
                                    value={selectedStep.title}
                                    onChange={(e) => handleUpdateStep(selectedNode.id, { title: e.target.value })}
                                    style={{ width: "100%", height: "28px", fontSize: "0.75rem" }}
                                  />
                                </div>

                                <div className="step-input" style={{ width: "100%" }}>
                                  <label style={{ fontSize: "0.7rem" }}>依赖前驱节点 (决定连接关系)</label>
                                  <select
                                    value={selectedStep.dependsOn && selectedStep.dependsOn[0] ? selectedStep.dependsOn[0] : "ROOT"}
                                    onChange={(e) => {
                                      const parentId = e.target.value;
                                      if (parentId === "ROOT") {
                                        handleUpdateStep(selectedNode.id, { dependsOn: [] });
                                      } else {
                                        handleUpdateStep(selectedNode.id, { dependsOn: [parentId] });
                                      }
                                    }}
                                    style={{ width: "100%", height: "28px", fontSize: "0.75rem", background: "var(--field)", border: "1px solid var(--line)", color: "var(--text)" }}
                                  >
                                    <option value="ROOT">启动工作区 (根节点)</option>
                                    {editingSteps
                                      .filter(s => s.id !== selectedNode.id)
                                      .map((s, sIdx) => (
                                        <option key={s.id} value={s.id}>
                                          步骤 {sIdx + 1}: {s.title}
                                        </option>
                                      ))}
                                  </select>
                                </div>

                                {selectedStep.type !== "item" && selectedStep.type !== "script" && selectedStep.type !== "wait" && (
                                  <div className="step-input" style={{ width: "100%" }}>
                                    <label style={{ fontSize: "0.7rem" }}>
                                      {selectedStep.type === "website" ? "网页网址" : "目标路径"}
                                    </label>
                                    <div style={{ display: "flex", gap: "4px", width: "100%" }}>
                                      <input 
                                        type="text"
                                        value={selectedStep.target}
                                        onChange={(e) => handleUpdateStep(selectedNode.id, { target: e.target.value })}
                                        placeholder={selectedStep.type === "website" ? "https://..." : "C:\\path\\to\\..."}
                                        style={{ flexGrow: 1, height: "28px", fontSize: "0.75rem" }}
                                      />
                                      {selectedStep.type === "folder" && (
                                        <button
                                          type="button"
                                          style={{ padding: "0 8px", background: "var(--surface-3)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", height: "28px", cursor: "pointer" }}
                                          onClick={async () => {
                                            const picked = await handlePickFolder();
                                            if (picked) handleUpdateStep(selectedNode.id, { target: picked });
                                          }}
                                        >
                                          <FolderOpen size={14} />
                                        </button>
                                      )}
                                      {(selectedStep.type === "app" || selectedStep.type === "file") && (
                                        <button
                                          type="button"
                                          style={{ padding: "0 8px", background: "var(--surface-3)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", height: "28px", cursor: "pointer" }}
                                          onClick={async () => {
                                            const picked = await handlePickFile();
                                            if (picked) handleUpdateStep(selectedNode.id, { target: picked });
                                          }}
                                        >
                                          <FileText size={14} />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {(selectedStep.type === "app" || selectedStep.type === "file") && (
                                  <div className="step-input" style={{ width: "100%" }}>
                                    <label style={{ fontSize: "0.7rem" }}>启动参数</label>
                                    <input 
                                      type="text"
                                      value={selectedStep.arguments || ""}
                                      onChange={(e) => handleUpdateStep(selectedNode.id, { arguments: e.target.value })}
                                      placeholder="例如: --nosplash --host=127.0.0.1"
                                      style={{ width: "100%", height: "28px", fontSize: "0.75rem" }}
                                    />
                                  </div>
                                )}

                                {selectedStep.type === "app" && (
                                  <div className="step-input" style={{ width: "100%" }}>
                                    <label style={{ fontSize: "0.7rem" }}>工作目录</label>
                                    <div style={{ display: "flex", gap: "4px", width: "100%" }}>
                                      <input 
                                        type="text"
                                        value={selectedStep.workingDirectory || ""}
                                        onChange={(e) => handleUpdateStep(selectedNode.id, { workingDirectory: e.target.value })}
                                        placeholder="默认与程序同目录"
                                        style={{ flexGrow: 1, height: "28px", fontSize: "0.75rem" }}
                                      />
                                      <button
                                        type="button"
                                        style={{ padding: "0 8px", background: "var(--surface-3)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", height: "28px", cursor: "pointer" }}
                                        onClick={async () => {
                                          const picked = await handlePickFolder();
                                          if (picked) handleUpdateStep(selectedNode.id, { workingDirectory: picked });
                                        }}
                                      >
                                        <FolderOpen size={14} />
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {selectedStep.type === "script" && (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%", background: "rgba(255,255,255,0.02)", padding: "8px", borderRadius: "6px", border: "1px solid var(--line)" }}>
                                    <div className="step-input" style={{ width: "100%" }}>
                                      <label style={{ fontSize: "0.7rem" }}>脚本类型</label>
                                      <select
                                        value={selectedStep.scriptConfig?.type || "bat"}
                                        onChange={(e) => handleUpdateStep(selectedNode.id, { 
                                          scriptConfig: { ...(selectedStep.scriptConfig || { content: "", useFile: false, filePath: "" }), type: e.target.value as any }
                                        })}
                                        style={{ width: "100%", height: "28px", fontSize: "0.75rem", background: "var(--field)", border: "1px solid var(--line)", color: "var(--text)" }}
                                      >
                                        <option value="bat">Batch (.bat/.cmd)</option>
                                        <option value="ps1">PowerShell (.ps1)</option>
                                      </select>
                                    </div>

                                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                      <label className="toggle-label" style={{ fontSize: "0.72rem", display: "flex", alignItems: "center", gap: "4px" }}>
                                        <input
                                          type="radio"
                                          name={`script-source-drawer-${selectedNode.id}`}
                                          checked={!selectedStep.scriptConfig?.useFile}
                                          onChange={() => handleUpdateStep(selectedNode.id, { 
                                            scriptConfig: { ...(selectedStep.scriptConfig || { type: "bat", content: "", filePath: "" }), useFile: false }
                                          })}
                                        />
                                        在线编写脚本
                                      </label>
                                      <label className="toggle-label" style={{ fontSize: "0.72rem", display: "flex", alignItems: "center", gap: "4px" }}>
                                        <input
                                          type="radio"
                                          name={`script-source-drawer-${selectedNode.id}`}
                                          checked={selectedStep.scriptConfig?.useFile === true}
                                          onChange={() => handleUpdateStep(selectedNode.id, { 
                                            scriptConfig: { ...(selectedStep.scriptConfig || { type: "bat", content: "", filePath: "" }), useFile: true }
                                          })}
                                        />
                                        执行本地脚本文件
                                      </label>
                                    </div>

                                    {!selectedStep.scriptConfig?.useFile ? (
                                      <div className="step-input" style={{ width: "100%" }}>
                                        <label style={{ fontSize: "0.7rem" }}>脚本内容</label>
                                        <textarea
                                          value={selectedStep.scriptConfig?.content || ""}
                                          onChange={(e) => handleUpdateStep(selectedNode.id, { 
                                            scriptConfig: { ...(selectedStep.scriptConfig || { type: "bat", useFile: false, filePath: "" }), content: e.target.value }
                                          })}
                                          placeholder={selectedStep.scriptConfig?.type === "ps1" ? "PowerShell script..." : "Batch script..."}
                                          rows={4}
                                          style={{ width: "100%", background: "var(--field)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", color: "var(--text)", padding: "6px", fontFamily: "monospace", fontSize: "0.75rem" }}
                                        />
                                      </div>
                                    ) : (
                                      <div className="step-input" style={{ width: "100%" }}>
                                        <label style={{ fontSize: "0.7rem" }}>脚本文件路径</label>
                                        <div style={{ display: "flex", gap: "4px", width: "100%" }}>
                                          <input
                                            type="text"
                                            value={selectedStep.scriptConfig?.filePath || ""}
                                            onChange={(e) => handleUpdateStep(selectedNode.id, { 
                                              scriptConfig: { ...(selectedStep.scriptConfig || { type: "bat", useFile: true, content: "" }), filePath: e.target.value }
                                            })}
                                            placeholder="C:\path\to\script"
                                            style={{ flexGrow: 1, height: "28px", fontSize: "0.75rem" }}
                                          />
                                          <button
                                            type="button"
                                            style={{ padding: "0 8px", background: "var(--surface-3)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", height: "28px", cursor: "pointer" }}
                                            onClick={async () => {
                                              const picked = await handlePickFile();
                                              if (picked) {
                                                handleUpdateStep(selectedNode.id, { 
                                                  scriptConfig: { ...(selectedStep.scriptConfig || { type: "bat", useFile: true, content: "" }), filePath: picked }
                                                });
                                              }
                                            }}
                                          >
                                            <FileText size={14} />
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {selectedStep.type === "wait" && (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%", background: "rgba(255,255,255,0.02)", padding: "8px", borderRadius: "6px", border: "1px solid var(--line)" }}>
                                    <div className="step-input" style={{ width: "100%" }}>
                                      <label style={{ fontSize: "0.7rem" }}>等待类型</label>
                                      <select
                                        value={selectedStep.waitCondition?.type || "time"}
                                        onChange={(e) => handleUpdateStep(selectedNode.id, { 
                                          waitCondition: { ...(selectedStep.waitCondition || { value: "", timeoutMs: 30000 }), type: e.target.value as any }
                                        })}
                                        style={{ width: "100%", height: "28px", fontSize: "0.75rem", background: "var(--field)", border: "1px solid var(--line)", color: "var(--text)" }}
                                      >
                                        <option value="time">指定时间 (延迟等待)</option>
                                        <option value="process_start">进程启动 (等待软件打开)</option>
                                        <option value="process_stop">进程退出 (等待软件关闭)</option>
                                        <option value="port">端口开放 (等待TCP服务就绪)</option>
                                      </select>
                                    </div>

                                    <div className="step-input" style={{ width: "100%" }}>
                                      <label style={{ fontSize: "0.7rem" }}>
                                        {selectedStep.waitCondition?.type === "time" ? "等待时间 (毫秒)" :
                                         selectedStep.waitCondition?.type === "port" ? "端口号 (或 host:port)" : "进程名 (例如: chrome.exe)"}
                                      </label>
                                      <input
                                        type="text"
                                        value={selectedStep.waitCondition?.value || ""}
                                        onChange={(e) => handleUpdateStep(selectedNode.id, { 
                                          waitCondition: { ...(selectedStep.waitCondition || { type: "time", timeoutMs: 30000 }), value: e.target.value }
                                        })}
                                        placeholder={selectedStep.waitCondition?.type === "time" ? "3000" :
                                                     selectedStep.waitCondition?.type === "port" ? "8080" : "app.exe"}
                                        style={{ width: "100%", height: "28px", fontSize: "0.75rem" }}
                                      />
                                    </div>

                                    {selectedStep.waitCondition?.type !== "time" && (
                                      <div className="step-input" style={{ width: "100%" }}>
                                        <label style={{ fontSize: "0.7rem" }}>超时时间 (毫秒)</label>
                                        <input
                                          type="number"
                                          value={selectedStep.waitCondition?.timeoutMs || 30000}
                                          onChange={(e) => handleUpdateStep(selectedNode.id, { 
                                            waitCondition: { ...(selectedStep.waitCondition || { type: "process_start", value: "" }), timeoutMs: parseInt(e.target.value) || 30000 }
                                          })}
                                          style={{ width: "100%", height: "28px", fontSize: "0.75rem" }}
                                        />
                                      </div>
                                    )}
                                  </div>
                                )}

                                {selectedStep.type !== "wait" && (
                                  <div className="step-input" style={{ width: "100%" }}>
                                    <label style={{ fontSize: "0.7rem" }}>失败策略</label>
                                    <select
                                      value={selectedStep.failurePolicy || "continue"}
                                      onChange={(e) => handleUpdateStep(selectedNode.id, { failurePolicy: e.target.value as any })}
                                      style={{ width: "100%", height: "28px", fontSize: "0.75rem", background: "var(--field)", border: "1px solid var(--line)", color: "var(--text)" }}
                                    >
                                      <option value="continue">失败后继续</option>
                                      <option value="stop">失败后停止</option>
                                    </select>
                                  </div>
                                )}

                                <div className="step-input" style={{ width: "100%" }}>
                                  <label style={{ fontSize: "0.7rem" }}>启动后延迟 (毫秒)</label>
                                  <input 
                                    type="number"
                                    min="0"
                                    step="100"
                                    value={selectedStep.delayMs || 0}
                                    onChange={(e) => handleUpdateStep(selectedNode.id, { delayMs: parseInt(e.target.value) || 0 })}
                                    style={{ width: "100%", height: "28px", fontSize: "0.75rem" }}
                                  />
                                </div>

                                {selectedStep.type !== "script" && selectedStep.type !== "wait" && (
                                  <div className="step-window-layout-config" style={{ marginTop: "4px", width: "100%", background: "var(--surface-3)", padding: "10px", borderRadius: "var(--radius-sm)", border: "1px dashed var(--line)", display: "flex", flexDirection: "column", gap: "6px", pointerEvents: "auto" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                      <label style={{ fontSize: "0.7rem", fontWeight: "bold", color: "var(--gold)", display: "flex", alignItems: "center", gap: "4px" }}>
                                        <AppWindow size={12} /> 窗口位置布局保存
                                      </label>
                                      {selectedStep.windowLayout ? (
                                        <button 
                                          type="button" 
                                          className="text-action compact-action" 
                                          style={{ fontSize: "0.7rem", color: "#ef4444", border: "none", background: "none", cursor: "pointer", padding: 0 }}
                                          onClick={() => handleUpdateStep(selectedNode.id, { windowLayout: undefined })}
                                        >
                                          清除位置
                                        </button>
                                      ) : (
                                        <button 
                                          type="button" 
                                          className="text-action compact-action" 
                                          style={{ fontSize: "0.7rem", color: "var(--gold)", border: "none", background: "none", cursor: "pointer", padding: 0 }}
                                          onClick={() => handleCaptureSingleStepLayout(selectedNode.id)}
                                        >
                                          捕获当前位置
                                        </button>
                                      )}
                                    </div>
                                    {selectedStep.windowLayout ? (
                                      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: "3px" }}>
                                        <div><strong>坐标 (X, Y):</strong> ({selectedStep.windowLayout.x}, {selectedStep.windowLayout.y})</div>
                                        <div><strong>尺寸 (W x H):</strong> {selectedStep.windowLayout.width} x {selectedStep.windowLayout.height}</div>
                                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><strong>进程名:</strong> {selectedStep.windowLayout.processName}</div>
                                        {selectedStep.windowLayout.isMaximized && <div style={{ color: "var(--gold)" }}><strong>状态:</strong> 自动最大化</div>}
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                                          <input 
                                            type="checkbox" 
                                            id={`always-on-top-drawer-${selectedStep.id}`}
                                            checked={selectedStep.windowLayout.alwaysOnTop === true}
                                            onChange={(e) => {
                                              const nextLayout = { ...selectedStep.windowLayout, alwaysOnTop: e.target.checked };
                                              handleUpdateStep(selectedNode.id, { windowLayout: nextLayout as any });
                                            }}
                                            style={{ cursor: "pointer", accentColor: "var(--gold)", width: "12px", height: "12px" }}
                                          />
                                          <label htmlFor={`always-on-top-drawer-${selectedStep.id}`} style={{ margin: 0, cursor: "pointer", fontSize: "0.7rem" }}>窗口始终置顶</label>
                                        </div>
                                      </div>
                                    ) : (
                                      <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>未绑定窗口位置。</span>
                                    )}
                                  </div>
                                )}
                              </div>

                              <div style={{ borderTop: "1px solid var(--line)", paddingTop: "8px", display: "flex", gap: "6px" }}>
                                <button 
                                  type="button" 
                                  className="secondary-action compact-action"
                                  onClick={() => {
                                    setExpandedStepIds([...expandedStepIds, selectedNode.id]);
                                    setEditorViewMode("card");
                                    setSelectedNodeId(null);
                                  }}
                                  style={{ flexGrow: 1, height: "28px", fontSize: "0.75rem" }}
                                >
                                  卡片高级配置
                                </button>
                                <button 
                                  type="button" 
                                  className="secondary-action compact-action danger-action"
                                  onClick={() => {
                                    handleDeleteStep(selectedNode.id);
                                    setSelectedNodeId(null);
                                  }}
                                  style={{ height: "28px", width: "28px", padding: 0 }}
                                  title="删除步骤"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>

            <div className="editor-footer">
              <button className="secondary-action" onClick={() => setEditingWorkspace(null)}>
                取消
              </button>
              <button className="primary-action" onClick={handleSaveEdit}>
                <Save size={16} /> 保存工作区
              </button>
            </div>
          </div>
        </div>
      ) : (
        <WorkspaceListView
          workspaces={workspaces}
          steps={steps}
          launchingId={launchingId}
          onCreateWorkspace={handleCreateWorkspace}
          onOpenLogs={() => setShowLogsModal(true)}
          onLaunch={handleLaunch}
          onEdit={handleEditWorkspace}
          onDelete={handleDeleteWorkspace}
          onContextMenu={(event, workspace) => {
            event.preventDefault();
            event.stopPropagation();
            setWorkspaceContextMenu({ x: event.clientX, y: event.clientY, workspace });
          }}
        />
      )}

      <ResourceSelectorModal
        selectorStepId={selectorStepId}
        selectorSearch={selectorSearch}
        items={items}
        onClose={() => setSelectorStepId(null)}
        onSearchChange={setSelectorSearch}
        onUpdateStep={handleUpdateStep}
        getStepIcon={getStepIcon}
      />
      <DeleteWorkspaceDialog
        workspace={deleteConfirmId ? workspaces.find((workspace) => workspace.id === deleteConfirmId) || null : null}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={(workspaceId) => {
          invoke("update_workspace_hotkey", { workspaceId, newHotkey: null }).catch((error) => {
            console.error("Failed to unregister hotkey on delete", error);
          });
          saveAllData(
            workspaces.filter((workspace) => workspace.id !== workspaceId),
            steps.filter((step) => step.workspaceId !== workspaceId)
          );
          setDeleteConfirmId(null);
        }}
        getWorkspaceIcon={getWorkspaceIcon}
      />
      <LaunchLogsDialog
        isOpen={showLogsModal}
        launchLogs={launchLogs}
        onClose={() => setShowLogsModal(false)}
        onClear={() => {
          localStorage.removeItem(STORAGE_KEY_LOGS);
          setLaunchLogs([]);
        }}
      />
      <WindowLayoutImportDialog
        isOpen={scanLayoutModalOpen}
        scannedWindows={scannedWindows}
        selectedWindowIndices={selectedWindowIndices}
        windowBindings={windowBindings}
        editingSteps={editingSteps}
        onClose={() => setScanLayoutModalOpen(false)}
        onSelectedWindowIndicesChange={setSelectedWindowIndices}
        onWindowBindingsChange={setWindowBindings}
        onImport={handleImportScannedLayouts}
      />
      <ThemedAlertDialog alert={themedAlert} onClose={() => setThemedAlert(null)} />

      <WorkspaceContextMenus
        workspaceContextMenu={workspaceContextMenu}
        nodeContextMenu={nodeContextMenu}
        copiedStep={copiedStep}
        onCloseWorkspaceContextMenu={() => setWorkspaceContextMenu(null)}
        onCloseNodeContextMenu={() => setNodeContextMenu(null)}
        onLaunchWorkspace={handleLaunch}
        onEditWorkspace={handleEditWorkspace}
        onDeleteWorkspace={handleDeleteWorkspace}
        onAddStep={handleAddStep}
        onPasteNodeAfter={handlePasteNodeAfter}
        onCopyNode={handleCopyNode}
        onReplaceNode={handleReplaceNode}
        onSelectNode={setSelectedNodeId}
        onDeleteNode={(nodeId) => {
          handleDeleteStep(nodeId);
          if (selectedNodeId === nodeId) {
            setSelectedNodeId(null);
          }
        }}
      />
    </div>
  );
}
