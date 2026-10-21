import type { AgentExtensionInputDefinition } from "../Extensions/AgentExtensionInput.js";
import type { AgentExtensionValueBinding } from "../Extensions/AgentExtensionValueExpression.js";

export interface AgentMcpInputDefinition extends AgentExtensionInputDefinition {
  readonly binding: Exclude<AgentExtensionValueBinding, { readonly source: "runtime" }>;
  readonly provenance: "mcpb" | "registry" | "legacy" | "connection";
}
