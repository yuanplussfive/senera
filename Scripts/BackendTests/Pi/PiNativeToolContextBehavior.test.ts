import { createInitialSystemMessage, type Context } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import { AgentPiNativeToolBridgeName } from "../../../Source/AgentSystem/Pi/AgentPiNativeToolBridge.js";
import { AgentResidentSpeechNativeClient } from "../../../Source/AgentSystem/ResidentSpeech/AgentResidentSpeechNativeClient.js";
import { projectAgentResidentSpeechNativeContinuation } from "../../../Source/AgentSystem/ResidentSpeech/AgentResidentSpeechPromptProjector.js";
import type { RegisteredSidecarTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";

function tool(name: string) {
  return {
    name,
    description: `${name} test tool`,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  } as const;
}

describe("Pi native tool context projection", () => {
  test("resolves the bridge from a normalized transcript for resident speech", () => {
    const selectedTools = [tool("ToolSearch"), tool(AgentPiNativeToolBridgeName)];
    const systemMessage = createInitialSystemMessage("system", selectedTools);
    if (!systemMessage) throw new Error("Expected a system message for the test context.");

    const context: Context = {
      messages: [systemMessage, { role: "user", content: "continue", timestamp: 1 }],
    };
    const projected = projectAgentResidentSpeechNativeContinuation({
      context,
      contract: {
        owner: {} as RegisteredSidecarTool["owner"],
        name: "ResidentActionSpeak",
        capability: "resident-speech.action",
        description: "Speak the action preface.",
        instructions: "Return one short action preface.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        outputSchema: { type: "object", properties: {}, additionalProperties: false },
        presentation: {
          category: "resident-speech",
          icon: "message-question",
          group: { id: "resident-speech", title: { "zh-CN": "角色表达", "en-US": "Resident expression" } },
          activity: { action: { "zh-CN": "生成角色发言", "en-US": "Project resident speech" } },
          preview: { body: { pointer: "", from: "result" } },
        },
      },
      focus: { mode: "action_preface", draft: "checking", actions: [] },
      spokenUtterances: [],
      bridgeName: AgentPiNativeToolBridgeName,
      timestamp: 2,
    });

    expect(projected.tools).toEqual([selectedTools[1]]);
    expect(projected.messages).toHaveLength(3);
  });

  test("accepts a normalized transcript at the native resident speech client boundary", async () => {
    const selectedTools = [tool("ToolSearch"), tool(AgentPiNativeToolBridgeName)];
    const systemMessage = createInitialSystemMessage("system", selectedTools);
    if (!systemMessage) throw new Error("Expected a system message for the test context.");

    const context: Context = {
      messages: [systemMessage, { role: "user", content: "continue", timestamp: 1 }],
    };
    const controller = new AbortController();
    controller.abort(new Error("stop before provider execution"));

    const client = new AgentResidentSpeechNativeClient(
      createModelProvider({ ToolPlanningMode: "native", Capabilities: { ToolCalling: true } }),
    );
    await expect(
      client.project({
        context,
        continuation: {
          stream: () => {
            throw new Error("The provider must not be reached after cancellation.");
          },
        },
        signal: controller.signal,
        sessionId: "normalized-resident-speech",
      }),
    ).rejects.toThrow("stop before provider execution");
  });
});
