import { describe, expect, it } from "vitest";
import type { ModelProviderListItem, ModelProviderMetadata } from "../../api/eventTypes";
import {
  isTerminalAssistantMessageForRun,
  readAssistantDisplayContent,
  readAssistantDisplayName,
  readRunDisplayName,
} from "./messagePresentation";

const selectedProvider = {
  id: "selected",
  title: "Selected Model",
  icon: "selected.svg",
  kind: "openai",
  endpoint: "selected",
  baseUrl: "https://example.test",
  model: "selected-1",
  isDefault: true,
} satisfies ModelProviderListItem;

const runProvider = {
  id: "run",
  title: "Run Model",
  kind: "openai",
  endpoint: "run",
  baseUrl: "https://example.test",
  model: "run-1",
} satisfies ModelProviderMetadata;

describe("readAssistantDisplayName", () => {
  it("prefers the provider captured in message metadata", () => {
    expect(readAssistantDisplayName({ metadata: { run: { modelProvider: runProvider } } }, selectedProvider)).toBe(
      "Run Model · run-1",
    );
  });

  it("falls back to the selected provider when message metadata has no provider", () => {
    expect(readAssistantDisplayName({}, selectedProvider)).toBe("Selected Model · selected-1");
  });

  it("uses the assistant fallback when no provider is available", () => {
    expect(readAssistantDisplayName({})).toBe("AI 助手");
  });
});

describe("readRunDisplayName", () => {
  it("prefers the provider captured on the run", () => {
    expect(readRunDisplayName({ modelProvider: runProvider }, selectedProvider)).toBe("Run Model · run-1");
  });

  it("falls back to the selected provider when the run has no provider", () => {
    expect(readRunDisplayName({}, selectedProvider)).toBe("Selected Model · selected-1");
  });

  it("uses the assistant fallback when no provider is available", () => {
    expect(readRunDisplayName({})).toBe("AI 助手");
  });
});

describe("readAssistantDisplayContent", () => {
  it("uses display text while the final answer target is still pending", () => {
    expect(readAssistantDisplayContent(
      {
        content: "完整回复",
        kind: "FinalAnswer",
        requestId: "req-1",
      },
      {
        requestId: "req-1",
        visibleText: "完整回复",
        displayText: "完整",
      },
    )).toBe("完整");
  });

  it("falls back to persisted content after display catches up", () => {
    expect(readAssistantDisplayContent(
      {
        content: "完整回复",
        kind: "FinalAnswer",
        requestId: "req-1",
      },
      {
        requestId: "req-1",
        visibleText: "完整回复",
        displayText: "完整回复",
      },
    )).toBe("完整回复");
  });
});

describe("isTerminalAssistantMessageForRun", () => {
  it("detects the final assistant message for a run", () => {
    expect(isTerminalAssistantMessageForRun(
      {
        role: "assistant",
        kind: "FinalAnswer",
        requestId: "req-1",
      },
      { requestId: "req-1" },
    )).toBe(true);
  });

  it("ignores non-terminal or unrelated messages", () => {
    expect(isTerminalAssistantMessageForRun(
      {
        role: "user",
        requestId: "req-1",
      },
      { requestId: "req-1" },
    )).toBe(false);
    expect(isTerminalAssistantMessageForRun(
      {
        role: "assistant",
        kind: "FinalAnswer",
        requestId: "req-2",
      },
      { requestId: "req-1" },
    )).toBe(false);
  });
});
