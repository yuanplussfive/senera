import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";

export function testPiAssistantMessage(
  content: AssistantMessage["content"],
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: "assistant",
    api: "openai-completions",
    provider: "test-endpoint",
    model: "test-model",
    content,
    stopReason: "stop",
    timestamp: Date.now(),
    usage: {
      input: 2,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    ...overrides,
  };
}

export function completedTestPiStream(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    stream.push({ type: "error", reason: message.stopReason, error: message });
  } else {
    if (message.stopReason === "pending") throw new Error("Test completion must be terminal.");
    stream.push({ type: "done", reason: message.stopReason, message });
  }
  return stream;
}
