import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Edit3, HelpCircle, Search, X } from "lucide-react";
import type { OrbitItem } from "../../types";
import type {
  ThemedAlert,
  Workspace,
  WorkspaceLaunchLog,
  WorkspaceStep,
  WorkspaceWindowLayout
} from "./types";

interface ResourceSelectorModalProps {
  selectorStepId: string | null;
  selectorSearch: string;
  items: OrbitItem[];
  onClose: () => void;
  onSearchChange: (value: string) => void;
  onUpdateStep: (stepId: string, updates: Partial<WorkspaceStep>) => void;
  getStepIcon: (type: string) => ReactNode;
}

export function ResourceSelectorModal({
  selectorStepId,
  selectorSearch,
  items,
  onClose,
  onSearchChange,
  onUpdateStep,
  getStepIcon
}: ResourceSelectorModalProps) {
  if (!selectorStepId) return null;

  const searchLower = selectorSearch.toLowerCase().trim();
  const filteredItems = items.filter((item) => !searchLower || (
    item.title.toLowerCase().includes(searchLower) ||
    (item.target && item.target.toLowerCase().includes(searchLower))
  ));

  return (
    <div className="resource-selector-overlay" onClick={onClose}>
      <div className="resource-selector-modal glass-panel" onClick={(event) => event.stopPropagation()}>
        <div className="selector-header">
          <Search size={18} className="text-muted" />
          <input
            type="text"
            placeholder="搜索已有应用、网页、文件夹..."
            value={selectorSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            autoFocus
          />
          <button className="icon-button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="selector-results">
          <div
            className="selector-result-item custom-option"
            onClick={() => {
              onUpdateStep(selectorStepId, { itemId: undefined, title: "自定义步骤", target: "", type: "file" });
              onClose();
            }}
          >
            <Edit3 size={16} className="text-muted" />
            <div className="result-info">
              <span className="result-title">使用自定义路径或网址</span>
              <span className="result-subtitle">手动输入文件地址、命令或 HTTP 网址</span>
            </div>
          </div>
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="selector-result-item"
              onClick={() => {
                onUpdateStep(selectorStepId, { itemId: item.id });
                onClose();
              }}
            >
              {getStepIcon(item.kind)}
              <div className="result-info">
                <span className="result-title">{item.title}</span>
                <span className="result-subtitle">{item.target}</span>
              </div>
            </div>
          ))}
          {filteredItems.length === 0 && <div className="selector-no-results">未找到匹配的资源</div>}
        </div>
      </div>
    </div>
  );
}

interface DeleteWorkspaceDialogProps {
  workspace: Workspace | null;
  onClose: () => void;
  onConfirm: (workspaceId: string) => void;
  getWorkspaceIcon: (name: string, color?: string, size?: number) => ReactNode;
}

