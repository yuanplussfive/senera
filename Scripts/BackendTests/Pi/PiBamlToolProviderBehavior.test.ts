import type { AssistantMessageEvent, Context } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import { AgentModelUsageLedger } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import { AgentPiMutableSessionFrame } from "../../../Source/AgentSystem/Pi/AgentPiCodingAgentSessionFrame.js";
import { projectSeneraModelProviderToPi } from "../../../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import { AgentPiBamlToolProvider } from "../../../Source/AgentSystem/Pi/AgentPiBamlToolProvider.js";
import type { AgentPiPlanningCompilerFactory } from "../../../Source/AgentSystem/Pi/AgentPiPlanningCompiler.js";
import { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import { AgentPiToolPlanCoordinator } from "../../../Source/AgentSystem/PiShared/AgentPiToolPlanCoordinator.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { emptyAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";

describe("Senera BAML tool provider", () => {
  test("emits a valid assistant stream and registers the tool batch before completion", async () => {
    const modelProvider = createModelProvider({ MaxModelOutputTokens: 1_024 });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model);
    const frame = new AgentPiMutableSessionFrame({
      sessionId: "native-provider-session",
      requestId: "native-provider-request",
      step: 1,
      turnState,
      skillCatalogFingerprint: "test",
      toolAccessGrant: turnState.context.toolAccessGrant,
      toolExposure: turnState.context.toolExposure,
      selectedPromptTemplates: [],
      tokenBudget: turnState.context.tokenBudget,
      preflight: async () => undefined,
    });
    const compilerFactory: AgentPiPlanningCompilerFactory = {
      create: () => ({
        compile: async () => ({
          kind: "tool_calls",
          content: "Inspecting the workspace.",
          toolCalls: [{ id: "call-native", name: "WorkspaceRead", arguments: { path: "package.json" } }],
        }),
        summarize: async () => "unused",
      }),
    };
    const provider = new AgentPiBamlToolProvider({ projection, frame, compilerFactory }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the Senera native model.");
    const context: Context = {
      messages: [{ role: "user", content: "Inspect the workspace.", timestamp: 1 }],
      tools: [],
    };

    const events: AssistantMessageEvent[] = [];
    for await (const event of provider.streamSimple(model, context)) events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      "start",
      "text_start",
      "text_delta",
      "text_end",
      "toolcall_start",
      "toolcall_delta",
      "toolcall_end",
      "done",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "done",
      reason: "toolUse",
      message: {
        api: "senera-planning",
        provider: "senera",
        stopReason: "toolUse",
      },
    });
    expect(turnState.toolBatchId("call-native")).toEqual(expect.stringMatching(/^toolbatch_/u));
  });
});

function createTurnState(model: string): AgentPiTurnState {
  const toolAccessGrant = emptyAgentToolAccessGrant();
  return new AgentPiTurnState({
    approvalMode: "agent",
    sessionId: "native-provider-session",
    requestId: "native-provider-request",
    step: 1,
    toolAccessGrant,
    toolExposure: new AgentToolExposureState(toolAccessGrant),
    activeSkills: [],
    usageLedger: new AgentModelUsageLedger(),
    toolPlan: new AgentPiToolPlanCoordinator(),
    tokenBudget: new AgentTurnTokenBudget({
      model,
      contextWindowTokens: 16_384,
      outputReserveTokens: 1_024,
    }),
  });
}
