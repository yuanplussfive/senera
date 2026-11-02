import type { AgentTerminalResult } from "../Runtime/AgentExecutionProjector.js";

export function terminalText(terminal: AgentTerminalResult): string {
  return terminal.content;
}
