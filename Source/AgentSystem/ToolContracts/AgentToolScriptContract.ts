import { renderToolOutputType, renderToolSample } from "@earendil-works/pi-codemode";
import type { AgentToolCompositionDeclaration } from "../ToolRuntime/AgentToolComposition.js";
import { projectAgentToolModelOutputSchema } from "./AgentToolModelOutput.js";

/** Script calls receive the full business result; model observations honor the producer's output policy. */
export function renderAgentToolResultType(schema: Readonly<Record<string, unknown>> | undefined): string {
  return renderToolOutputType(schema ? projectAgentToolModelOutputSchema(schema) : undefined);
}

export function projectAgentToolScriptDeclaration(tool: AgentToolCompositionDeclaration) {
  return { ...tool, declaration: renderToolSample(tool) };
}
