import type { AgentLifecycleResource } from "../Core/AgentLifecycleResource.js";

export interface AgentSessionResourceReleaseContext {
  readonly sessionId: string;
}

export type AgentSessionResource = AgentLifecycleResource<AgentSessionResourceReleaseContext>;
