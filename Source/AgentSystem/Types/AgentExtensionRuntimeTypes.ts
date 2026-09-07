export const AgentExtensionOwnerKinds = {
  System: "system",
  Mcp: "mcp",
} as const;

export type AgentExtensionOwnerKind = (typeof AgentExtensionOwnerKinds)[keyof typeof AgentExtensionOwnerKinds];

export interface AgentExtensionOwner {
  readonly kind: AgentExtensionOwnerKind;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly rootPath: string;
  readonly revision: string;
  readonly priority?: number;
  readonly trusted: boolean;
  readonly requiresApproval: boolean;
}
