import {
  AlertTriangle,
  Check,
  ChevronRight,
  GripVertical,
  Lightbulb,
  Loader2,
  Pencil,
  Star,
  Trash2
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, m } from "motion/react";
import { localGalaxyAssets } from "../../theme/localGalaxyAssets";
import { MotionCollapse, MotionTooltip, useMotionPolicy, useMotionTransition } from "../../motion";
import "./resource-motion.css";
import {
  groupLabelsForItem,
  inputFromItem,
  subTagDisplayName,
  subTagNodeTotal,
  type SubTagNode
} from "./model";
import type { OrbitGroup, OrbitItem } from "../../types";

type RenderIcon = (props: { name: string; size?: number }) => ReactNode;
export type ResourceLaunchState =
  | "idle"
  | "launching"
  | "success"
  | "error"
  | "delete-error";

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
  const dndTransform = transform ? CSS.Transform.toString(transform) : "none";
  const style = {
    transform: dndTransform,
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    "--dnd-transform": dndTransform,
    "--dnd-transition": transition || "none"
  } as CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group-tab-wrapper ${activeGroup === group.id ? "selected" : ""} ${externalDropTarget ? "external-drop-target" : ""} ${isDragging ? "dragging" : ""}`}
      data-group-id={group.id}
      data-resource-drop-group-id={group.id}
      data-motion-transform="dnd"
      data-dnd-active={Boolean(transform) || isDragging ? "true" : "false"}
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
  const transition = useMotionTransition("instant");
  return (
    <div
      ref={setNodeRef}
      id={`droppable-subtag-wrapper-${path}`}
      className={`subtag-droppable-wrapper ${isOver ? "drag-over" : ""}`}
      style={{ position: "relative" }}
    >
      {children}
      <AnimatePresence initial={false}>
        {isOver && (
        <m.div
          className="droppable-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
        >
          <span className="droppable-overlay-text">移动到此处</span>
        </m.div>
        )}
      </AnimatePresence>
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
  const dndTransform = transform ? CSS.Transform.toString(transform) : "none";
  const style = {
    transform: dndTransform,
    transition,
    opacity: isDragging ? 0.5 : undefined,
    "--dnd-transform": dndTransform,
    "--dnd-transition": transition || "none"
  } as CSSProperties;
  const collapsed = collapsedSubTagPaths.includes(node.path);
  const total = subTagNodeTotal(node);

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-motion-transform="dnd"
      data-dnd-active={Boolean(transform) || isDragging ? "true" : "false"}
    >
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
              <ChevronRight size={15} />
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
          <MotionCollapse open={!collapsed} className="subtag-resource-body" instant={total > 40}>
              {node.items.length > 0 && (
                <div className={`resource-list subtag-resource-list display-${displayMode}`}>
                  {renderResourceCards(node.items)}
                </div>
              )}
              <SortableContext items={node.children.map((child) => `subtag-sortable-${child.path}`)} strategy={verticalListSortingStrategy}>
                {node.children.map((child) => renderSubTagResourceSection(child, depth + 1))}
              </SortableContext>
          </MotionCollapse>
        </section>
      </DroppableSubTagSection>
    </div>
  );
}

export function DroppableRootSection({ children, displayMode }: { children: ReactNode; displayMode: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: "droppable-subtag-root" });
  const transition = useMotionTransition("instant");
  return (
    <div
      ref={setNodeRef}
      className={`root-droppable-wrapper resource-list display-${displayMode} ${isOver ? "drag-over" : ""}`}
      style={{ position: "relative" }}
    >
      {children}
      <AnimatePresence initial={false}>
        {isOver && (
        <m.div
          className="droppable-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
        >
          <span className="droppable-overlay-text">移动到此处</span>
        </m.div>
        )}
      </AnimatePresence>
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
  onNewAnimationComplete,
  onDeleteAnimationComplete,
  resourceIconStyle,
  renderIcon,
  formatLastLaunched,
  hotkey,
  isOverlay = false,
  isSimple = false,
  densityFactor = 0,
  launchState = "idle",
  isNew = false,
  isDeleting = false
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
  onNewAnimationComplete?: (id: string) => void;
  onDeleteAnimationComplete?: (id: string) => void;
  resourceIconStyle: (item: OrbitItem) => CSSProperties;
  renderIcon: RenderIcon;
  formatLastLaunched: (item: OrbitItem) => string;
  hotkey?: string;
  isOverlay?: boolean;
  isSimple?: boolean;
  densityFactor?: number;
  launchState?: ResourceLaunchState;
  isNew?: boolean;
  isDeleting?: boolean;
}) {
  const { effectiveMode, transformsEnabled } = useMotionPolicy();
  const previousFavoriteRef = useRef(item.favorite);
  const isNewRef = useRef(isNew);
  const isDeletingRef = useRef(isDeleting);
  const onNewAnimationCompleteRef = useRef(onNewAnimationComplete);
  const onDeleteAnimationCompleteRef = useRef(onDeleteAnimationComplete);
  const [justFavorited, setJustFavorited] = useState(false);
  const dragDisabled = batchMode || isOverlay || isDeleting || launchState === "launching";
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: dragDisabled
  });
  const dragScale = transformsEnabled ? 1.025 : 1;
  const dndTransform = isOverlay
      ? `scale(${dragScale})`
      : transform
        ? `${CSS.Transform.toString(transform)} ${isDragging ? `scale(${dragScale})` : ""}`
        : isDragging
          ? `scale(${dragScale})`
          : "none";
  const style = {
    transform: dndTransform,
    transition: isOverlay ? undefined : transition,
    zIndex: isOverlay ? 10000 : isDragging ? 100 : undefined,
    "--dnd-transform": dndTransform,
    "--dnd-transition": isOverlay ? "none" : transition || "none"
  } as CSSProperties;
  const iconSize = isSimple ? (densityFactor > 0.5 ? 24 : 32) : 26;
  isNewRef.current = isNew;
  isDeletingRef.current = isDeleting;
  onNewAnimationCompleteRef.current = onNewAnimationComplete;
  onDeleteAnimationCompleteRef.current = onDeleteAnimationComplete;

  useEffect(() => {
    return () => {
      if (isNewRef.current) {
        onNewAnimationCompleteRef.current?.(item.id);
      }
      if (isDeletingRef.current) {
        onDeleteAnimationCompleteRef.current?.(item.id);
      }
    };
  }, [item.id]);

  useEffect(() => {
    const wasFavorite = previousFavoriteRef.current;
    previousFavoriteRef.current = item.favorite;
    if (effectiveMode === "minimal" || effectiveMode === "off") {
      setJustFavorited(false);
    } else if (!wasFavorite && item.favorite) {
      setJustFavorited(true);
    } else if (!item.favorite) {
      setJustFavorited(false);
    }
  }, [effectiveMode, item.favorite]);

  useEffect(() => {
    if (effectiveMode !== "off") return;
    if (isNew) onNewAnimationComplete?.(item.id);
    if (isDeleting) onDeleteAnimationComplete?.(item.id);
  }, [
    effectiveMode,
    isDeleting,
    isNew,
    item.id,
    onDeleteAnimationComplete,
    onNewAnimationComplete
  ]);

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`resource-row ${selectedIds.includes(item.id) ? "selected" : ""} ${isDragging ? "placeholder" : isOverlay ? "dragging" : ""} ${isSimple ? "simple-mode" : ""} ${isNew ? "motion-resource-new" : ""} ${isDeleting ? "motion-resource-deleting" : ""}`}
      data-resource-id={item.id}
      data-launch-state={launchState}
      data-motion-state={isDeleting ? "deleting" : isNew ? "new" : undefined}
      data-motion-transform="dnd"
      data-dnd-overlay={isOverlay ? "true" : undefined}
      data-dnd-active={isOverlay || Boolean(transform) || isDragging ? "true" : "false"}
      aria-busy={launchState === "launching"}
      {...(dragDisabled ? {} : attributes)}
      {...(dragDisabled ? {} : listeners)}
      onDragStart={(event) => event.preventDefault()}
      onAnimationEnd={(event) => {
        if (
          isNew &&
          (event.animationName === "orbit-resource-enter" ||
            event.animationName === "orbit-resource-fade-enter")
        ) {
          onNewAnimationComplete?.(item.id);
        }
        if (
          isDeleting &&
          (event.animationName === "orbit-resource-exit" ||
            event.animationName === "orbit-resource-fade-exit")
        ) {
          onDeleteAnimationComplete?.(item.id);
        }
      }}
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
        title={item.subtitle || item.target}
        onClick={(event) => (batchMode ? onToggleSelected(item.id, event.shiftKey) : onOpenItem(item))}
        disabled={busy || launchState === "launching" || isDeleting || isDragging || isOverlay}
      >
        <span className="resource-icon-shell">
          <span className="resource-icon" style={resourceIconStyle(item)}>
            {renderIcon({ name: item.icon, size: iconSize })}
          </span>
          {launchState !== "idle" && (
            <span className={`resource-launch-status is-${launchState}`} aria-live="polite">
              {launchState === "launching" && <Loader2 size={13} aria-hidden="true" />}
              {launchState === "success" && <Check size={13} aria-hidden="true" />}
              {(launchState === "error" || launchState === "delete-error") && (
                <AlertTriangle size={12} aria-hidden="true" />
              )}
              <span className="sr-only">
                {launchState === "launching"
                  ? "正在启动"
                  : launchState === "success"
                    ? "启动成功"
                    : launchState === "delete-error"
                      ? "删除失败"
                      : "启动失败"}
              </span>
            </span>
          )}
        </span>
        <span className="resource-copy" title={item.subtitle || item.target}>
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
            <MotionTooltip label="Trips" placement="top">
              <button
                className={`trip-action ${tripCounts[item.id] ? "has-trips" : ""}`}
                aria-label="Trips"
                onClick={() => onOpenTrips(item)}
                disabled={busy || isDragging}
              >
                <Lightbulb size={15} />
                {tripCounts[item.id] > 0 && <span className="trip-badge">{tripCounts[item.id]}</span>}
              </button>
            </MotionTooltip>
          )}
          <MotionTooltip label="星标" placement="top">
            <button
              className={`favorite-action ${item.favorite ? "is-favorite" : ""} ${justFavorited ? "just-favorited" : ""}`}
              aria-label="星标"
              onClick={() => onToggleFavorite(item)}
              disabled={busy || isDragging}
              onAnimationEnd={(event) => {
                if (
                  event.animationName === "orbit-favorite-confirm" ||
                  event.animationName === "orbit-favorite-glow"
                ) {
                  setJustFavorited(false);
                }
              }}
            >
              {item.favorite ? <img src={localGalaxyAssets.icons.favoriteStar20.src} alt="" /> : <Star size={15} />}
            </button>
          </MotionTooltip>
          <MotionTooltip label="编辑" placement="top">
            <button aria-label="编辑" onClick={() => onEdit(item)} disabled={isDragging}>
              <Pencil size={15} />
            </button>
          </MotionTooltip>
          <MotionTooltip label="删除" placement="top">
            <button aria-label="删除" onClick={() => onDelete(item)} disabled={busy || isDragging}>
              <Trash2 size={15} />
            </button>
          </MotionTooltip>
        </div>
      )}
    </article>
  );
}
