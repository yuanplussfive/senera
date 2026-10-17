export const AgentResourceReferenceOrigins = {
  Upload: "upload",
  Artifact: "artifact",
  Tool: "tool",
  Workspace: "workspace",
  Remote: "remote",
} as const;

export type AgentResourceReferenceOrigin =
  (typeof AgentResourceReferenceOrigins)[keyof typeof AgentResourceReferenceOrigins];

/**
 * A typed resource identity exposed to the agent and UI. It is deliberately a
 * locator and integrity record, never a host filesystem path or a send command.
 */
export interface AgentResourceReference {
  readonly uri: string;
  readonly name: string;
  readonly mime: string;
  readonly size?: number;
  readonly sha256?: string;
  readonly origin: AgentResourceReferenceOrigin;
}