export function DeleteWorkspaceDialog({ workspace, onClose, onConfirm, getWorkspaceIcon }: DeleteWorkspaceDialogProps) {
  if (!workspace) return null;

  return (
    <div className="resource-selector-overlay" onClick={onClose}>
      <div className="modal-panel dialog-panel" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">Delete workspace</p>
            <h2>删除工作区</h2>
          </div>
          <button className="icon-action" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="dialog-body">
          <p className="dialog-warning">这只会从 OrbitStart 中移除该工作区，不会删除各启动步骤中关联的真实程序或文件。</p>
          <div className="dialog-target">
            <div style={{ marginRight: "12px", display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", borderRadius: "50%", background: `${workspace.color}15` }}>
              {getWorkspaceIcon(workspace.icon || "Briefcase", workspace.color, 20)}
            </div>
            <span>
              <strong>{workspace.name}</strong>
              <small>{workspace.description || "无描述"}</small>
            </span>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-action" onClick={onClose}>取消</button>
          <button type="button" className="danger-action dialog-action" onClick={() => onConfirm(workspace.id)}>
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

interface LaunchLogsDialogProps {
  isOpen: boolean;
  launchLogs: WorkspaceLaunchLog[];
  onClose: () => void;
  onClear: () => void;
}

export function LaunchLogsDialog({ isOpen, launchLogs, onClose, onClear }: LaunchLogsDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="resource-selector-overlay" onClick={onClose}>
      <div className="modal-panel dialog-panel" style={{ maxWidth: "550px", width: "90%" }} onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">Launch logs</p>
            <h2>启动历史日志</h2>
          </div>
          <button className="icon-action" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="dialog-body" style={{ maxHeight: "350px", overflowY: "auto", padding: "var(--space-2) var(--space-4)" }}>
          {launchLogs.length === 0 ? (
            <div style={{ textAlign: "center", padding: "var(--space-6) 0", color: "var(--muted)", fontSize: "0.9rem" }}>
              暂无启动日志记录
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {launchLogs.map((log) => (
                <div key={log.id} className="dialog-target" style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)", alignItems: "stretch", cursor: "default" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: "0.85rem", color: "var(--text)" }}>{log.workspaceName}</strong>
                    <span style={{ fontSize: "0.7rem", padding: "2px 6px", borderRadius: "4px", background: log.status === "success" ? "rgba(46, 204, 113, 0.12)" : "rgba(231, 76, 60, 0.12)", color: log.status === "success" ? "#2ecc71" : "#e74c3c", fontWeight: 500 }}>
                      {log.status === "success" ? "启动成功" : (log.status === "partial" ? "部分成功" : "启动失败")}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "var(--muted)" }}>
                    <span>启动时间: {new Date(log.launchedAt).toLocaleString("zh-CN")}</span>
                    <span>耗时: {(log.durationMs / 1000).toFixed(2)} 秒</span>
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "var(--soft)" }}>
                    总步骤: {log.totalSteps} · 成功: {log.successSteps} · 失败: {log.failedSteps}
                  </div>
                  {log.errors && log.errors.length > 0 && (
                    <div style={{ background: "rgba(231, 76, 60, 0.05)", padding: "var(--space-2)", borderRadius: "var(--radius-sm)", marginTop: "var(--space-1)", border: "1px solid rgba(231, 76, 60, 0.1)" }}>
                      {log.errors.map((error, index) => (
                        <div key={index} style={{ color: "#e74c3c", fontSize: "0.7rem", lineHeight: "1.4" }}>
                          • <strong>{error.stepTitle}</strong>: {error.errorMsg}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-actions" style={{ justifyContent: "space-between" }}>
          <button type="button" className="secondary-action" onClick={onClear} disabled={launchLogs.length === 0}>
            清空日志
          </button>
          <button type="button" className="primary-action" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

interface WindowLayoutImportDialogProps {
  isOpen: boolean;
  scannedWindows: WorkspaceWindowLayout[];
  selectedWindowIndices: number[];
  windowBindings: Record<number, string>;
  editingSteps: WorkspaceStep[];
  onClose: () => void;
  onSelectedWindowIndicesChange: (nextIndices: number[]) => void;
  onWindowBindingsChange: (nextBindings: Record<number, string>) => void;
  onImport: () => void;
}

export function WindowLayoutImportDialog({
  isOpen,
  scannedWindows,
  selectedWindowIndices,
  windowBindings,
  editingSteps,
  onClose,
  onSelectedWindowIndicesChange,
  onWindowBindingsChange,
  onImport
}: WindowLayoutImportDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="resource-selector-overlay" onClick={onClose}>
      <div className="modal-panel dialog-panel" style={{ maxWidth: "720px", width: "95%", maxHeight: "85vh" }} onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">Import Desktop Windows</p>
            <h2>导入/关联桌面运行窗口</h2>
          </div>
          <button className="icon-action" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="dialog-body" style={{ overflowY: "auto", maxHeight: "55vh", padding: "var(--space-3) var(--space-4)" }}>
          <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginBottom: "var(--space-3)" }}>
            系统检测到以下正在运行的窗口。您可以选择要导入/关联的窗口，并指定是新建步骤还是更新已有步骤。
          </p>

          <div className="scanned-windows-list" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {scannedWindows.map((windowLayout, index) => {
              const isSelected = selectedWindowIndices.includes(index);
              const currentBinding = windowBindings[index] || "new";
              return (
                <div key={index} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", background: "var(--surface-3)", padding: "10px 12px", borderRadius: "var(--radius-sm)", border: isSelected ? "1px solid var(--gold)" : "1px solid var(--line)", transition: "all 0.2s" }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(event) => onSelectedWindowIndicesChange(event.target.checked
                      ? [...selectedWindowIndices, index]
                      : selectedWindowIndices.filter((selectedIndex) => selectedIndex !== index))}
                    style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "var(--gold)" }}
                  />

                  <div style={{ flexGrow: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontWeight: "bold", fontSize: "0.85rem", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={windowLayout.windowTitle}>
                        {windowLayout.windowTitle || "无标题窗口"}
                      </span>
                      <span style={{ fontSize: "0.72rem", background: "var(--surface-4)", padding: "1px 6px", borderRadius: "3px", color: "var(--gold)" }}>
                        {windowLayout.processName}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: "3px" }}>
                      位置: ({windowLayout.x}, {windowLayout.y}) · 尺寸: {windowLayout.width}x{windowLayout.height} {windowLayout.isMaximized ? "· 已最大化" : ""}
                    </div>
                  </div>

                  <div className="step-input" style={{ width: "180px", marginBottom: 0 }}>
                    <select
                      value={currentBinding}
                      onChange={(event) => onWindowBindingsChange({ ...windowBindings, [index]: event.target.value })}
                      style={{ width: "100%", height: "30px", fontSize: "0.75rem" }}
                      disabled={!isSelected}
                    >
                      <option value="new">🆕 新建为启动步骤</option>
                      {editingSteps
                        .filter((step) => step.type !== "script" && step.type !== "wait")
                        .map((step, stepIndex) => (
                          <option key={step.id} value={step.id}>
                            🔗 关联步骤 {stepIndex + 1}: {step.title || step.target.split(/[\\/]/).pop()}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="modal-actions" style={{ borderTop: "1px solid var(--line)", paddingTop: "var(--space-3)" }}>
          <button type="button" className="secondary-action" onClick={onClose}>取消</button>
          <button type="button" className="primary-action" onClick={onImport} disabled={selectedWindowIndices.length === 0}>
            确认导入并更新 ({selectedWindowIndices.length})
          </button>
        </div>
      </div>
    </div>
  );
}

interface ThemedAlertDialogProps {
  alert: ThemedAlert | null;
  onClose: () => void;
}

export function ThemedAlertDialog({ alert, onClose }: ThemedAlertDialogProps) {
  if (!alert) return null;

  return (
    <div className="resource-selector-overlay" style={{ zIndex: 100000 }} onClick={onClose}>
      <div className="modal-panel dialog-panel" style={{ maxWidth: "400px", width: "90%", padding: "var(--space-5)" }} onClick={(event) => event.stopPropagation()}>
        <div className="modal-head" style={{ marginBottom: "var(--space-3)", borderBottom: "none", paddingBottom: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            {alert.type === "success" && <CheckCircle2 size={24} style={{ color: "var(--gold)" }} />}
            {alert.type === "error" && <AlertCircle size={24} style={{ color: "#e74c3c" }} />}
            {alert.type === "info" && <HelpCircle size={24} style={{ color: "var(--gold)" }} />}
            <h2 style={{ margin: 0, fontSize: "1.2rem" }}>{alert.title}</h2>
          </div>
        </div>
        <div className="dialog-body" style={{ padding: "0 0 var(--space-4) 0" }}>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)", whiteSpace: "pre-line", lineHeight: "1.5" }}>
            {alert.message}
          </p>
        </div>
        <div className="modal-actions" style={{ padding: 0, paddingTop: "var(--space-3)", borderTop: "1px solid var(--line)" }}>
          <button type="button" className="primary-action compact-action" onClick={onClose} style={{ width: "100%" }}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
