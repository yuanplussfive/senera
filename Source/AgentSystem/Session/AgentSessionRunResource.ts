import type { AgentLifecycleResource } from "../Core/AgentLifecycleResource.js";

export interface AgentSessionRunResourceReleaseContext {
  readonly sessionId: string;
  readonly requestId: string;
}

export type AgentSessionRunResource = AgentLifecycleResource<AgentSessionRunResourceReleaseContext>;

export interface AgentRequestCancellationRuntime {
  cancelByRequestId(requestId: string): Promise<unknown>;
}

export function createAgentRequestCancellationResource(
  id: string,
  runtime: AgentRequestCancellationRuntime,
): AgentSessionRunResource {
  return {
    id,
    release: ({ requestId }) => runtime.cancelByRequestId(requestId),
  };
}
