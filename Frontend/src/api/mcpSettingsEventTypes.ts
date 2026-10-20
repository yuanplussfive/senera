import type { FrontendLocalizedText } from "../i18n/frontendLocaleModel";
import type { AgentActivationCatalogSnapshot } from "../../../Source/AgentSystem/Activation/AgentActivationTypes";
import type { AgentPluginIdentityPresentation } from "../../../Source/AgentSystem/Types/AgentToolPresentationTypes";

export type McpInputValue = string | number | boolean | string[] | number[] | boolean[];

export interface McpInputStatus {
  id: string;
  title: string;
  description?: string;
  type: "string" | "number" | "boolean" | "filepath" | "directory";
  required: boolean;
  secret: boolean;
  multiple: boolean;
  configured: boolean;
  stored: boolean;
  source: "vault" | "configuration" | "environment" | "oauth" | "default" | "unresolved" | "missing";
  provenance: "mcpb" | "registry" | "legacy" | "connection";
  value?: McpInputValue;
  defaultValue?: McpInputValue;
  choices?: McpInputValue[];
  placeholder?: string;
  min?: number;
  max?: number;
  updatedAt?: string;
}

export interface McpServerSettingsItem {
  id: string;
  packageName: string;
  displayName: FrontendLocalizedText;
  description: FrontendLocalizedText;
  source: "bundled" | "workspace";
  descriptorKind: "mcpb" | "registry" | "legacy" | "connection";
  presentation?: AgentPluginIdentityPresentation;
  transport: "stdio" | "http";
  status: "configured" | "needs_input" | "unavailable";
  /** Effective activation state after configuration readiness is evaluated. */
  enabled: boolean;
  unavailableCapabilityDetails?: { id: string; reason?: string }[];
  inputs: McpInputStatus[];
}

export interface McpServerSnapshotData {
  servers: McpServerSettingsItem[];
  /** The live @ catalog after MCP configuration or availability changes. */
  activation: AgentActivationCatalogSnapshot;
  operation?: { requestId: string; kind: "mcp_input_update" };
}

export interface McpInputMutationState {
  requestId: string;
  status: "pending" | "success" | "error";
  message?: string;
}
