import { Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { buildImportFilterReasons } from "./model";
import type { OrbitItemInput } from "../../types";

export type ImportPreviewState = {
  kind: "shortcuts" | "bookmarks";
  items: OrbitItemInput[];
  selectedIndices: Set<number>;
  searchQuery: string;
  visibleCount: number;
  onClose?: () => void;
};

type ImportPreviewDialogProps = {
  preview: ImportPreviewState;
  busy: boolean;
  pageSize: number;
  onPreviewChange: (preview: ImportPreviewState) => void;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  renderItemIcon: (name: string, size: number) => ReactNode;
};

export function ImportPreviewDialog({
  preview,
  busy,
  pageSize,
  onPreviewChange,
  onClose,
  onConfirm,
  renderItemIcon
}: ImportPreviewDialogProps) {
  const { kind, items, selectedIndices, searchQuery, visibleCount } = preview;
  const query = searchQuery.toLowerCase();
  const filteredItemsWithOriginalIndex = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (
      item.title.toLowerCase().includes(query)
      || item.subtitle.toLowerCase().includes(query)
      || item.target.toLowerCase().includes(query)
    ));
  const visibleItemsWithOriginalIndex = filteredItemsWithOriginalIndex.slice(0, visibleCount);
  const filterReasons = buildImportFilterReasons(kind, items);
  const label = kind === "shortcuts" ? "本地程序" : "浏览器书签";

  const updateSelection = (mutate: (selection: Set<number>) => void) => {
    const nextSelected = new Set(selectedIndices);
    mutate(nextSelected);
    onPreviewChange({ ...preview, selectedIndices: nextSelected });
  };

  return (
    <section className="palette-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-panel import-preview-panel">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Batch Import</p>
            <h2>批量导入过滤：{label}</h2>
          </div>
          <button className="icon-action" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="import-search-bar">
          <Search size={16} />
          <input
            type="text"
            placeholder="搜索扫描出的项目名称或路径..."
            value={searchQuery}
            onChange={(event) => onPreviewChange({
              ...preview,
              searchQuery: event.target.value,
              visibleCount: pageSize
            })}
          />
        </div>

        <div className="import-toolbar">
          <span>
            已选中 <strong>{selectedIndices.size}</strong> / {items.length} 项
          </span>
          <div className="toolbar-actions">
            <button type="button" className="toolbar-btn" onClick={() => updateSelection((selection) => {
              filteredItemsWithOriginalIndex.forEach(({ index }) => selection.add(index));
            })}>
              全选过滤项
            </button>
            <button type="button" className="toolbar-btn" onClick={() => updateSelection((selection) => {
              filteredItemsWithOriginalIndex.forEach(({ index }) => {
                if (selection.has(index)) {
                  selection.delete(index);
                } else {
                  selection.add(index);
                }
              });
            })}>
              反选过滤项
            </button>
            <button type="button" className="toolbar-btn" onClick={() => onPreviewChange({ ...preview, selectedIndices: new Set() })}>
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
                    onClick={() => updateSelection((selection) => {
                      if (selection.has(index)) {
                        selection.delete(index);
                      } else {
                        selection.add(index);
                      }
                    })}
                  >
                    <input type="checkbox" checked={isChecked} onChange={() => undefined} />
                    <div className="item-icon-wrapper" style={{ color: item.accent }}>
                      {renderItemIcon(item.icon, 18)}
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
                  onClick={() => onPreviewChange({ ...preview, visibleCount: visibleCount + pageSize })}
                >
                  继续显示（{visibleItemsWithOriginalIndex.length} / {filteredItemsWithOriginalIndex.length}）
                </button>
              )}
            </>
          )}
        </div>

        <div className="modal-actions">
          <button className="secondary-action" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="primary-action" onClick={() => void onConfirm()} disabled={busy || selectedIndices.size === 0}>
            确认导入 ({selectedIndices.size})
          </button>
        </div>
      </div>
    </section>
  );
}
