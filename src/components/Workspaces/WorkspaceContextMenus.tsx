import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Clipboard, Copy, Edit3, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { AnimatePresence, m, useIsPresent } from "motion/react";
import { motionVariants, useMotionPolicy, useMotionTransition } from "../../motion";
import type { NodeContextMenu, WorkspaceContextMenu, WorkspaceStep } from "./types";

interface WorkspaceContextMenusProps {
  workspaceContextMenu: WorkspaceContextMenu | null;
  nodeContextMenu: NodeContextMenu | null;
  copiedStep: Partial<WorkspaceStep> | null;
  onCloseWorkspaceContextMenu: () => void;
  onCloseNodeContextMenu: () => void;
  onLaunchWorkspace: (workspace: WorkspaceContextMenu["workspace"]) => void;
  onEditWorkspace: (workspace: WorkspaceContextMenu["workspace"]) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onAddStep: (parentId?: string) => void;
  onPasteNodeAfter: (targetStepId: string) => void;
  onCopyNode: (stepId: string) => void;
  onReplaceNode: (targetStepId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
}

const menuStyle = (x: number, y: number, minWidth: string): CSSProperties => ({
  position: "fixed",
  left: `${x}px`,
  top: `${y}px`,
  zIndex: 99999,
  padding: "4px",
  minWidth,
  background: "var(--surface)",
  backdropFilter: "blur(12px)",
  border: "1px solid var(--line-strong)",
  borderRadius: "var(--radius-md)",
  boxShadow: "0 10px 25px -5px rgba(0,0,0,0.15), 0 0 0 1px rgba(255,255,255,0.05)",
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  transformOrigin: "top left"
});

const menuItemStyle = (padding: string, danger = false): CSSProperties => ({
  background: "none",
  border: "none",
  color: danger ? "var(--danger)" : "var(--text)",
  padding,
  fontSize: "0.82rem",
  textAlign: "left",
  cursor: "pointer",
  borderRadius: "var(--radius-sm)",
  display: "flex",
  alignItems: "center",
  gap: "8px",
  width: "100%",
  transition: "background var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard)"
});

interface ContextMenuActionProps {
  children: ReactNode;
  onClick: () => void;
  padding: string;
  danger?: boolean;
}

function ContextMenuAction({ children, onClick, padding, danger = false }: ContextMenuActionProps) {
  return (
    <button
      type="button"
      className={danger ? "contextmenu-item text-danger" : "contextmenu-item"}
      style={menuItemStyle(padding, danger)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ContextMenuSurface({
  children,
  x,
  y,
  minWidth,
  kind
}: {
  children: ReactNode;
  x: number;
  y: number;
  minWidth: string;
  kind: "workspace" | "node";
}) {
  const transition = useMotionTransition("context");
  const exitTransition = useMotionTransition("contextExit");
  const { transformsEnabled } = useMotionPolicy();
  const isPresent = useIsPresent();
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    if (isPresent) menu.removeAttribute("inert");
    else menu.setAttribute("inert", "");
  }, [isPresent]);

  return (
    <m.div
      ref={menuRef}
      className="workspace-custom-contextmenu glass-panel"
      style={{
        ...menuStyle(x, y, minWidth),
        pointerEvents: isPresent ? "auto" : "none"
      }}
      variants={transformsEnabled ? motionVariants.contextMenu : motionVariants.fade}
      initial="hidden"
      animate="visible"
      exit={{ opacity: 0, transition: exitTransition }}
      transition={transition}
      data-motion-context-menu={kind}
      data-presence={isPresent ? "present" : "exiting"}
      aria-hidden={!isPresent}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </m.div>
  );
}

export function WorkspaceContextMenus({
  workspaceContextMenu,
  nodeContextMenu,
  copiedStep,
  onCloseWorkspaceContextMenu,
  onCloseNodeContextMenu,
  onLaunchWorkspace,
  onEditWorkspace,
  onDeleteWorkspace,
  onAddStep,
  onPasteNodeAfter,
  onCopyNode,
  onReplaceNode,
  onSelectNode,
  onDeleteNode
}: WorkspaceContextMenusProps) {
  return (
    <>
      <AnimatePresence initial={false}>
      {workspaceContextMenu && (
        <ContextMenuSurface
          key={`workspace-${workspaceContextMenu.workspace.id}`}
          x={workspaceContextMenu.x}
          y={workspaceContextMenu.y}
          minWidth="130px"
          kind="workspace"
        >
          <ContextMenuAction
            padding="6px 12px"
            onClick={() => {
              onLaunchWorkspace(workspaceContextMenu.workspace);
              onCloseWorkspaceContextMenu();
            }}
          >
            <Play size={14} style={{ color: "var(--gold)" }} />
            <span>启动工作区</span>
          </ContextMenuAction>
          <ContextMenuAction
            padding="6px 12px"
            onClick={() => {
              onEditWorkspace(workspaceContextMenu.workspace);
              onCloseWorkspaceContextMenu();
            }}
          >
            <Edit3 size={14} />
            <span>编辑工作区</span>
          </ContextMenuAction>
          <div style={{ height: "1px", background: "var(--line)", margin: "4px 0" }} />
          <ContextMenuAction
            padding="6px 12px"
            danger
            onClick={() => {
              onDeleteWorkspace(workspaceContextMenu.workspace.id);
              onCloseWorkspaceContextMenu();
            }}
          >
            <Trash2 size={14} />
            <span>删除工作区</span>
          </ContextMenuAction>
        </ContextMenuSurface>
      )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
      {nodeContextMenu && (
        <ContextMenuSurface
          key={`node-${nodeContextMenu.nodeId}`}
          x={nodeContextMenu.x}
          y={nodeContextMenu.y}
          minWidth="120px"
          kind="node"
        >
          <ContextMenuAction
            padding="8px 12px"
            onClick={() => {
              onAddStep(nodeContextMenu.nodeId === "ROOT" ? undefined : nodeContextMenu.nodeId);
              onCloseNodeContextMenu();
            }}
          >
            <Plus size={14} /> 增加节点
          </ContextMenuAction>

          {copiedStep && (
            <ContextMenuAction
              padding="8px 12px"
              onClick={() => {
                onPasteNodeAfter(nodeContextMenu.nodeId);
                onCloseNodeContextMenu();
              }}
            >
              <Clipboard size={14} /> 粘贴节点
            </ContextMenuAction>
          )}

          {nodeContextMenu.nodeId !== "ROOT" && (
            <>
              <ContextMenuAction
                padding="8px 12px"
                onClick={() => {
                  onCopyNode(nodeContextMenu.nodeId);
                  onCloseNodeContextMenu();
                }}
              >
                <Copy size={14} /> 复制节点
              </ContextMenuAction>

              {copiedStep && (
                <ContextMenuAction
                  padding="8px 12px"
                  onClick={() => {
                    onReplaceNode(nodeContextMenu.nodeId);
                    onCloseNodeContextMenu();
                  }}
                >
                  <RefreshCw size={14} /> 替换节点
                </ContextMenuAction>
              )}

              <ContextMenuAction
                padding="8px 12px"
                onClick={() => {
                  onSelectNode(nodeContextMenu.nodeId);
                  onCloseNodeContextMenu();
                }}
              >
                <Edit3 size={14} /> 编辑节点
              </ContextMenuAction>

              <ContextMenuAction
                padding="8px 12px"
                danger
                onClick={() => {
                  onDeleteNode(nodeContextMenu.nodeId);
                  onCloseNodeContextMenu();
                }}
              >
                <Trash2 size={14} /> 删除节点
              </ContextMenuAction>
            </>
          )}
        </ContextMenuSurface>
      )}
      </AnimatePresence>
    </>
  );
}
