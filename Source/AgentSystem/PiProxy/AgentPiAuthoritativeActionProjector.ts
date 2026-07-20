import { TurnContextMode } from "../BamlClient/baml_client/types.js";
import type { ParsedPiControllerAction } from "./AgentPiAssistantMessageSchema.js";
import type { AgentPiControllerActionInput } from "./AgentPiAssistantMessageTypes.js";

export class AgentPiAuthoritativeActionProjector {
  project(options: {
    input: AgentPiControllerActionInput;
    toolExecutionRequired: boolean;
  }): ParsedPiControllerAction | undefined {
    const runtime = options.input.seneraRuntime;
    if (runtime.rootCommand?.authority !== "senera_runtime_root") return undefined;
    if (runtime.rootCommand.action !== "answer" || options.toolExecutionRequired) return undefined;

    return {
      kind: "FinalAnswer",
      answerPlan: [projectAnswerObjective(runtime)],
    };
  }
}

function projectAnswerObjective(runtime: AgentPiControllerActionInput["seneraRuntime"]): string {
  const understanding = runtime.turnUnderstanding;
  if (understanding?.contextMode === TurnContextMode.Insufficient) {
    return `Ask the user for the missing context before attempting the request: ${understanding.missingContext}`;
  }
  return (
    runtime.interactionRoute?.objective ||
    understanding?.standaloneRequest ||
    runtime.rootCommand?.objective ||
    "Answer the latest user request from the supplied conversation context."
  );
}
