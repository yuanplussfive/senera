import { describe, expect, test } from "vitest";
import { AgentConversationPolicy } from "../../../Source/AgentSystem/Conversation/AgentConversationPolicy.js";
import { AgentConversationProjector } from "../../../Source/AgentSystem/Conversation/AgentConversationProjector.js";
import { AgentPiConversationProjector } from "../../../Source/AgentSystem/Pi/AgentPiConversationProjector.js";
import type { AgentPiModelProjection } from "../../../Source/AgentSystem/Pi/AgentPiTypes.js";

describe("Conversation sequence behavior", () => {
  test("preserves entry order while selecting the authoritative assistant", () => {
    const projector = new AgentConversationProjector();
    const entries = [
      projector.projectUserInput("request-active", "Start", timestamp(1)),
      projector.projectUserInput("request-steer", "Change direction", timestamp(2), {
        queue: { parentRequestId: "request-active", mode: "steer" },
      }),
      projector.projectAssistantDecision("request-active", "<draft/>", timestamp(3)),
      projector.projectUserInput("request-follow-up", "Continue afterwards", timestamp(4), {
        queue: { parentRequestId: "request-active", mode: "follow_up" },
      }),
      projector.projectAssistantDecision(
        "request-active",
        "<agent_result><final_answer>Done</final_answer></agent_result>",
        timestamp(5),
        { run: { modelProvider: modelProvider } },
      ),
    ];

    const policyMessages = new AgentConversationPolicy().materialize(entries);
    expect(policyMessages.map(({ role }) => role)).toEqual(["user", "user", "user", "assistant"]);
    expect(policyMessages.at(-1)?.content).toContain("<final_answer>Done</final_answer>");

    const piProjection = new AgentPiConversationProjector().project({
      requestId: "request-next",
      userInput: "Next",
      conversationEntries: entries,
      model,
    });
    expect(piProjection.history.map(({ role }) => role)).toEqual(["user", "user", "user", "assistant"]);
    expect(readText(piProjection.history[1])).toContain("request-steer");
    expect(readText(piProjection.history.at(-1))).toContain("<final_answer>Done</final_answer>");
  });

  test("uses the structural XML attachment projection for Pi input", () => {
    const projector = new AgentConversationProjector();
    const current = projector.projectUserInput("request-upload", "Inspect this file", timestamp(1), undefined, [
      {
        uploadUri: "senera://upload/upload-a",
        name: "report.txt",
        mime: "text/plain",
        size: 12,
        status: "uploaded",
      },
    ]);

    const projection = new AgentPiConversationProjector().project({
      requestId: current.requestId,
      userInput: current.content,
      conversationEntries: [current],
      model,
    });

    expect(projection.input).toContain("<current_user_message>");
    expect(projection.input).toContain("<uploadUri>senera://upload/upload-a</uploadUri>");
    expect(projection.input).not.toContain('"attachments"');
  });
});

const modelProvider = {
  id: "provider-a",
  kind: "OpenAICompatible",
  endpoint: "ChatCompletions",
  baseUrl: "https://model.example/v1",
  model: "model-a",
};

const model: AgentPiModelProjection = {
  id: "model-a",
  name: "Model A",
  api: "openai-completions",
  provider: "provider-a",
  baseUrl: "https://model.example/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192,
  maxTokens: 1_024,
};

function readText(message: unknown): string {
  if (!message || typeof message !== "object" || !("content" in message) || !Array.isArray(message.content)) {
    return "";
  }
  return message.content
    .flatMap((part) =>
      part && typeof part === "object" && "text" in part && typeof part.text === "string" ? [part.text] : [],
    )
    .join("");
}

function timestamp(offset: number): string {
  return new Date(Date.UTC(2026, 7, 2, 0, 0, offset)).toISOString();
}
