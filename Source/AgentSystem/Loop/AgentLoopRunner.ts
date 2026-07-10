import type { AgentCompletedRunResult } from "../Runtime/AgentExecutionProjector.js";
import type { AgentRunRequest } from "./AgentLoop.js";

export interface AgentLoopRunner {
  run(request: AgentRunRequest): Promise<AgentCompletedRunResult>;
}
