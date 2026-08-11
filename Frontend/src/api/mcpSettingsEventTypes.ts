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
  source: "vault" | "configuration" | "environment" | "oauth" | "default" | "missing";
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
  source: "bundled" | "workspace";
  descriptorKind: "mcpb" | "registry" | "legacy" | "connection";
  transport: "stdio" | "http";
  status: "configured" | "needs_input";
  inputs: McpInputStatus[];
}

export interface McpServerSnapshotData {
  servers: McpServerSettingsItem[];
  operation?: { requestId: string; kind: "mcp_input_update" };
}

export interface McpInputMutationState {
  requestId: string;
  status: "pending" | "success" | "error";
  message?: string;
}
