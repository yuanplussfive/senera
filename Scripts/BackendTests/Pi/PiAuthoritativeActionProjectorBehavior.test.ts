import { describe, expect, test } from "vitest";
import { TurnContextMode } from "../../../Source/AgentSystem/BamlClient/baml_client/types.js";
import { AgentPiAuthoritativeActionProjector } from "../../../Source/AgentSystem/PiProxy/AgentPiAuthoritativeActionProjector.js";
import type { AgentPiControllerActionInput } from "../../../Source/AgentSystem/PiProxy/AgentPiAssistantMessageTypes.js";

describe("Pi authoritative action projection", () => {
  test("turns insufficient direct routes into a grounded clarification answer plan", () => {
    const action = new AgentPiAuthoritativeActionProjector().project({
      input: input({
        contextMode: TurnContextMode.Insufficient,
        contextBasis: "The referenced file is not present in the conversation.",
        missingContext: "the file to inspect",
      }),
      toolExecutionRequired: false,
    });

    expect(action).toEqual({
      kind: "FinalAnswer",
      answerPlan: ["Ask the user for the missing context before attempting the request: the file to inspect"],
    });
  });

  test("does not override tool routes or explicit tool requirements", () => {
    const projector = new AgentPiAuthoritativeActionProjector();
    expect(projector.project({ input: input(), toolExecutionRequired: true })).toBeUndefined();
    expect(
      projector.project({
        input: input({}, "use_tools"),
        toolExecutionRequired: false,
      }),
    ).toBeUndefined();
  });
});

function input(
  understanding: Partial<NonNullable<AgentPiControllerActionInput["seneraRuntime"]["turnUnderstanding"]>> = {},
  action: "answer" | "use_tools" = "answer",
): AgentPiControllerActionInput {
  return {
    openAiRequest: {
      model: "test-model",
      messages: [{ role: "user", content: "Continue." }],
      toolTranscript: [],
      stream: true,
      projection: {
        originalMessageCount: 1,
        projectedMessageCount: 1,
        omittedOlderMessages: 0,
        truncatedTextFields: 0,
        truncatedJsonFields: 0,
        planningInputTokenBudget: 8_192,
      },
    },
    candidateTools: [],
    seneraRuntime: {
      modelProviderId: "test-provider",
      model: "test-model",
      rootCommand: {
        authority: "senera_runtime_root",
        action,
        outputMode: "open",
        toolAccess: "restricted",
        objective: "Continue the request.",
        instruction: action === "use_tools" ? "Inspect first." : null,
        allowedTools: [],
        forbiddenOutputs: [],
        insufficiencyPolicy: "ask",
        preferredTools: [],
        toolSearchQueries: [],
        needs: [],
        includeToolCatalog: false,
        visibleOutput: {
          audience: "runtime",
          start: "",
          format: "text",
          rules: [],
          repair: { instruction: "", rules: [] },
        },
      },
      turnUnderstanding: {
        rawUserTurn: "Continue.",
        standaloneRequest: "Continue the request.",
        contextMode: TurnContextMode.None,
        contextBasis: "",
        missingContext: "",
        ...understanding,
      },
    },
  };
}
