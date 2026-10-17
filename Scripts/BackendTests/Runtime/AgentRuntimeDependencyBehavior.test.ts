import { describe, expect, test } from "vitest";
import {
  AgentRuntimeDependencyCatalog,
  findAgentRuntimeDependency,
} from "../../../Source/AgentSystem/Runtime/AgentRuntimeDependencyCatalog.js";
import { createAgentRuntimeDependencyLineBuffer } from "../../../Source/AgentSystem/Runtime/AgentRuntimeDependencyService.js";
import { AgentWebSocketRequestSchema } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketProtocol.js";
import {
  AgentWebSocketRequestLanes,
  inspectAgentWebSocketRequestScheduling,
} from "../../../Source/AgentSystem/WebSocket/AgentWebSocketRequestScheduler.js";

describe("runtime dependency management", () => {
  test("buffers split UTF-8 output until complete lines are available", () => {
    const buffer = createAgentRuntimeDependencyLineBuffer();
    const payload = Buffer.from('{"success":true,"message":"就绪"}\n{"success":false}\n', "utf8");
    const newline = payload.indexOf(0x0a);
    const split = Buffer.byteLength('{"success":true,"message":"', "utf8") + 1;

    expect(buffer.push(payload.subarray(0, split))).toEqual([]);
    expect(buffer.push(payload.subarray(split, newline + 1))).toEqual(['{"success":true,"message":"就绪"}']);
    expect(buffer.push(payload.subarray(newline + 1, payload.length - 1))).toEqual([]);
    expect(buffer.flush()).toEqual(['{"success":false}']);
  });

  test("exposes a unique declarative catalog with one managed install target", () => {
    const ids = AgentRuntimeDependencyCatalog.map((dependency) => dependency.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(AgentRuntimeDependencyCatalog.filter((dependency) => dependency.installable)).toEqual([
      expect.objectContaining({ id: "chromium", kind: "browser", installable: true, installCommand: ["install"] }),
    ]);
    expect(findAgentRuntimeDependency("agent-browser")).toMatchObject({ kind: "controller", installable: false });
    expect(findAgentRuntimeDependency("unknown")).toBeUndefined();
  });

  test("requires every installable dependency to declare a non-empty command", () => {
    for (const dependency of AgentRuntimeDependencyCatalog.filter((entry) => entry.installable)) {
      expect(dependency.installCommand?.length, dependency.id).toBeGreaterThan(0);
    }
  });

  test("accepts strict list/install requests and rejects unknown fields", () => {
    expect(AgentWebSocketRequestSchema.safeParse({ type: "runtimeDependency.list" }).success).toBe(true);
    expect(
      AgentWebSocketRequestSchema.safeParse({ type: "runtimeDependency.install", dependencyId: "chromium" }).success,
    ).toBe(true);
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "runtimeDependency.install",
        dependencyId: "chromium",
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  test("keeps read-only refreshes concurrent and serializes one install target", () => {
    expect(inspectAgentWebSocketRequestScheduling({ type: "runtimeDependency.list" })).toEqual({
      lane: AgentWebSocketRequestLanes.Concurrent,
    });
    expect(
      inspectAgentWebSocketRequestScheduling({ type: "runtimeDependency.install", dependencyId: "chromium" }),
    ).toEqual({
      lane: AgentWebSocketRequestLanes.Serial,
      key: "runtime-dependency:chromium",
    });
  });
});
