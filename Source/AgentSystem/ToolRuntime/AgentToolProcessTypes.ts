import type { AgentToolProcessResponse } from "../Types/ToolRuntimeTypes.js";
import type { SeneraOutputSpoolDescriptor } from "../Execution/SeneraOutputSpool.js";
export interface AgentToolProcessRunResult {
  response: AgentToolProcessResponse;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  outputCapture?: SeneraOutputSpoolDescriptor;
}
