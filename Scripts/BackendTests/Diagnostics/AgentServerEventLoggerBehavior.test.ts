import { describe, expect, test } from "vitest";
import { AgentLogger, type AgentLoggerRecord } from "../../../Source/AgentSystem/Diagnostics/AgentLogger.js";
import { AgentServerEventLogger } from "../../../Source/AgentSystem/Diagnostics/AgentServerEventLogger.js";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
} from "../../../Source/AgentSystem/Events/AgentEvent.js";

describe("agent server event logger", () => {
  test("persists compact-hidden events without printing them", () => {
    const records: AgentLoggerRecord[] = [];
    const logger = new AgentLogger({
      output: process.stdout,
      sink: { append: (record) => records.push(record) },
    });
    const eventLogger = new AgentServerEventLogger({ logger, detail: "compact", persistHiddenEvents: true });

    eventLogger.event({
      eventId: "event_hidden",
      channel: AgentEventChannels.AgentEvent,
      kind: AgentEventKinds.McpServerSnapshot,
      layer: AgentEventLayers.Snapshot,
      phase: AgentEventPhases.Tool,
      sequence: 1,
      timestamp: "2026-10-16T00:00:00.000Z",
      data: { server: "browser", apiKey: "secret" },
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      recordId: "event_hidden",
      kind: AgentEventKinds.McpServerSnapshot,
      details: { server: "browser", apiKey: "secret" },
    });
  });

  test("does not persist high-frequency hidden events unless enabled", () => {
    const records: AgentLoggerRecord[] = [];
    const logger = new AgentLogger({ sink: { append: (record) => records.push(record) } });
    const eventLogger = new AgentServerEventLogger({ logger, detail: "compact" });

    eventLogger.event({
      eventId: "event_delta",
      channel: AgentEventChannels.AgentEvent,
      kind: AgentEventKinds.ModelDelta,
      layer: AgentEventLayers.Progress,
      phase: AgentEventPhases.Model,
      sequence: 1,
      timestamp: "2026-10-16T00:00:00.000Z",
      data: { delta: "token" },
    });

    expect(records).toEqual([]);
  });
});
