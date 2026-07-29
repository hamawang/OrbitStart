import { Edit3, Lightbulb, Pin, PlusCircle, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createTrip, deleteTrip, listTrips, markTripViewed, updateTrip } from "../lib/native";
import { renderMarkdown } from "../lib/markdown";
import { tripCategoryLabels } from "../lib/tripTemplates";
import { MotionDialog, MotionTooltip } from "../motion";
import type { OrbitItem, Trip, TripCategory, TripStatus, TripUpdateInput } from "../types";
import { TripEditor } from "./TripEditor";

interface TripPanelProps {
  item: OrbitItem;
  highlightTripId?: string | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}

const statusLabels: Record<TripStatus, string> = {
  todo: "待处理",
  "in-progress": "进行中",
  done: "已完成",
  "needs-update": "需更新"
};

function tripPreview(trip: Trip) {
  return trip.content.replace(/[#*_`|>-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function formatTime(value: number) {
  if (!value) return "未记录";
  return new Date(value * 1000).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

export function TripPanel({ item, highlightTripId, onClose, onChanged }: TripPanelProps) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(highlightTripId ?? null);
  const [editingTrip, setEditingTrip] = useState<Trip | null | "new">(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Trip | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const next = await listTrips(item.id);
    setTrips(next);
    if (!expandedId && next.length > 0) setExpandedId(next[0].id);
  };

  useEffect(() => {
    void refresh();
  }, [item.id]);

  useEffect(() => {
    if (highlightTripId) setExpandedId(highlightTripId);
  }, [highlightTripId]);

  useEffect(() => {
    if (expandedId) void markTripViewed(expandedId);
  }, [expandedId]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Trip[]>();
    for (const trip of trips) {
      const key = trip.pinned ? "pinned" : trip.category;
      groups.set(key, [...(groups.get(key) ?? []), trip]);
    }
    return Array.from(groups.entries());
  }, [trips]);

  const selectedTrip = trips.find((trip) => trip.id === expandedId) ?? trips[0] ?? null;

  const saveTrip = async (input: TripUpdateInput) => {
    setBusy(true);
    try {
      if (editingTrip && editingTrip !== "new") {
        const updated = await updateTrip(editingTrip.id, input);
        setExpandedId(updated.id);
      } else {
        const created = await createTrip({ itemId: item.id, ...input });
        setExpandedId(created.id);
      }
      setEditingTrip(null);
      await refresh();
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const removeTrip = async (trip: Trip) => {
    setBusy(true);
    try {
      await deleteTrip(trip.id);
      setExpandedId(null);
      setDeleteCandidate(null);
      await refresh();
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="palette-backdrop centered-backdrop" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="trip-panel">
        <header className="trip-panel-head">
          <div>
            <p className="eyebrow">Tips</p>
            <h2>{item.title}</h2>
            <span>{trips.length} 条提示笔记</span>
          </div>
          <div className="trip-panel-actions">
            <button type="button" className="secondary-action compact-action" onClick={() => setEditingTrip("new")} disabled={busy}>
              <PlusCircle size={16} />
              新增 Tip
            </button>
            <MotionTooltip label="关闭" placement="top">
              <button type="button" className="icon-action" aria-label="关闭" onClick={onClose}>
                <X size={18} />
              </button>
            </MotionTooltip>
          </div>
        </header>

        <div className="trip-panel-body">
          <aside className="trip-list">
            {trips.length === 0 && (
              <button type="button" className="trip-empty" onClick={() => setEditingTrip("new")}>
                <Lightbulb size={22} />
                <strong>为这个资源添加第一条 Tip</strong>
                <span>记录快捷键、流程、参数或状态。</span>
              </button>
            )}
            {grouped.map(([group, groupTrips]) => (
              <section className="trip-group" key={group}>
                <h3>{group === "pinned" ? "置顶" : tripCategoryLabels[group as TripCategory]}</h3>
                {groupTrips.map((trip) => (
                  <button
                    type="button"
                    key={trip.id}
                    className={`trip-list-item ${trip.id === selectedTrip?.id ? "selected" : ""}`}
                    onClick={() => setExpandedId(trip.id)}
                  >
                    <span className={`trip-category-dot ${trip.category}`} />
                    <span>
                      <strong>{trip.title}</strong>
                      <small>{tripPreview(trip) || tripCategoryLabels[trip.category]}</small>
                    </span>
                    <em>{trip.pinned ? <Pin size={12} /> : formatTime(trip.updatedAt)}</em>
                  </button>
                ))}
              </section>
            ))}
          </aside>

          <article className="trip-detail">
            {selectedTrip ? (
              <>
                <div className="trip-detail-head">
                  <div>
                    <span className={`trip-chip ${selectedTrip.category}`}>{tripCategoryLabels[selectedTrip.category]}</span>
                    {selectedTrip.status && <span className={`trip-status ${selectedTrip.status}`}>{statusLabels[selectedTrip.status as TripStatus]}</span>}
                    {selectedTrip.pinned && <span className="trip-status pinned">置顶</span>}
                  </div>
                  <div className="trip-detail-actions">
                    <MotionTooltip label="编辑" placement="top">
                      <button type="button" aria-label="编辑" onClick={() => setEditingTrip(selectedTrip)} disabled={busy}>
                        <Edit3 size={15} />
                      </button>
                    </MotionTooltip>
                    <MotionTooltip label="删除" placement="top">
                      <button type="button" aria-label="删除" onClick={() => setDeleteCandidate(selectedTrip)} disabled={busy}>
                        <Trash2 size={15} />
                      </button>
                    </MotionTooltip>
                  </div>
                </div>
                <h3>{selectedTrip.title}</h3>
                <div className="trip-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedTrip.content || "暂无内容") }} />
                {selectedTrip.tags.length > 0 && (
                  <div className="trip-tags">
                    {selectedTrip.tags.map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                )}
              </>
            ) : (
              <div className="trip-detail-empty">
                <Lightbulb size={26} />
                <strong>还没有 Tip</strong>
                <button type="button" className="primary-action" onClick={() => setEditingTrip("new")}>新增 Tip</button>
              </div>
            )}
          </article>
        </div>

        <TripEditor
          open={Boolean(editingTrip)}
          item={item}
          trip={editingTrip && editingTrip !== "new" ? editingTrip : null}
          onSave={saveTrip}
          onCancel={() => setEditingTrip(null)}
        />
        <MotionDialog
          open={Boolean(deleteCandidate)}
          backdropClassName="palette-backdrop centered-backdrop"
          className="modal-panel"
          ariaLabelledBy="trip-delete-title"
          onBackdropClick={() => {
            if (!busy) setDeleteCandidate(null);
          }}
        >
          <div className="modal-head">
            <div>
              <p className="eyebrow">Delete Tip</p>
              <h2 id="trip-delete-title">删除 Tip</h2>
            </div>
          </div>
          <p>确定删除「{deleteCandidate?.title}」？此操作无法撤销。</p>
          <div className="modal-actions">
            <button type="button" className="secondary-action" onClick={() => setDeleteCandidate(null)} disabled={busy}>
              取消
            </button>
            <button
              type="button"
              className="danger-action"
              onClick={() => {
                if (deleteCandidate) void removeTrip(deleteCandidate);
              }}
              disabled={busy}
            >
              删除
            </button>
          </div>
        </MotionDialog>
      </div>
    </section>
  );
}
