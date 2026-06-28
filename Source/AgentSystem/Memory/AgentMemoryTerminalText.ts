import type { AgentTerminalResult } from "../AgentExecutionProjector.js";

export function terminalText(terminal: AgentTerminalResult): string {
  return terminal.kind === "FinalAnswer" ? terminal.content : terminal.question;
}
