import { CheckCircle2, RefreshCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { OrbitItem, ResourcePathStatusReport } from "../../types";
import {
  buildResourcePathRepairPreview,
  isLocalPathResource,
  normalizeAbsolutePathPrefix,
  type ResourcePathRepairPreviewEntry
} from "./resourcePathRepair";

type ResourcePathRepairDialogProps = {
  items: readonly OrbitItem[];
  busy: boolean;
  inspectPath: (itemId: string) => Promise<ResourcePathStatusReport>;
  onApply: (entries: readonly ResourcePathRepairPreviewEntry[]) => Promise<void>;
  onEditItem: (item: OrbitItem) => void;
  onClose: () => void;
};

const statusLabel: Record<ResourcePathStatusReport["status"], string> = {
  available: "可用",
  missing: "不存在",
  "permission-denied": "权限不足",
  "network-unavailable": "网络路径暂不可用",
  invalid: "路径无效"
};

function statusColor(status?: ResourcePathStatusReport["status"]) {
  if (status === "available") return "var(--success, #41e0a8)";
  if (status === "missing" || status === "invalid") return "var(--danger, #ff7a90)";
  return "var(--warning, #f6b95b)";
}

function reportForFailedInspection(item: OrbitItem, error: unknown): ResourcePathStatusReport {
  return {
    pathMode: item.pathMode ?? "absolute",
    target: item.target,
    basePath: item.basePath,
    status: "invalid",
    message: `检查失败：${String(error)}`
  };
}

/**
 * A deliberately conservative repair UI: it checks path state first, creates
 * a string-only preview, and requires per-item selection plus an explicit
 * acknowledgement before it saves any catalog records. It never changes
 * files on disk or rewrites relative-path resources.
 */
export function ResourcePathRepairDialog({
  items,
  busy,
  inspectPath,
  onApply,
  onEditItem,
  onClose
}: ResourcePathRepairDialogProps) {
  const inspectableItems = useMemo(() => items.filter(isLocalPathResource), [items]);
  const [reportsById, setReportsById] = useState<Record<string, ResourcePathStatusReport>>({});
  const [checking, setChecking] = useState(false);
  const [checkedCount, setCheckedCount] = useState(0);
  const [oldPrefix, setOldPrefix] = useState("");
  const [newPrefix, setNewPrefix] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [acknowledged, setAcknowledged] = useState(false);
  const [applyError, setApplyError] = useState("");

  const preview = useMemo(
    () => buildResourcePathRepairPreview(inspectableItems, reportsById, oldPrefix, newPrefix),
    [inspectableItems, reportsById, oldPrefix, newPrefix]
  );
  const candidates = preview.filter((entry) => entry.eligible);
  const candidateIdsSignature = candidates.map((entry) => entry.item.id).join("\u0000");
  const selectedEntries = candidates.filter((entry) => selectedIds.has(entry.item.id));
  const oldPrefixValid = !oldPrefix.trim() || Boolean(normalizeAbsolutePathPrefix(oldPrefix));
  const newPrefixValid = !newPrefix.trim() || Boolean(normalizeAbsolutePathPrefix(newPrefix));
  const canApply = !busy && !checking && acknowledged && selectedEntries.length > 0 && oldPrefixValid && newPrefixValid;

  useEffect(() => {
    const candidateIds = new Set(candidates.map((entry) => entry.item.id));
    setSelectedIds((previous) => {
      const retained = new Set(Array.from(previous).filter((id) => candidateIds.has(id)));
      return retained.size === previous.size ? previous : retained;
    });
  }, [candidateIdsSignature]);

  useEffect(() => {
    setAcknowledged(false);
  }, [oldPrefix, newPrefix, selectedIds]);

  const runInspection = async () => {
    if (checking || busy) return;
    setChecking(true);
    setCheckedCount(0);
    setReportsById({});
    setSelectedIds(new Set());
    setAcknowledged(false);
    setApplyError("");
    const nextReports: Record<string, ResourcePathStatusReport> = {};
    const batchSize = 6;
    try {
      for (let offset = 0; offset < inspectableItems.length; offset += batchSize) {
        const batch = inspectableItems.slice(offset, offset + batchSize);
        const inspected = await Promise.all(batch.map(async (item) => {
          try {
            return [item.id, await inspectPath(item.id)] as const;
          } catch (error) {
            return [item.id, reportForFailedInspection(item, error)] as const;
          }
        }));
        inspected.forEach(([id, report]) => {
          nextReports[id] = report;
        });
        setReportsById({ ...nextReports });
        setCheckedCount(Math.min(offset + batch.length, inspectableItems.length));
      }
    } finally {
      setChecking(false);
    }
  };

  const toggleSelection = (itemId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const selectAllCandidates = () => {
    setSelectedIds(new Set(candidates.map((entry) => entry.item.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const apply = async () => {
    if (!canApply) return;
    setApplyError("");
    try {
      await onApply(selectedEntries);
    } catch (error) {
      setApplyError(String(error));
    }
  };

  const inspectedCount = Object.keys(reportsById).length;
  const missingCount = Object.values(reportsById).filter((report) => report.status === "missing").length;

  return (
    <section
      className="palette-backdrop centered-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="资源路径修复"
      onClick={(event) => { if (event.target === event.currentTarget && !busy && !checking) onClose(); }}
    >
      <div className="modal-panel import-preview-panel resource-path-repair-panel">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Portable path repair</p>
            <h2>检测并预览资源路径修复</h2>
          </div>
          <button type="button" className="icon-action" onClick={onClose} disabled={busy || checking} aria-label="关闭路径修复">
            <X size={18} />
          </button>
        </div>

        <div className="dialog-body" style={{ display: "grid", gap: "var(--space-4)", maxHeight: "62vh", overflowY: "auto" }}>
          <p style={{ margin: 0, color: "var(--soft)", lineHeight: 1.6 }}>
            检查 app、文件、文件夹和脚本路径；仅缺失的绝对路径可做前缀替换。确认保存时会先在数据目录创建 catalog JSON 备份，随后只修改 OrbitStart 中已选资源记录，不会移动、删除或覆盖目标磁盘文件；相对路径和网络暂不可用路径不会自动替换，可改用“在编辑器中手动修复”。
          </p>

          <div className="import-toolbar" aria-live="polite">
            <span>
              已检查 <strong>{inspectedCount}</strong> / {inspectableItems.length} 项
              {checking && `（正在检查 ${checkedCount} / ${inspectableItems.length}）`}
              {inspectedCount > 0 && <> · 发现 <strong>{missingCount}</strong> 项不存在</>}
            </span>
            <div className="toolbar-actions">
              <button type="button" className="toolbar-btn" onClick={() => void runInspection()} disabled={busy || checking || inspectableItems.length === 0}>
                <RefreshCcw size={15} />
                {checking ? "检查中…" : "检查失效资源"}
              </button>
            </div>
          </div>

          {inspectableItems.length === 0 ? (
            <div className="empty-preview">当前没有可检查的绝对本地资源。</div>
          ) : inspectedCount === 0 ? (
            <div className="empty-preview">先运行检查，再填写旧路径和新路径以生成修复预览。</div>
          ) : (
            <>
              <div className="form-grid">
                <label className="wide-field">
                  旧路径前缀
                  <input
                    value={oldPrefix}
                    onChange={(event) => setOldPrefix(event.target.value)}
                    placeholder="例如：C:\\Users\\name\\Documents"
                    disabled={busy || checking}
                  />
                  {!oldPrefixValid && <small style={{ color: "var(--danger)" }}>请输入盘符路径或 UNC 网络路径。</small>}
                </label>
                <label className="wide-field">
                  新路径前缀
                  <input
                    value={newPrefix}
                    onChange={(event) => setNewPrefix(event.target.value)}
                    placeholder="例如：D:\\PortableData\\Documents"
                    disabled={busy || checking}
                  />
                  {!newPrefixValid && <small style={{ color: "var(--danger)" }}>请输入盘符路径或 UNC 网络路径。</small>}
                </label>
              </div>

              <div className="import-toolbar">
                <span>
                  可预览替换 <strong>{candidates.length}</strong> 项，已选择 <strong>{selectedEntries.length}</strong> 项
                </span>
                <div className="toolbar-actions">
                  <button type="button" className="toolbar-btn" onClick={selectAllCandidates} disabled={busy || checking || candidates.length === 0}>选择全部可修复项</button>
                  <button type="button" className="toolbar-btn" onClick={clearSelection} disabled={busy || checking || selectedIds.size === 0}>清空选择</button>
                </div>
              </div>

              <div className="import-preview-list resource-path-repair-list">
                {preview.map((entry) => {
                  const status = entry.report?.status;
                  const selected = selectedIds.has(entry.item.id);
                  return (
                    <label
                      key={entry.item.id}
                      className={`import-preview-item ${selected ? "is-checked" : entry.eligible ? "" : "is-filtered"}`}
                      style={{ cursor: entry.eligible ? "pointer" : "default" }}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!entry.eligible || busy || checking}
                        onChange={() => toggleSelection(entry.item.id)}
                      />
                      <div className="item-info">
                        <div className="item-title">
                          {entry.item.title}
                          {status && <span className="filter-tag" style={{ color: statusColor(status) }}>{statusLabel[status]}</span>}
                          {entry.eligible && <span className="filter-tag">可修复</span>}
                        </div>
                        <div className="item-subtitle" title={entry.item.target}>{entry.item.target}</div>
                        {entry.replacementTarget && (
                          <div className="item-subtitle" title={entry.replacementTarget} style={{ color: "var(--success, #41e0a8)" }}>
                            预览：{entry.replacementTarget}
                          </div>
                        )}
                        {entry.reason && <small style={{ color: "var(--soft)" }}>{entry.reason}</small>}
                        {entry.report?.message && <small style={{ color: "var(--soft)" }}>{entry.report.message}</small>}
                        {!entry.eligible && entry.report?.status !== "available" && (
                          <button
                            type="button"
                            className="toolbar-btn"
                            style={{ marginTop: "var(--space-2)" }}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onEditItem(entry.item);
                            }}
                            disabled={busy || checking}
                          >
                            在编辑器中手动修复
                          </button>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>

              {selectedEntries.length > 0 && (
                <label className="checkbox-field" style={{ alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                    disabled={busy || checking}
                  />
                  <span>我已逐项核对以上路径预览，确认先创建 catalog 备份，再只保存所选资源的新目标路径。</span>
                </label>
              )}
              {applyError && <p className="dialog-warning" role="alert">保存失败：{applyError}</p>}
            </>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary-action" onClick={onClose} disabled={busy || checking}>取消</button>
          <button type="button" className="primary-action" onClick={() => void apply()} disabled={!canApply}>
            <CheckCircle2 size={18} />
            确认并保存所选路径 ({selectedEntries.length})
          </button>
        </div>
      </div>
    </section>
  );
}
