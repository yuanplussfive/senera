import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { SessionManager, type AgentSession as CodingAgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, test, vi } from "vitest";
import { AgentPiCodingAgentSession } from "../../../Source/AgentSystem/Pi/AgentPiCodingAgentSession.js";
import {
  hasIncompatibleAgentPiToolObservationHistory,
  isAgentPiConversationHistoryEmpty,
  isAgentPiSessionRuntimeContractCurrent,
  stampAgentPiSessionRuntimeContract,
} from "../../../Source/AgentSystem/Pi/AgentPiSessionHistoryPolicy.js";
import { compilePiToolObservation, piToolResultMessage } from "../Support/PiToolObservationFixtures.js";

describe("Pi Coding Agent history import", () => {
  test("treats runtime metadata as an empty conversation", () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendModelChange("test-provider", "test-model");
    sessionManager.appendThinkingLevelChange("off");
    sessionManager.appendCustomEntry("test.runtime_metadata", { initialized: true });

    expect(isAgentPiConversationHistoryEmpty(sessionManager)).toBe(true);

    const state = { messages: [] as AgentMessage[] };
    const session = new AgentPiCodingAgentSession(codingSession(state), sessionManager, vi.fn());
    session.setHistory([historicalUserMessage()]);

    expect(state.messages).toEqual([historicalUserMessage()]);
    expect(sessionManager.buildSessionContext().messages).toEqual([historicalUserMessage()]);
    expect(isAgentPiConversationHistoryEmpty(sessionManager)).toBe(false);
  });

  test("rejects an import once conversational history exists", () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendCustomMessageEntry("test.context", "Existing context", false);
    const session = new AgentPiCodingAgentSession(codingSession({ messages: [] }), sessionManager, vi.fn());

    expect(isAgentPiConversationHistoryEmpty(sessionManager)).toBe(false);
    expect(() => session.setHistory([historicalUserMessage()])).toThrow(
      "Pi Coding Agent history can only be imported into an empty session.",
    );
  });

  test("stamps the active observation contract without adding model-visible history", () => {
    const sessionManager = SessionManager.inMemory();

    stampAgentPiSessionRuntimeContract(sessionManager);

    expect(isAgentPiSessionRuntimeContractCurrent(sessionManager)).toBe(true);
    expect(isAgentPiConversationHistoryEmpty(sessionManager)).toBe(true);
  });

  test("distinguishes bounded observations from incompatible pre-contract history", () => {
    const bounded = SessionManager.inMemory();
    bounded.appendMessage(
      piToolResultMessage(compilePiToolObservation()) as Parameters<SessionManager["appendMessage"]>[0],
    );
    const incompatible = SessionManager.inMemory();
    incompatible.appendMessage({
      role: "toolResult",
      toolCallId: "call-legacy",
      toolName: "LegacyTool",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            type: "senera.tool_observation.v1",
            tool_name: "LegacyTool",
            call_id: "call-legacy",
            result: { value: "unbounded" },
          }),
        },
      ],
      isError: false,
      timestamp: Date.now(),
    });

    expect(hasIncompatibleAgentPiToolObservationHistory(bounded)).toBe(false);
    expect(hasIncompatibleAgentPiToolObservationHistory(incompatible)).toBe(true);
  });
});

function codingSession(state: { messages: AgentMessage[] }): CodingAgentSession {
  return { agent: { state } } as unknown as CodingAgentSession;
}

function historicalUserMessage(): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text: "Earlier request" }],
    timestamp: Date.parse("2026-01-01T00:00:00.000Z"),
  };
}
