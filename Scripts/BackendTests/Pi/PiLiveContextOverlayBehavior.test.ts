import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, test } from "vitest";
import {
  AgentPiLiveContextElementName,
  AgentPiLiveContextCustomType,
  AgentPiTurnContextCustomType,
  AgentPiTurnContextElementName,
  isAgentPiContextOverlayWireContent,
  projectAgentPiLiveContextMessage,
  projectAgentPiProviderLiveContext,
  stripAgentPiContextOverlayMessages,
} from "../../../Source/AgentSystem/Pi/AgentPiTurnContextMessage.js";
import { AgentModelTokenEstimator } from "../../../Source/AgentSystem/Text/AgentTextBudget.js";

describe("Pi live context overlay", () => {
  test("replaces persisted legacy snapshots with one current request-local overlay", () => {
    const historicalMessages: AgentMessage[] = [
      userMessage("Earlier user task."),
      legacyOverlay("legacy one", "A".repeat(4_000)),
      assistantMessage("Earlier answer."),
      userMessage("Current user task."),
      legacyOverlay("legacy two", "B".repeat(4_000)),
      assistantMessage("A tool is being considered."),
    ];
    const liveOverlay = projectAgentPiLiveContextMessage({
      liveContext: 'senera.live_state=v1\n[senera.scene] encoding=compact-json\n{"activity":"current"}',
      skills: [],
      selectedPromptTemplates: [],
    });
    expect(liveOverlay).toBeDefined();

    const projected = projectAgentPiProviderLiveContext(historicalMessages, liveOverlay);
    const texts = projected.map(messageText);
    const combined = texts.join("\n");
    const currentUserIndex = texts.indexOf("Current user task.");
    const overlayIndex = texts.findIndex((text) => text.includes(`<${AgentPiLiveContextElementName}`));

    expect(projected).toHaveLength(historicalMessages.length - 1);
    expect(combined).not.toContain(`<${AgentPiTurnContextElementName}`);
    expect(combined).toContain("Earlier user task.");
    expect(combined).toContain("Earlier answer.");
    expect(combined).toContain("Current user task.");
    expect(combined).toContain("A tool is being considered.");
    expect(overlayIndex).toBe(currentUserIndex + 1);
    expect(texts.filter((text) => text.includes(`<${AgentPiLiveContextElementName}`))).toHaveLength(1);

    const estimator = new AgentModelTokenEstimator({ model: "gpt-5.6-luna" });
    const durableTokens = estimator.estimate(historicalMessages.map(messageText).join("\n")).tokenCount;
    const projectedTokens = estimator.estimate(projected.map(messageText).join("\n")).tokenCount;
    expect(projectedTokens).toBeLessThan(durableTokens);
    expect(durableTokens - projectedTokens).toBeGreaterThan(1_000);
  });

  test("recognizes both generations of host-owned overlay for sidecar lineage filtering", () => {
    expect(isAgentPiContextOverlayWireContent(`<${AgentPiTurnContextElementName} attribution="root">`)).toBe(true);
    expect(isAgentPiContextOverlayWireContent(`<${AgentPiLiveContextElementName} attribution="root">`)).toBe(true);
    expect(isAgentPiContextOverlayWireContent("ordinary user text")).toBe(false);
  });

  test("does not strip a user message that merely quotes the host tag", () => {
    const quotedTag = `<${AgentPiLiveContextElementName}>quoted by the user</${AgentPiLiveContextElementName}>`;

    expect(stripAgentPiContextOverlayMessages([userMessage(quotedTag)])).toEqual([userMessage(quotedTag)]);
  });

  test("strips overlays from runtime state without deleting durable transcript messages", () => {
    const messages: AgentMessage[] = [
      userMessage("Earlier user task."),
      legacyOverlay("legacy", "payload"),
      projectAgentPiLiveContextMessage({
        liveContext: "senera.live_state=v1",
        skills: [],
        selectedPromptTemplates: [],
      })!,
      assistantMessage("Earlier answer."),
    ];

    expect(stripAgentPiContextOverlayMessages(messages).map(messageText)).toEqual([
      "Earlier user task.",
      "Earlier answer.",
    ]);
    expect(messages).toHaveLength(4);
    expect(messages[2]).toMatchObject({ role: "custom", customType: AgentPiLiveContextCustomType });
  });
});

function userMessage(text: string): Extract<AgentMessage, { role: "user" }> {
  return { role: "user", content: [{ type: "text", text }], timestamp: 1 };
}

function assistantMessage(text: string): Extract<AgentMessage, { role: "assistant" }> {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}

function legacyOverlay(label: string, payload: string): Extract<AgentMessage, { role: "custom" }> {
  return {
    role: "custom",
    customType: AgentPiTurnContextCustomType,
    content: `<${AgentPiTurnContextElementName} attribution="root">${label}:${payload}</${AgentPiTurnContextElementName}>`,
    display: false,
    timestamp: 1,
  };
}

function messageText(message: AgentMessage): string {
  if (!("content" in message)) return "";
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}
