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
    let releasePreparation!: () => void;
    const preparation = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    const frame = new AgentPiMutableSessionFrame({
      sessionId: "native-provider-session",
      requestId: "native-provider-request",
      step: 1,
      turnState,
      skillCatalog: { skills: [], fingerprint: "test" },
      nativeProviderToolNames: [],
      toolAccessGrant: turnState.context.toolAccessGrant,
      toolExposure: turnState.context.toolExposure,
      selectedPromptTemplates: [],
      tokenBudget: turnState.context.tokenBudget,
      preflight: async () => undefined,
      prepareModelInput: async (context) => {
        await preparation;
        return context;
      },
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
    const response = provider.streamSimple(model, context);
    releasePreparation();
    for await (const event of response) {
      events.push(event);
      if (event.type === "start") {
        // The same request identity and its prepared input are ready together.
        expect(turnState.claimModelMessageIndex()).toBe(0);
        expect(await turnState.modelContexts.get(0)).toMatchObject({
          scope: "baml-input",
          sections: [expect.objectContaining({ category: "user" })],
        });
      }
    }

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

  test("passes Pi's native compaction context to BAML without Senera projection", async () => {
    const modelProvider = createModelProvider({
      MaxModelOutputTokens: 1_024,
      ContextWindowTokens: 1_200,
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model, 1_200, 0);
    const frame = new AgentPiMutableSessionFrame({
      sessionId: "baml-compaction-session",
      requestId: "baml-compaction-request",
      step: 1,
      turnState,
      skillCatalog: { skills: [], fingerprint: "test" },
      nativeProviderToolNames: [],
      toolAccessGrant: turnState.context.toolAccessGrant,
      toolExposure: turnState.context.toolExposure,
      selectedPromptTemplates: [],
      tokenBudget: turnState.context.tokenBudget,
      preflight: async () => undefined,
    });
    let receivedContext: Context | undefined;
    let failAfterUsage = false;
    const compilerFactory: AgentPiPlanningCompilerFactory = {
      create: ({ usageSink } = {}) => ({
        compile: async () => {
          throw new Error("Pi compaction must not enter the regular BAML planner.");
        },
        compact: async (input) => {
          receivedContext = input.context;
          usageSink?.({
            stage: "summary",
            usage: {
              source: "provider_reported",
              inputTokens: 100,
              outputTokens: 10,
              totalTokens: 110,
              cost: { currency: "USD", total: 0.002 },
            },
          });
          usageSink?.({
            stage: "summary",
            usage: {
              source: "provider_reported",
              inputTokens: 200,
              outputTokens: 10,
              totalTokens: 210,
              cost: { currency: "USD", total: 0.003 },
            },
          });
          if (failAfterUsage) throw new Error("Provider failed after reporting usage.");
          return "Summary created.";
        },
        summarize: async () => "unused",
      }),
    };
    const provider = new AgentPiBamlToolProvider({ projection, frame, compilerFactory }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the Senera BAML model.");

    const result = await provider
      .streamSimple(
        model,
        {
          systemPrompt: "You are a context summarization assistant.",
          messages: [
            {
              role: "user",
              content: `<conversation>\n[User]: ${"large historical text ".repeat(1_500)}\n</conversation>\n\nSummarize the history.`,
              timestamp: 1,
            },
          ],
          tools: [
            {
              name: "WorkspaceRead",
              description: "Read a workspace file.",
              parameters: { type: "object", properties: {} },
            } as never,
          ],
        },
        { cacheRetention: "none" },
      )
      .result();

    expect(result.stopReason).toBe("stop");
    expect(result.usage.cost.total).toBeCloseTo(0.005);
    expect(turnState.context.usageLedger.aggregate()?.cost?.total).toBeCloseTo(0.005);
    expect(receivedContext?.tools).toBeUndefined();
    expect(receivedContext?.messages[0]?.role).toBe("system");
    expect(JSON.stringify(receivedContext)).toContain("WorkspaceRead");
    expect(JSON.stringify(receivedContext)).toContain("large historical text");
    expect(JSON.stringify(receivedContext).length).toBeGreaterThan(10_000);
    failAfterUsage = true;
    const failed = await provider.streamSimple(model, { messages: [] }, { cacheRetention: "none" }).result();
    expect(failed.stopReason).toBe("error");
    expect(failed.usage.cost.total).toBeCloseTo(0.005);
    expect(failed.usage.totalTokens).toBe(320);
  });
});

function createTurnState(model: string, contextWindow = 16_384, outputReserve = 1_024): AgentPiTurnState {
  const toolAccessGrant = emptyAgentToolAccessGrant();
  return new AgentPiTurnState({
    systemPrompt: "Test agent system context.",
    userMessage: "Test model-provider request.",
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
      contextWindowTokens: contextWindow,
      outputReserveTokens: outputReserve,
    }),
  });
}
