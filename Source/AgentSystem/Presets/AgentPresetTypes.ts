export const AgentPersonaPresetSchemaVersion = "senera.persona/v2" as const;

export interface AgentPresetExample {
  id: string;
  situation: string;
  reply: string;
}

export interface AgentPresetLoreEntry {
  id: string;
  title: string;
  keywords: string[];
  content: string;
  enabled: boolean;
}

/** Senera-owned character-card format. Files are an implementation detail. */
export interface AgentPersonaPreset {
  schemaVersion: typeof AgentPersonaPresetSchemaVersion;
  title: string;
  corePersona: string;
  languageStyle: string;
  worldPackageIds: string[];
  examples: AgentPresetExample[];
  lore: AgentPresetLoreEntry[];
}

export interface AgentPresetWorldPackageDescriptor {
  id: string;
  title: string;
  entityCount: number;
  relationCount: number;
  stateMachineCount: number;
  habitCount: number;
  autonomyCount: number;
}

export interface AgentPresetState {
  activePresetName: string | null;
}

export interface AgentPresetFileRecord {
  name: string;
  path: string;
  content: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface AgentParsedPresetDocument extends AgentPresetFileRecord {
  card: AgentPersonaPreset;
}

export interface AgentPresetSnapshotItem {
  name: string;
  title: string;
  sizeBytes: number;
  updatedAt: string;
  active: boolean;
  card?: AgentPersonaPreset;
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
  worldPackages: AgentPresetWorldPackageDescriptor[];
  operation?: AgentPresetOperationResult;
}

export interface AgentPresetPromptExample {
  situation: string;
  reply: string;
}

export interface AgentPresetPromptLoreEntry {
  title: string;
  content: string;
}

export interface AgentRoleplayPresetContext {
  enabled: boolean;
  activePresetName: string | null;
  card?: {
    title: string;
    corePersona: string;
    languageStyle: string;
    examples: AgentPresetPromptExample[];
    lore: AgentPresetPromptLoreEntry[];
  };
}

export const EmptyAgentRoleplayPresetContext: AgentRoleplayPresetContext = {
  enabled: false,
  activePresetName: null,
};
