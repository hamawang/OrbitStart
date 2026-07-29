import { ChevronDown, ChevronRight, GripVertical, Lightbulb, Pencil, Star, Trash2 } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { localGalaxyAssets } from "../../theme/localGalaxyAssets";
import {
  groupLabelsForItem,
  inputFromItem,
  subTagDisplayName,
  subTagNodeTotal,
  type SubTagNode
} from "./model";
import type { OrbitGroup, OrbitItem } from "../../types";

type RenderIcon = (props: { name: string; size?: number }) => ReactNode;

export function SortableGroupTab({
  group,
  activeGroup,
  setActiveGroup,
  hotkey,
  hotkeyBinderEnabled,
  externalDropTarget,
  renderIcon
}: {
  group: OrbitGroup;
  activeGroup: string;
  setActiveGroup: (id: string) => void;
  hotkey: string | null | undefined;
  hotkeyBinderEnabled: boolean;
  externalDropTarget: boolean;
  renderIcon: RenderIcon;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.id });
  const style: CSSProperties = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative",
    display: "inline-flex",
    alignItems: "center"
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group-tab-wrapper ${activeGroup === group.id ? "selected" : ""} ${externalDropTarget ? "external-drop-target" : ""} ${isDragging ? "dragging" : ""}`}
      data-group-id={group.id}
      data-resource-drop-group-id={group.id}
      {...attributes}
      {...listeners}
    >
      <button
        type="button"
        className={`group-tab-btn ${activeGroup === group.id ? "selected" : ""}`}
        onClick={() => setActiveGroup(group.id)}
      >
        {renderIcon({ name: group.icon, size: 16 })}
        <span>{group.title}</span>
      </button>
      {hotkeyBinderEnabled && hotkey && (
        <span className="tab-hotkey-badge" onPointerDown={(event) => event.stopPropagation()}>
          {hotkey}
        </span>
      )}
    </div>
  );
}

export function DroppableSubTagSection({ path, children }: { path: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `droppable-subtag-${path}` });
  return (
    <div
      ref={setNodeRef}
      id={`droppable-subtag-wrapper-${path}`}
      className={`subtag-droppable-wrapper ${isOver ? "drag-over" : ""}`}
      style={{ position: "relative" }}
    >
      {children}
      {isOver && (
        <div className="droppable-overlay">
          <span className="droppable-overlay-text">移动到此处</span>
        </div>
      )}
    </div>
  );
}

export function SortableSubTagSection({
  node,
  depth,
  collapsedSubTagPaths,
  displayMode,
  renderResourceCards,
  renderSubTagResourceSection,
  toggleSubTagCollapsed,
  hotkeysBoundToSubTag,
  hotkeyBinderEnabled
}: {
  node: SubTagNode;
  depth: number;
  collapsedSubTagPaths: string[];
  displayMode: string;
  renderResourceCards: (items: OrbitItem[]) => ReactNode;
  renderSubTagResourceSection: (node: SubTagNode, depth: number) => ReactNode;
  toggleSubTagCollapsed: (path: string) => void;
  hotkeysBoundToSubTag: Record<string, string>;
  hotkeyBinderEnabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `subtag-sortable-${node.path}`
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined
  };
  const collapsed = collapsedSubTagPaths.includes(node.path);
  const total = subTagNodeTotal(node);

  return (
    <div ref={setNodeRef} style={style}>
      <DroppableSubTagSection path={node.path}>
        <section className="subtag-resource-section" style={{ "--subtag-depth": depth } as CSSProperties}>
          <header className="subtag-resource-head" data-folder-id={node.path}>
            <div
              className="subtag-drag-handle"
              {...attributes}
              {...listeners}
              style={{ cursor: "grab", display: "flex", alignItems: "center", marginRight: "6px", color: "var(--text-muted)" }}
            >
              <GripVertical size={14} />
            </div>
            <button
              type="button"
              className={`subtag-collapse-button ${collapsed ? "" : "expanded"}`}
              onClick={() => toggleSubTagCollapsed(node.path)}
              aria-label={collapsed ? "展开子目录" : "收起子目录"}
              aria-expanded={!collapsed}
            >
              {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
            </button>
            <div className="subtag-resource-title" title={subTagDisplayName(node.path)}>
              <strong>{node.name}</strong>
              <span>{total} 个资源</span>
              {hotkeyBinderEnabled && hotkeysBoundToSubTag[node.path] && (
                <span className="subtag-hotkey-badge" onPointerDown={(event) => event.stopPropagation()}>
                  {hotkeysBoundToSubTag[node.path]}
                </span>
              )}
            </div>
          </header>
          {!collapsed && (
            <div className="subtag-resource-body">
              {node.items.length > 0 && (
                <div className={`resource-list subtag-resource-list display-${displayMode}`}>
                  {renderResourceCards(node.items)}
                </div>
              )}
              <SortableContext items={node.children.map((child) => `subtag-sortable-${child.path}`)} strategy={verticalListSortingStrategy}>
                {node.children.map((child) => renderSubTagResourceSection(child, depth + 1))}
              </SortableContext>
            </div>
          )}
        </section>
      </DroppableSubTagSection>
    </div>
  );
}

export function DroppableRootSection({ children, displayMode }: { children: ReactNode; displayMode: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: "droppable-subtag-root" });
  return (
    <div
      ref={setNodeRef}
      className={`root-droppable-wrapper resource-list display-${displayMode} ${isOver ? "drag-over" : ""}`}
      style={{ position: "relative" }}
    >
      {children}
      {isOver && (
        <div className="droppable-overlay">
          <span className="droppable-overlay-text">移动到此处</span>
        </div>
      )}
    </div>
  );
}

export function SortableResourceRow({
  item,
  selectedIds,
  batchMode,
  busy,
  onToggleSelected,
  onOpenItem,
  groups,
  tripCounts,
  showTripsAction,
  onOpenTrips,
  onToggleFavorite,
  onEdit,
  onDelete,
  resourceIconStyle,
  renderIcon,
  formatLastLaunched,
  hotkey,
  isOverlay = false,
  isSimple = false,
  densityFactor = 0
}: {
  item: OrbitItem;
  selectedIds: string[];
  batchMode: boolean;
  busy: boolean;
  onToggleSelected: (id: string, shiftKey?: boolean) => void;
  onOpenItem: (item: OrbitItem) => void;
  groups: OrbitGroup[];
  tripCounts: Record<string, number>;
  showTripsAction: boolean;
  onOpenTrips: (item: OrbitItem) => void;
  onToggleFavorite: (item: OrbitItem) => void;
  onEdit: (item: OrbitItem) => void;
  onDelete: (item: OrbitItem) => void;
  resourceIconStyle: (item: OrbitItem) => CSSProperties;
  renderIcon: RenderIcon;
  formatLastLaunched: (item: OrbitItem) => string;
  hotkey?: string;
  isOverlay?: boolean;
  isSimple?: boolean;
  densityFactor?: number;
}) {
  const dragDisabled = batchMode || isOverlay;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: dragDisabled
  });
  const style: CSSProperties = {
    transform: isOverlay
      ? "scale(1.04)"
      : transform
        ? `${CSS.Transform.toString(transform)} ${isDragging ? "scale(1.04)" : ""}`
        : isDragging
          ? "scale(1.04)"
          : undefined,
    transition: isOverlay ? undefined : transition,
    zIndex: isOverlay ? 10000 : isDragging ? 100 : undefined
  };
  const iconSize = isSimple ? (densityFactor > 0.5 ? 24 : 32) : 26;

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`resource-row ${selectedIds.includes(item.id) ? "selected" : ""} ${isDragging ? "placeholder" : isOverlay ? "dragging" : ""} ${isSimple ? "simple-mode" : ""}`}
      data-resource-id={item.id}
      {...(dragDisabled ? {} : attributes)}
      {...(dragDisabled ? {} : listeners)}
      onDragStart={(event) => event.preventDefault()}
    >
      {hotkey && !batchMode && !isOverlay && (
        <span className="resource-hotkey-badge" aria-label={`全局快捷键 ${hotkey}`}>
          {hotkey}
        </span>
      )}
      {batchMode && !isOverlay && (
        <label className="tile-check" onPointerDown={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={selectedIds.includes(item.id)}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSelected(item.id, event.shiftKey);
            }}
            onChange={() => undefined}
          />
        </label>
      )}
      <button
        type="button"
        className="resource-launch"
        onClick={(event) => (batchMode ? onToggleSelected(item.id, event.shiftKey) : onOpenItem(item))}
        disabled={busy}
      >
        <span className="resource-icon" style={resourceIconStyle(item)}>
          {renderIcon({ name: item.icon, size: iconSize })}
        </span>
        <span className="resource-copy">
          <strong>{item.title}</strong>
          {!isSimple && <small>{item.subtitle || item.target}</small>}
          {!isSimple && (
            <span className="resource-group-tags" aria-label="资源标签">
              {groupLabelsForItem(item, groups).map((group) => (
                <em key={group.id} data-group-id={group.id}>{group.title}</em>
              ))}
            </span>
          )}
        </span>
        {!isSimple && (
          <span className="resource-meta-column">
            <em>{item.launchCount} 次启动</em>
            <small>{formatLastLaunched(item)}</small>
          </span>
        )}
      </button>
      {!batchMode && !isSimple && !isOverlay && (
        <div className="tile-actions" onPointerDown={(event) => event.stopPropagation()}>
          {showTripsAction && (
            <button
              className={`trip-action ${tripCounts[item.id] ? "has-trips" : ""}`}
              title="Trips"
              onClick={() => onOpenTrips(item)}
              disabled={busy}
            >
              <Lightbulb size={15} />
              {tripCounts[item.id] > 0 && <span className="trip-badge">{tripCounts[item.id]}</span>}
            </button>
          )}
          <button className={`favorite-action ${item.favorite ? "is-favorite" : ""}`} title="星标" onClick={() => onToggleFavorite(item)} disabled={busy}>
            {item.favorite ? <img src={localGalaxyAssets.icons.favoriteStar20.src} alt="" /> : <Star size={15} />}
          </button>
          <button title="编辑" onClick={() => onEdit(item)}>
            <Pencil size={15} />
          </button>
          <button title="删除" onClick={() => onDelete(item)} disabled={busy}>
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </article>
  );
}
