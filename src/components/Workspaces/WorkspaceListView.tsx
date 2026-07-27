import type { MouseEvent } from "react";
import { Briefcase, Edit3, FileText, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { Workspace, WorkspaceStep } from "./types";
import { getWorkspaceIcon } from "./workspaceIcons";

interface WorkspaceListViewProps {
  workspaces: Workspace[];
  steps: WorkspaceStep[];
  launchingId: string | null;
  onCreateWorkspace: () => void;
  onOpenLogs: () => void;
  onLaunch: (workspace: Workspace) => void;
  onEdit: (workspace: Workspace) => void;
  onDelete: (workspaceId: string) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, workspace: Workspace) => void;
}

export function WorkspaceListView({
  workspaces,
  steps,
  launchingId,
  onCreateWorkspace,
  onOpenLogs,
  onLaunch,
  onEdit,
  onDelete,
  onContextMenu
}: WorkspaceListViewProps) {
  return (
    <div className="workspaces-list-view">
      <div className="view-actions" style={{ display: "flex", gap: "var(--space-2)" }}>
        <button className="primary-action" onClick={onCreateWorkspace}>
          <Plus size={18} /> 新建工作区
        </button>
        <button className="secondary-action" onClick={onOpenLogs}>
          <FileText size={16} /> 历史日志
        </button>
      </div>

      {workspaces.length === 0 ? (
        <div className="empty-workspaces glass-panel">
          <Briefcase size={48} className="text-muted" />
          <h3>暂无工作区</h3>
          <p>工作区可以将多个应用、网址、文件夹等组合在一起，并在您需要的时候一键按顺序批量启动。</p>
          <button className="primary-action compact-action" onClick={onCreateWorkspace}>
            立即创建
          </button>
        </div>
      ) : (
        <div className="workspaces-grid">
          {workspaces.map((workspace) => {
            const workspaceSteps = steps.filter((step) => step.workspaceId === workspace.id);
            const enabledSteps = workspaceSteps.filter((step) => step.enabled);
            const isLaunching = launchingId === workspace.id;

            return (
              <div
                key={workspace.id}
                className="workspace-card glass-panel"
                style={{ borderTop: `4px solid ${workspace.color || "#E0533C"}` }}
                onContextMenu={(event) => onContextMenu(event, workspace)}
              >
                <div className="card-top">
                  <div className="ws-icon-circle" style={{ backgroundColor: `${workspace.color}15` }}>
                    {getWorkspaceIcon(workspace.icon || "Briefcase", workspace.color, 24)}
                  </div>
                  <div className="ws-meta">
                    <h4>{workspace.name}</h4>
                    <p>{workspace.description || "无描述"}</p>
                  </div>
                </div>

                <div className="card-middle">
                  <div className="stat-badge">
                    <span className="stat-label">步骤数量:</span>
                    <span className="stat-val">{enabledSteps.length} / {workspaceSteps.length}</span>
                  </div>
                  <div className="stat-badge">
                    <span className="stat-label">启动次数:</span>
                    <span className="stat-val">{workspace.launchCount || 0}</span>
                  </div>
                  {workspace.lastLaunchedAt && (
                    <div className="stat-badge full-width">
                      <span className="stat-label">上次启动:</span>
                      <span className="stat-val">{new Date(workspace.lastLaunchedAt).toLocaleString("zh-CN", { hour12: false })}</span>
                    </div>
                  )}
                </div>

                <div className="card-bottom">
                  <button
                    className={`primary-action launch-btn ${isLaunching ? "launching" : ""}`}
                    disabled={isLaunching}
                    onClick={() => onLaunch(workspace)}
                  >
                    {isLaunching ? (
                      <>
                        <RefreshCw size={16} className="spin-animation" /> 启动中
                      </>
                    ) : (
                      <>
                        <Play size={16} /> 启动
                      </>
                    )}
                  </button>

                  <div className="action-buttons">
                    <button className="icon-button" onClick={() => onEdit(workspace)} title="编辑">
                      <Edit3 size={16} />
                    </button>
                    <button className="icon-button text-danger" onClick={() => onDelete(workspace.id)} title="删除">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
