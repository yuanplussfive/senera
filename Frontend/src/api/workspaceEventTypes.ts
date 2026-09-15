import type { BackendLocalizedMessage } from "../i18n/backendMessage";

export interface WorkspaceSnapshotData {
  workspaceRoot: string;
  configPath: string;
  websocketUrl: string;
}

export interface WorkspaceSwitchStartedData {
  workspaceRoot: string;
}

export interface WorkspaceSwitchFailedData {
  workspaceRoot: string;
  message: string;
  localizedMessage?: BackendLocalizedMessage;
  details?: unknown;
}
