export const STORAGE_KEY_ACTIVE_LAUNCH =
  "orbitstart.plugin.workspaces.storage.active_launch";

export type WorkspaceLaunchResult = "success" | "error" | "cancelled";
export type WorkspaceLaunchStorageStatus = "running" | "done";

export interface WorkspaceLaunchProgress {
  launchId: string;
  ownerRuntimeId: string;
  workspaceId: string;
  workspaceName: string;
  currentStepIndex: number;
  totalSteps: number;
  currentStepId: string | null;
  currentStepTitle: string;
  completedStepIds: string[];
  failedStepCount: number;
  status: WorkspaceLaunchStorageStatus;
  result: WorkspaceLaunchResult | null;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  errorMessage: string | null;
}

export function parseStoredWorkspaceLaunch(
  raw: string | null,
  expectedWorkspaceId?: string,
  fallbackWorkspaceName = ""
): WorkspaceLaunchProgress | null {
  if (!raw) return null;

  const value = JSON.parse(raw) as Partial<WorkspaceLaunchProgress>;
  if (
    (value.status !== "running" && value.status !== "done") ||
    typeof value.workspaceId !== "string" ||
    (expectedWorkspaceId !== undefined && value.workspaceId !== expectedWorkspaceId)
  ) {
    return null;
  }

  const totalSteps = Math.max(0, Number(value.totalSteps) || 0);
  const currentStepIndex = Math.min(
    totalSteps,
    Math.max(0, Number(value.currentStepIndex) || 0)
  );
  const startedAt =
    Number.isFinite(value.startedAt) && Number(value.startedAt) > 0
      ? Number(value.startedAt)
      : 0;

  return {
    launchId:
      typeof value.launchId === "string" && value.launchId
        ? value.launchId
        : `legacy-${value.workspaceId}-${startedAt}`,
    ownerRuntimeId:
      typeof value.ownerRuntimeId === "string" ? value.ownerRuntimeId : "",
    workspaceId: value.workspaceId,
    workspaceName:
      typeof value.workspaceName === "string" && value.workspaceName
        ? value.workspaceName
        : fallbackWorkspaceName,
    currentStepIndex,
    totalSteps,
    currentStepId:
      typeof value.currentStepId === "string" ? value.currentStepId : null,
    currentStepTitle:
      typeof value.currentStepTitle === "string" ? value.currentStepTitle : "",
    completedStepIds: Array.isArray(value.completedStepIds)
      ? value.completedStepIds.filter(
          (id): id is string => typeof id === "string"
        )
      : [],
    failedStepCount: Math.max(0, Number(value.failedStepCount) || 0),
    status: value.status,
    result:
      value.result === "success" ||
      value.result === "error" ||
      value.result === "cancelled"
        ? value.result
        : value.status === "done"
          ? "error"
          : null,
    startedAt,
    updatedAt:
      Number.isFinite(value.updatedAt) && Number(value.updatedAt) > 0
        ? Number(value.updatedAt)
        : 0,
    completedAt:
      Number.isFinite(value.completedAt) && Number(value.completedAt) > 0
        ? Number(value.completedAt)
        : null,
    errorMessage:
      typeof value.errorMessage === "string" && value.errorMessage
        ? value.errorMessage
        : null
  };
}
