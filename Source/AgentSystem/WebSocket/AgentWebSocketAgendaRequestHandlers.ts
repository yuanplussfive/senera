import { resolveAgentWorldConfig } from "../AgentDefaults.js";
import { AgentEventKinds } from "../Events/AgentEvent.js";
import type { AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentWebSocketEventSender, AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";

/** Reads the single persistent world agenda independently of any chat session. */
export class AgentWebSocketAgendaRequestHandlers {
  constructor(
    private readonly context: AgentWebSocketRequestContext,
    private readonly broadcast: AgentWebSocketEventSender,
  ) {}

  async get(_request: AgentWebSocketRequestOf<"agenda.get">, sendEvent: AgentWebSocketEventSender): Promise<void> {
    const agenda = this.context.agenda;
    if (!agenda) throw new Error("World agenda is unavailable in this runtime.");
    const timeZone = resolveAgentWorldConfig(this.context.configSnapshot()).TimeZone;
    await sendEvent({
      kind: AgentEventKinds.AgendaSnapshot,
      context: {},
      data: { snapshot: agenda.snapshot(timeZone) },
    });
  }

  async command(request: AgentWebSocketRequestOf<"agenda.goal.command">): Promise<void> {
    const goalCommands = this.context.goalCommands;
    if (!goalCommands) throw new Error("Goal command control is unavailable in this runtime.");
    const result = goalCommands.execute({
      commandId: request.commandId,
      goalId: request.goalId,
      expectedRevision: request.expectedRevision,
      ...request.command,
    });
    await this.broadcast({
      kind: AgentEventKinds.AgendaSnapshot,
      context: {},
      data: { snapshot: result.snapshot },
    });
  }
}
