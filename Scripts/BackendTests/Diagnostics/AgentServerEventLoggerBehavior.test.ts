import { describe, expect, test, vi } from "vitest";
import type { AgentEventEnvelope } from "../../../Source/AgentSystem/Events/AgentEventBase.js";
import { AgentEventKinds } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentServerEventLogger } from "../../../Source/AgentSystem/Diagnostics/AgentServerEventLogger.js";
import type { AgentLogger } from "../../../Source/AgentSystem/Diagnostics/AgentLogger.js";

describe("server event logger", () => {
  test("does not print MCP settings snapshots as runtime event logs", () => {
    const event = vi.fn();
    const tree = vi.fn();
    const logger = { event, tree } as unknown as AgentLogger;
    const envelope = {
      channel: "agent.event",
      kind: AgentEventKinds.McpServerSnapshot,
      layer: "snapshot",
      phase: "settings",
      sequence: 1,
      timestamp: new Date().toISOString(),
      data: { servers: [], activation: { entries: [] } },
    } as unknown as AgentEventEnvelope;

    new AgentServerEventLogger({ logger, detail: "verbose" }).event(envelope);

    expect(event).not.toHaveBeenCalled();
    expect(tree).not.toHaveBeenCalled();
  });

  test("still prints operational failures", () => {
    const event = vi.fn();
    const tree = vi.fn();
    const logger = { event, tree } as unknown as AgentLogger;
    const envelope = {
      channel: "agent.event",
      kind: AgentEventKinds.RequestInvalid,
      layer: "error",
      phase: "request",
      sequence: 1,
      timestamp: new Date().toISOString(),
      data: { message: "invalid request" },
    } as unknown as AgentEventEnvelope;

    new AgentServerEventLogger({ logger, detail: "verbose" }).event(envelope);

    expect(event).toHaveBeenCalledWith(envelope);
    expect(tree).toHaveBeenCalledWith("request.invalid payload", envelope.data);
  });
});
