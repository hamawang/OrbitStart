import type { WorkspaceStep } from "./types";

export interface WorkspaceGraphNode {
  id: string;
  title: string;
  type: "root" | WorkspaceStep["type"];
  x: number;
  y: number;
  step?: WorkspaceStep;
}

export interface WorkspaceGraphEdge {
  id: string;
  fromId: string;
  toId: string;
  px: number;
  py: number;
  cx: number;
  cy: number;
}

interface TreeNode {
  id: string;
  step?: WorkspaceStep;
  children: TreeNode[];
  width: number;
  x: number;
  y: number;
}

export function getWorkspaceGraphLayout(steps: WorkspaceStep[]): {
  nodes: WorkspaceGraphNode[];
  edges: WorkspaceGraphEdge[];
} {
  const root: TreeNode = { id: "ROOT", children: [], width: 1, x: 0, y: 0 };
  const nodeMap: Record<string, TreeNode> = { ROOT: root };

  steps.forEach((step) => {
    nodeMap[step.id] = { id: step.id, step, children: [], width: 1, x: 0, y: 0 };
  });

  steps.forEach((step) => {
    const firstDependency = step.dependsOn?.[0];
    const parentId = firstDependency && nodeMap[firstDependency] ? firstDependency : "ROOT";
    nodeMap[parentId].children.push(nodeMap[step.id]);
  });

  Object.values(nodeMap).forEach((node) => {
    node.children.sort((left, right) => (left.step?.order ?? 0) - (right.step?.order ?? 0));
  });

  const calculateNodeWidth = (node: TreeNode): number => {
    if (node.children.length === 0) {
      node.width = 1;
      return node.width;
    }

    node.width = node.children.reduce((width, child) => width + calculateNodeWidth(child), 0);
    return node.width;
  };
  calculateNodeWidth(root);

  const xSpacing = 210;
  const ySpacing = 150;
  const assignNodePositions = (node: TreeNode, startX: number, depth: number) => {
    node.y = depth * ySpacing + 60;
    if (node.children.length === 0) {
      node.x = startX + xSpacing / 2;
      return;
    }

    if (node.children.length === 1) {
      const [child] = node.children;
      assignNodePositions(child, startX, depth + 1);
      node.x = child.x;
      return;
    }

    let currentX = startX;
    const childXs: number[] = [];
    node.children.forEach((child) => {
      assignNodePositions(child, currentX, depth + 1);
      childXs.push(child.x);
      currentX += child.width * xSpacing;
    });
    node.x = (Math.min(...childXs) + Math.max(...childXs)) / 2;
  };
  assignNodePositions(root, 0, 0);

  const nodes: WorkspaceGraphNode[] = [];
  const edges: WorkspaceGraphEdge[] = [];
  Object.values(nodeMap).forEach((node) => {
    nodes.push({
      id: node.id,
      title: node.id === "ROOT" ? "启动工作区" : (node.step?.title || "未命名"),
      type: node.id === "ROOT" ? "root" : (node.step?.type || "app"),
      x: node.x,
      y: node.y,
      step: node.step
    });

    node.children.forEach((child) => {
      edges.push({
        id: `${node.id}-${child.id}`,
        fromId: node.id,
        toId: child.id,
        px: node.x,
        py: node.y,
        cx: child.x,
        cy: child.y
      });
    });
  });

  return { nodes, edges };
}
