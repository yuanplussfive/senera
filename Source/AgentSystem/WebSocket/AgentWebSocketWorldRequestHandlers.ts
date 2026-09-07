import { createAgentWorldSnapshotEvent } from "../World/AgentWorldEventTypes.js";
import { Temporal } from "@js-temporal/polyfill";
import { resolveAgentWorldConfig } from "../AgentDefaults.js";
import type { AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentWebSocketEventSender, AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";

/** Returns the same authoritative world projection that is supplied to the model. */
export class AgentWebSocketWorldRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  async get(_request: AgentWebSocketRequestOf<"world.get">, sendEvent: AgentWebSocketEventSender): Promise<void> {
    const worldRuntime = this.context.worldRuntime;
    if (!worldRuntime) throw new Error("World runtime is unavailable.");
    await sendEvent(createAgentWorldSnapshotEvent(worldRuntime));
  }

  async residentWake(
    request: AgentWebSocketRequestOf<"world.resident.wake">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    const runtime = this.context.residentWakeRuntime;
    const worldRuntime = this.context.worldRuntime;
    const agenda = this.context.agenda;
    if (!runtime || !worldRuntime || !agenda) throw new Error("Resident wake control is unavailable.");
    const timeZone = resolveAgentWorldConfig(this.context.configSnapshot()).TimeZone;
    const worldId = agenda.snapshot(timeZone).world.id;
    runtime.request({
      worldId,
      now: Temporal.Now.instant(),
      request: {
        id: request.requestId,
        reason: request.reason,
        priority: request.priority,
        payload: request.payload,
      },
    });
    await this.context.onWorldWake?.("resident_explicit");
    await sendEvent(createAgentWorldSnapshotEvent(worldRuntime));
  }
}
