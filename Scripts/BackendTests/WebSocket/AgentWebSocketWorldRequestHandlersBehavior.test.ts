import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, test, vi } from "vitest";
import type { AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentWebSocketRequestSchema } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketProtocol.js";
import { AgentWebSocketWorldRequestHandlers } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketWorldRequestHandlers.js";
import type { AgentWebSocketRequestContext } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketTypes.js";
import { projectAgentWorldTime } from "../../../Source/AgentSystem/World/AgentWorldTime.js";
import type { AgentWorldSnapshotProvider } from "../../../Source/AgentSystem/World/AgentWorldTypes.js";
import { projectChineseWorldCalendar } from "../../../Source/AgentSystem/World/AgentWorldCalendar.js";
import type { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";

describe("World WebSocket projection", () => {
  test("returns the same JSON-safe world snapshot supplied to the prompt", async () => {
    const instant = Temporal.Instant.from("2026-08-29T01:30:00Z");
    const worldRuntime = createWorldRuntime(instant);
    const send = vi.fn(async (_event: AgentDomainEvent) => undefined);
    const handlers = new AgentWebSocketWorldRequestHandlers({ worldRuntime } as AgentWebSocketRequestContext);

    await handlers.get({ type: "world.get" }, send);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "world.snapshot",
        context: {},
        data: {
          snapshot: expect.objectContaining({
            enabled: true,
            world: { id: "world_test", name: "Senera", timeZone: "Asia/Shanghai" },
            time: expect.objectContaining({ instant: "2026-08-29T01:30:00Z", phaseId: "day" }),
          }),
        },
      }),
    );
  });

  test("registers a read-only world request", () => {
    expect(AgentWebSocketRequestSchema.safeParse({ type: "world.get" }).success).toBe(true);
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "world.resident.wake",
        requestId: "wake-1",
        reason: "用户请求查看当前状态",
        priority: 60,
        payload: { source: "test" },
      }).success,
    ).toBe(true);
    expect(AgentWebSocketRequestSchema.safeParse({ type: "world.update", nodes: [] }).success).toBe(false);
  });

  test("queues an explicit Resident wake and returns the refreshed world projection", async () => {
    const instant = Temporal.Instant.from("2026-08-29T01:30:00Z");
    const worldRuntime = createWorldRuntime(instant);
    const request = vi.fn(() => undefined);
    const onWorldWake = vi.fn(async () => undefined);
    const agenda = {
      snapshot: vi.fn(() => ({ world: { id: "world_test" } })),
    } as unknown as AgentAgendaService;
    const send = vi.fn(async (_event: AgentDomainEvent) => undefined);
    const handlers = new AgentWebSocketWorldRequestHandlers({
      worldRuntime,
      agenda,
      residentWakeRuntime: { request } as never,
      configSnapshot: () => ({ ModelProviders: [] }),
      onWorldWake,
    } as unknown as AgentWebSocketRequestContext);

    await handlers.residentWake(
      {
        type: "world.resident.wake",
        requestId: "wake-1",
        reason: "用户请求查看当前状态",
        priority: 60,
        payload: { source: "test" },
      },
      send,
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        worldId: "world_test",
        request: {
          id: "wake-1",
          reason: "用户请求查看当前状态",
          priority: 60,
          payload: { source: "test" },
        },
      }),
    );
    expect(onWorldWake).toHaveBeenCalledWith("resident_explicit");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "world.snapshot" }));
  });
});

function createWorldRuntime(instant: Temporal.Instant): AgentWorldSnapshotProvider {
  return {
    snapshot: () => ({
      world: { id: "world_test", name: "Senera", timeZone: "Asia/Shanghai" },
      time: projectAgentWorldTime({
        instant,
        timeZone: "Asia/Shanghai",
        dayPhases: [
          { id: "night", label: "深夜", startsAt: "00:00", endsAt: "06:00" },
          { id: "day", label: "白天", startsAt: "06:00", endsAt: "18:00" },
          { id: "evening", label: "晚上", startsAt: "18:00", endsAt: "00:00" },
        ],
      }),
      calendar: projectChineseWorldCalendar(Temporal.PlainDate.from("2026-08-29"), "Asia/Shanghai"),
      nodes: [],
      edges: [],
      timeline: [],
      changedNodeIds: [],
      nextSchedules: [],
      commitments: [],
      resident: {
        residentId: null,
        userId: null,
        location: null,
        activity: null,
        bodyState: null,
        emotionState: null,
        interruptedBy: null,
        relationship: null,
        nextPlan: null,
      },
    }),
  };
}
