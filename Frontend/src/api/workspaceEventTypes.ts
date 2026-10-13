import type { BackendLocalizedMessage } from "../i18n/backendMessage";

export interface WorkspaceSnapshotData {
  workspaceId: string;
  workspaces: readonly { id: string; root: string; name: string }[];
  capabilities: { browseDirectories: boolean };
  workspaceRoot: string;
  configPath: string;
  websocketUrl: string;
}

export interface WorkspaceSwitchStartedData {
  requestId: string;
  workspaceRoot: string;
}

export interface WorkspaceSwitchFailedData {
  requestId: string;
  workspaceRoot: string;
  message: string;
  localizedMessage?: BackendLocalizedMessage;
  details?: unknown;
}
