export type AgentPresetFormat = "json" | "markdown" | "text";

export interface AgentPresetState {
  activePresetName: string | null;
}

export interface AgentPresetFileRecord {
  name: string;
  path: string;
  format: AgentPresetFormat;
  content: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface AgentParsedPresetDocument extends AgentPresetFileRecord {
  title: string;
  parsedJson?: unknown;
}

export interface AgentPresetSnapshotItem {
  name: string;
  format: AgentPresetFormat;
  title: string;
  sizeBytes: number;
  updatedAt: string;
  active: boolean;
  content: string;
  diagnostics: AgentPresetDiagnostic[];
}

export interface AgentPresetDiagnostic {
  severity: "error" | "warning";
  message: string;
}

export type AgentPresetOperationKind = "list" | "save" | "delete" | "set_active";

export interface AgentPresetOperationResult {
  requestId?: string;
  kind: AgentPresetOperationKind;
  name?: string | null;
}

export interface AgentPresetSnapshot {
  enabled: boolean;
  rootDir: string;
  activePresetName: string | null;
  presets: AgentPresetSnapshotItem[];
  operation?: AgentPresetOperationResult;
}

export interface AgentRoleplayPresetDocumentContext {
  name: string;
  format: AgentPresetFormat;
  title: string;
  sizeBytes: number;
  updatedAt: string;
  xml: string;
}

export interface AgentRoleplayPresetContext {
  enabled: boolean;
  activePresetName: string | null;
  documents: AgentRoleplayPresetDocumentContext[];
}

export interface AgentPlannerRoleplayPresetDocumentContext {
  name: string;
  format: AgentPresetFormat;
  title: string;
  updatedAt: string;
  content: string;
}

export interface AgentPlannerRoleplayPresetContext {
  enabled: boolean;
  activePresetName: string | null;
  documents: AgentPlannerRoleplayPresetDocumentContext[];
}

export const EmptyAgentRoleplayPresetContext: AgentRoleplayPresetContext = {
  enabled: false,
  activePresetName: null,
  documents: [],
};

export const EmptyAgentPlannerRoleplayPresetContext: AgentPlannerRoleplayPresetContext = {
  enabled: false,
  activePresetName: null,
  documents: [],
};
