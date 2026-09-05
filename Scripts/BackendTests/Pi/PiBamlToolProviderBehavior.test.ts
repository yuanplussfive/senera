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
      nativeProviderToolNames: [],
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
          toolCalls: [
            {
              id: "call-native",
              name: "WorkspaceRead",
              arguments: { path: "package.json" },
              purpose: "Read the package metadata.",
            },
          ],
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
    expect(turnState.toolCallPurpose("call-native")).toBe("Read the package metadata.");
  });

  test("projects the BAML preface atomically and fails closed when projection is unavailable", async () => {
    const modelProvider = createModelProvider({ MaxModelOutputTokens: 1_024 });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model);
    const frame = new AgentPiMutableSessionFrame({
      sessionId: "baml-roleplay-session",
      requestId: "baml-roleplay-request",
      step: 1,
      turnState,
      roleplayPresetActive: true,
      prefaceRewriteEnabled: true,
      skillCatalogFingerprint: "test",
      nativeProviderToolNames: [],
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
          toolCalls: [
            {
              id: "call-roleplay",
              name: "WorkspaceRead",
              arguments: { path: "package.json" },
              purpose: "Read the package metadata.",
            },
          ],
        }),
        summarize: async () => "unused",
      }),
    };
    const provider = new AgentPiBamlToolProvider({
      projection,
      frame,
      compilerFactory,
      residentSpeech: {
        project: async () => {
          throw new Error("Resident speech model rejected the request.");
        },
      },
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the Senera BAML model.");

    const result = await provider
      .streamSimple(model, {
        messages: [{ role: "user", content: "Inspect the workspace.", timestamp: 1 }],
        tools: [],
      })
      .result();

    expect(result).toMatchObject({
      stopReason: "error",
      errorMessage: "Resident speech model rejected the request.",
    });
    expect(turnState.toolBatchId("call-roleplay")).toBeUndefined();
  });

  test("projects a BAML final response only after this turn has registered tool work", async () => {
    const modelProvider = createModelProvider({ MaxModelOutputTokens: 1_024 });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model);
    const frame = new AgentPiMutableSessionFrame({
      sessionId: "baml-roleplay-final-session",
      requestId: "baml-roleplay-final-request",
      step: 1,
      turnState,
      roleplayPresetActive: true,
      skillCatalogFingerprint: "test",
      nativeProviderToolNames: [],
      toolAccessGrant: turnState.context.toolAccessGrant,
      toolExposure: turnState.context.toolExposure,
      selectedPromptTemplates: [],
      tokenBudget: turnState.context.tokenBudget,
      preflight: async () => undefined,
    });
    const compilerFactory: AgentPiPlanningCompilerFactory = {
      create: () => ({
        compile: async () => ({
          kind: "final_text",
          content: "I finished the illustration today.",
          toolCalls: [],
        }),
        summarize: async () => "unused",
      }),
    };
    const projectionInputs: unknown[] = [];
    const provider = new AgentPiBamlToolProvider({
      projection,
      frame,
      compilerFactory,
      residentSpeech: {
        project: async (input) => {
          projectionInputs.push(input);
          return {
            ...input.message,
            content: [{ type: "text", text: "画完啦，手都酸了TvT" }],
          };
        },
      },
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the Senera BAML model.");

    const directResult = await provider
      .streamSimple(model, {
        messages: [{ role: "user", content: "今天画完了吗？", timestamp: 1 }],
        tools: [],
      })
      .result();
    expect(directResult.content).toEqual([{ type: "text", text: "I finished the illustration today." }]);
    expect(projectionInputs).toHaveLength(0);

    turnState.registerToolBatch("prior-tool-batch", [
      { toolCallId: "prior-tool-call", toolName: "WorkspaceRead", input: { path: "drawing.png" } },
    ]);
    turnState.recordResidentSpeech({ mode: "action_preface", content: "我去看一眼呀。" });

    const result = await provider
      .streamSimple(model, {
        messages: [{ role: "user", content: "结果呢？", timestamp: 2 }],
        tools: [],
      })
      .result();

    expect(result).toMatchObject({
      stopReason: "stop",
      content: [{ type: "text", text: "画完啦，手都酸了TvT" }],
    });
    expect(projectionInputs).toEqual([
      expect.objectContaining({
        focus: expect.objectContaining({ mode: "final_response" }),
        spokenUtterances: [{ mode: "action_preface", content: "我去看一眼呀。" }],
      }),
    ]);
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
