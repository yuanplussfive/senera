import { describe, expect, test } from "vitest";
import { queryAgentSelfLogs } from "../../../Source/AgentSystem/SelfService/AgentSelfLogs.js";
import type { AgentSelfServicePort } from "../../../Source/AgentSystem/SelfService/AgentSelfServiceTypes.js";

describe("self-service logs diagnostics", () => {
  test("does not report an invalid policy as an intentionally disabled store", () => {
    const port = {
      logs: {
        health: () => ({
          enabled: false,
          root: "C:/workspace/.senera/logs",
          projectionPath: "C:/workspace/.senera/logs/events.jsonl",
          detailRoot: "C:/workspace/.senera/logs/details",
          projectionFiles: 0,
          projectionBytes: 0,
          detailFiles: 0,
          lastError: "日志策略无效: detailMaxBytes",
        }),
        query: () => ({ items: [], hasMore: false, scanned: 0 }),
      },
    } as unknown as AgentSelfServicePort;

    expect(queryAgentSelfLogs(port, {})).toMatchObject({
      ok: false,
      error: "logs_degraded",
      text: expect.stringContaining("日志策略无效"),
    });
  });
});
