import type { PluginKind, PluginRootKind } from "./PluginManifestTypes.js";

export interface LoadedPluginConfig {
  fileName: string;
  path: string;
  exists: boolean;
  source: "file" | "example" | "default";
  templatePath?: string;
  templateExists: boolean;
  needsUserConfig: boolean;
  toml: string;
  sections: LoadedPluginConfigSection[];
  runtime: LoadedPluginRuntimeConfig;
  diagnostics: LoadedPluginConfigDiagnostic[];
}

export interface LoadedPluginConfigSection {
  name: string;
  label: string;
  description?: string;
  keyCount: number;
  toml: string;
  fields: LoadedPluginConfigField[];
}

export interface LoadedPluginConfigField {
  label: string;
  section: string;
  key: string;
  path: string[];
  type: LoadedPluginConfigFieldType;
  itemType?: LoadedPluginConfigFieldType;
  value: unknown;
  description?: string;
  placeholder?: string;
  options?: LoadedPluginConfigFieldOptionValue[];
  optionLabels?: Record<string, string>;
  min?: number;
  max?: number;
  step?: number;
  secret?: boolean;
  multiline?: boolean;
  required?: boolean;
}

export type LoadedPluginConfigFieldType = "boolean" | "string" | "number" | "array" | "table";

export type LoadedPluginConfigFieldOptionValue = string | number | boolean;

export interface LoadedPluginRuntimeConfig {
  enabled: boolean;
  tools: Record<string, LoadedPluginToolRuntimeConfig>;
}

export interface LoadedPluginToolRuntimeConfig {
  enabled?: boolean;
}

export interface LoadedPluginConfigDiagnostic {
  severity: "error" | "warning";
  message: string;
}

export interface AgentPluginConfigSnapshotItem {
  name: string;
  title: string;
  kind: PluginKind;
  rootKind: PluginRootKind;
  description?: string;
  rootPath: string;
  manifestPath: string;
  configPath: string;
  configExists: boolean;
  configSource: LoadedPluginConfig["source"];
  configTemplatePath?: string;
  configTemplateExists: boolean;
  needsUserConfig: boolean;
  enabled: boolean;
  available: boolean;
  toolCount: number;
  enabledToolCount: number;
  tools: AgentPluginConfigToolItem[];
  sections: LoadedPluginConfigSection[];
  toml: string;
  diagnostics: LoadedPluginConfigDiagnostic[];
}

export interface AgentPluginConfigToolItem {
  name: string;
  summary?: string;
  enabled: boolean;
}
