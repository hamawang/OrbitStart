import { FolderKanban, FolderOpen, Image, Keyboard, Save, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { ItemKind, OrbitGroup, OrbitItem, OrbitItemInput, ResourcePathMode } from "../../types";
import { joinGroupIds, listToText, normalizeList, splitGroupIds } from "./model";

export type ResourceEditorKindOption = {
  value: ItemKind;
  label: string;
  icon: string;
  group: string;
  accent: string;
  pluginId?: string;
};

export type EditorState =
  | {
      mode: "create";
      input: OrbitItemInput;
    }
  | {
      mode: "edit";
      item: OrbitItem;
      input: OrbitItemInput;
    };

type ResourceEditorDialogProps = {
  editor: EditorState;
  kindOptions: readonly ResourceEditorKindOption[];
  groups: readonly OrbitGroup[];
  busy: boolean;
  iconStyle: CSSProperties;
  renderIcon: (name: string, size?: number) => ReactNode;
  onInputChange: (input: OrbitItemInput) => void;
  onKindChange: (kind: ItemKind) => void;
  onPickTarget: (mode: "file" | "folder") => void;
  onInspectPath?: () => void;
  onOpenSubTagSelector: (currentValue: string) => void;
  onPickIcon: () => void;
  onResetIcon: () => void;
  hotkeyEnabled?: boolean;
  itemHotkey?: string;
  onRecordHotkey?: () => void;
  onClearHotkey?: () => void;
  onClose: () => void;
  onSave: () => void;
};

export function ResourceEditorDialog({
  editor,
  kindOptions,
  groups,
  busy,
  iconStyle,
  renderIcon,
  onInputChange,
  onKindChange,
  onPickTarget,
  onInspectPath,
  onOpenSubTagSelector,
  onPickIcon,
  onResetIcon,
  hotkeyEnabled = false,
  itemHotkey,
  onRecordHotkey,
  onClearHotkey,
  onClose,
  onSave
}: ResourceEditorDialogProps) {
  const { input } = editor;
  const setInput = (changes: Partial<OrbitItemInput>) => onInputChange({ ...input, ...changes });
  const selectedGroups = splitGroupIds(input.group);
  const supportsRelativePath = input.kind === "app" || input.kind === "file" || input.kind === "folder" || input.kind === "script";
  const pathMode = input.pathMode ?? "absolute";
  const targetLabel = input.kind === "action_chain"
    ? "动作链目标"
    : pathMode === "data-relative"
      ? "相对数据目录的目标路径"
      : pathMode === "workspace-relative"
        ? "相对工作区根目录的目标路径"
        : "目标路径或网址";
  const targetPlaceholder = pathMode === "data-relative"
    ? "例如：resources\\tools\\tool.exe"
    : pathMode === "workspace-relative"
      ? "例如：bin\\tool.exe"
      : "C:\\Program Files\\... 或 https://...";

  const handleDrop = (event: React.DragEvent) => {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      const file = files[0] as File & { path?: string };
      const path = file.path || file.name;
      const fileName = path.split(/[/\\]/).pop() || path;
      const title = fileName.replace(/\.[^/.]+$/, "") || fileName;
      setInput({
        target: path,
        title: input.title.trim() ? input.title : title,
        subtitle: input.subtitle.trim() ? input.subtitle : path
      });
    }
  };

  return (
    <section className="palette-backdrop" role="dialog" aria-modal="true">
      <div
        className="modal-panel editor-panel"
        onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; }}
        onDrop={handleDrop}
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">{editor.mode === "create" ? "New resource" : "Edit resource"}</p>
            <h2>{editor.mode === "create" ? "添加资源" : "编辑资源"}</h2>
          </div>
          <button className="icon-action" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="form-grid">
          <label>
            类型
            <select value={input.kind} onChange={(event) => onKindChange(event.target.value as ItemKind)}>
              {kindOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            标题
            <input value={input.title} onChange={(event) => setInput({ title: event.target.value })} placeholder="例如 VS Code" />
          </label>
          {supportsRelativePath && (
            <label className="wide-field">
              路径保存方式
              <select
                value={pathMode}
                onChange={(event) => {
                  const nextPathMode = event.target.value as ResourcePathMode;
                  setInput({
                    pathMode: nextPathMode,
                    basePath: nextPathMode === "workspace-relative" ? input.basePath ?? "" : undefined
                  });
                }}
              >
                <option value="absolute">绝对路径（兼容现有资源）</option>
                <option value="data-relative">相对便携数据目录（OrbitStart.Data）</option>
                <option value="workspace-relative">相对工作区根目录</option>
              </select>
              <small>相对路径会拒绝盘符、网络路径和上级目录；选择文件会重置为绝对路径。</small>
            </label>
          )}
          {supportsRelativePath && pathMode === "workspace-relative" && (
            <label className="wide-field">
              工作区根目录
              <input
                value={input.basePath ?? ""}
                onChange={(event) => setInput({ basePath: event.target.value })}
                placeholder="例如：E:\\Workspace 或 resources\\workspace"
              />
              <small>可使用绝对目录；也可填写相对于 OrbitStart.Data 的安全目录。</small>
            </label>
          )}
          <label className="wide-field">
            {targetLabel}
            {input.kind === "action_chain" ? (
              <textarea
                value={input.target}
                onChange={(event) => setInput({ target: event.target.value })}
                placeholder={"每行一个目标，例如：\nC:\\Windows\\System32\\notepad.exe\nhttps://github.com\nE:\\OrbitStart"}
              />
            ) : (
              <>
                <input
                  value={input.target}
                  onChange={(event) => setInput({ target: event.target.value })}
                  placeholder={targetPlaceholder}
                />
                <div className="field-actions">
                  <button type="button" className="secondary-action" onClick={() => onPickTarget("file")} disabled={busy}>
                    <FolderOpen size={16} />
                    选择文件/应用/脚本
                  </button>
                  <button type="button" className="secondary-action" onClick={() => onPickTarget("folder")} disabled={busy}>
                    <FolderKanban size={16} />
                    选择文件夹
                  </button>
                  {editor.mode === "edit" && onInspectPath && (
                    <button type="button" className="secondary-action" onClick={onInspectPath} disabled={busy}>
                      检查已保存路径
                    </button>
                  )}
                </div>
              </>
            )}
          </label>
          {input.kind !== "action_chain" && (
            <label className="wide-field">
              启动参数 (可选)
              <input
                value={input.arguments || ""}
                onChange={(event) => setInput({ arguments: event.target.value })}
                placeholder="例如：--portable --no-sandbox"
              />
            </label>
          )}
          <label className="wide-field">
            副标题
            <input value={input.subtitle} onChange={(event) => setInput({ subtitle: event.target.value })} placeholder="显示在标题下方" />
          </label>
          <label className="wide-field">
            所属分组 / 标签 (支持多选)
            <div className="group-checkbox-grid">
              {groups.filter((group) => group.id !== "all").map((group) => {
                const isChecked = selectedGroups.includes(group.id);
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={`group-tag-checkbox ${isChecked ? "checked" : ""}`}
                    onClick={() => {
                      const next = isChecked
                        ? selectedGroups.filter((id) => id !== group.id)
                        : [...selectedGroups, group.id];
                      setInput({ group: joinGroupIds(next) });
                    }}
                  >
                    {renderIcon(group.icon, 14)}
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
                value={input.subTag ? `${input.subTag}` : "无（处于主目录）"}
                readOnly
                placeholder="未选择子目录"
                style={{ cursor: "pointer", flex: 1, caretColor: "transparent" }}
                onClick={() => onOpenSubTagSelector(input.subTag ?? "")}
              />
              <button
                type="button"
                className="secondary-action"
                onClick={() => onOpenSubTagSelector(input.subTag ?? "")}
              >
                选择子目录
              </button>
              {(input.subTag ?? "") !== "" && (
                <button
                  type="button"
                  className="secondary-action danger-action"
                  style={{ padding: "0 12px" }}
                  onClick={() => setInput({ subTag: "" })}
                >
                  移回主目录
                </button>
              )}
            </div>
          </label>
          <label>
            颜色
            <input type="color" value={input.accent} onChange={(event) => setInput({ accent: event.target.value })} />
          </label>
          <label className="wide-field">
            自定义图标
            <div className="icon-picker-row">
              <span className="resource-icon" style={iconStyle}>
                {renderIcon(input.icon, 26)}
              </span>
              <button type="button" className="secondary-action" onClick={onPickIcon} disabled={busy}>
                <Image size={16} />
                选择图片
              </button>
              <button type="button" className="secondary-action" onClick={onResetIcon} disabled={busy}>
                恢复默认
              </button>
            </div>
          </label>
          {editor.mode === "edit" && hotkeyEnabled && (
            <label className="wide-field">
              资源全局快捷键
              <div className="field-actions">
                <button type="button" className="secondary-action" onClick={onRecordHotkey} disabled={busy}>
                  <Keyboard size={16} />
                  {itemHotkey ? "修改快捷键" : "录入快捷键"}
                </button>
                {itemHotkey && (
                  <button type="button" className="secondary-action danger-action" onClick={onClearHotkey} disabled={busy}>
                    解除绑定
                  </button>
                )}
                {itemHotkey && <code>{itemHotkey}</code>}
              </div>
              <small>为该资源设置全局快捷键；按下后会直接启动资源。</small>
            </label>
          )}
          <label className="wide-field">
            别名
            <input
              value={listToText(input.aliases)}
              onChange={(event) => setInput({ aliases: normalizeList(event.target.value) })}
              placeholder="用逗号分隔，例如 code, ide, 编辑器"
            />
          </label>
          <label className="wide-field">
            标签
            <input
              value={listToText(input.tags)}
              onChange={(event) => setInput({ tags: normalizeList(event.target.value) })}
              placeholder="用逗号分隔，例如 dev, daily"
            />
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={input.favorite} onChange={(event) => setInput({ favorite: event.target.checked })} />
            加入收藏
          </label>
        </div>

        <div className="modal-actions">
          <button className="secondary-action" onClick={onClose}>
            取消
          </button>
          <button className="primary-action" onClick={onSave} disabled={busy}>
            <Save size={18} />
            保存
          </button>
        </div>
      </div>
    </section>
  );
}
