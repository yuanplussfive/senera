import type { AgentCompletedRunResult } from "../Runtime/AgentExecutionProjector.js";
import type { AgentRunRequest } from "./AgentLoop.js";
import type { AgentModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";

export interface AgentLoopRunner {
  readonly preparationFingerprint?: string;
  /** Provider resolved by this runtime lease, before the first model call. */
  readonly modelProvider?: AgentModelProviderMetadata;
  run(request: AgentRunRequest): Promise<AgentCompletedRunResult>;
}
