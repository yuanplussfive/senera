import type { AgentTerminalResult } from "../Runtime/AgentExecutionProjector.js";

export function terminalText(terminal: AgentTerminalResult): string {
  return terminal.kind === "FinalAnswer" ? terminal.content : terminal.question;
}
