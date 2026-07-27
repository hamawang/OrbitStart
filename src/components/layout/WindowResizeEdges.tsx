import { useRef } from "react";
import { startWindowResize, type ResizeDirection, toggleMaximizeWindow } from "../../desktop/windowControls";

type ResizeEdge = "top" | "right" | "bottom" | "left" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

const resizeEdgeDirections: Record<ResizeEdge, ResizeDirection> = {
  top: "North",
  right: "East",
  bottom: "South",
  left: "West",
  "top-left": "NorthWest",
  "top-right": "NorthEast",
  "bottom-left": "SouthWest",
  "bottom-right": "SouthEast"
};

export function WindowResizeEdges() {
  const edges = Object.keys(resizeEdgeDirections) as ResizeEdge[];
  const activeDrag = useRef<{
    edge: ResizeEdge;
    startX: number;
    startY: number;
    pointerId: number;
  } | null>(null);

  return (
    <div className="window-resize-edges" aria-hidden="true">
      {edges.map((edge) => (
        <span
          key={edge}
          className={`window-resize-edge ${edge}`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            // Preserve compatibility click events so a double-click on a resize border still works in WebView2.
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            activeDrag.current = {
              edge,
              startX: event.clientX,
              startY: event.clientY,
              pointerId: event.pointerId
            };
          }}
          onPointerMove={(event) => {
            if (!activeDrag.current || activeDrag.current.pointerId !== event.pointerId) return;
            const dx = event.clientX - activeDrag.current.startX;
            const dy = event.clientY - activeDrag.current.startY;
            if (Math.hypot(dx, dy) > 3) {
              const currentEdge = activeDrag.current.edge;
              event.currentTarget.releasePointerCapture(event.pointerId);
              activeDrag.current = null;
              startWindowResize(resizeEdgeDirections[currentEdge]);
            }
          }}
          onPointerUp={(event) => {
            if (activeDrag.current && activeDrag.current.pointerId === event.pointerId) {
              event.currentTarget.releasePointerCapture(event.pointerId);
              activeDrag.current = null;
            }
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleMaximizeWindow();
          }}
        />
      ))}
    </div>
  );
}
