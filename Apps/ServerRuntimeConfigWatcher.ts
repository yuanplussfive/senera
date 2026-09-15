import fs from "node:fs";
import { Temporal } from "@js-temporal/polyfill";
import { resolveAgentWorldConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentEventKinds, emitAgentEvent, type AgentDomainEvent } from "../Source/AgentSystem/Events/AgentEvent.js";
import { serializeError } from "../Source/AgentSystem/Diagnostics/AgentErrorSerializer.js";
import { errorMessage } from "../Source/AgentSystem/Core/AgentErrors.js";
import { createAgentWorldSnapshotEvent } from "../Source/AgentSystem/World/AgentWorldEventTypes.js";
import type { AgentConfigService } from "../Source/AgentSystem/Config/AgentConfigService.js";
import type { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import type { AgentAgendaService } from "../Source/AgentSystem/Agenda/AgentAgendaService.js";
import type { AgentWorldRuntime } from "../Source/AgentSystem/World/AgentWorldRuntime.js";
import type { AgentWorldResidentIdleRuntime } from "../Source/AgentSystem/World/AgentWorldResidentIdleRuntime.js";
import type { AgentWebSocketServer } from "../Source/AgentSystem/WebSocket/AgentWebSocketServer.js";

export interface SeneraServerRuntimeConfigWatcherInput {
  readonly enabled: boolean;
  readonly configPath: string;
  readonly configService: AgentConfigService;
  readonly server: Pick<AgentWebSocketServer, "broadcast">;
  readonly worldRuntime: AgentWorldRuntime;
  readonly residentIdle: AgentWorldResidentIdleRuntime;
  readonly agenda: AgentAgendaService;
  readonly configSnapshot: () => Parameters<typeof resolveAgentWorldConfig>[0];
  readonly requestWorldWake: (reason: string) => void;
  readonly logger: Pick<AgentLogger, "error">;
}

export function startSeneraServerRuntimeConfigWatcher(input: SeneraServerRuntimeConfigWatcherInput): () => void {
  if (!input.enabled) return () => undefined;
  const onChange = (): void => {
    try {
      const snapshot = input.configService.reloadFromSources();
      void (async () => {
        await input.server.broadcast({
          kind: AgentEventKinds.ConfigReloaded,
          context: {},
          data: {
            configPath: snapshot.path,
            source: snapshot.source,
            revision: snapshot.revision,
            diagnostics: snapshot.diagnostics,
          },
        });
        await input.server.broadcast(createAgentWorldSnapshotEvent(input.worldRuntime));
        input.residentIdle.ensureScheduled(
          input.agenda.snapshot(resolveAgentWorldConfig(input.configSnapshot()).TimeZone).world.id,
          Temporal.Now.instant(),
        );
        input.requestWorldWake("config_reload");
      })().catch((error) => {
        input.logger.error("配置变更事件广播失败", { error: errorMessage(error) });
      });
    } catch (error) {
      emitAgentEvent((event: AgentDomainEvent) => input.server.broadcast(event), {
        kind: AgentEventKinds.ConfigFailed,
        context: {},
        data: {
          configPath: input.configPath,
          message: errorMessage(error),
          details: serializeError(error),
        },
      }).catch((broadcastError) => {
        input.logger.error("配置失败事件广播失败", { error: errorMessage(broadcastError) });
      });
    }
  };
  fs.watchFile(input.configPath, { interval: 500 }, onChange);
  return () => fs.unwatchFile(input.configPath, onChange);
}
