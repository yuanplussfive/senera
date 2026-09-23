import { resolveAgentWorldConfig, resolvePresetsConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentChannelService } from "../Source/AgentSystem/Channels/AgentChannelService.js";
import { AgentConfigService } from "../Source/AgentSystem/Config/AgentConfigService.js";
import { errorMessage } from "../Source/AgentSystem/Core/AgentErrors.js";
import type { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import { AgentPresetManager } from "../Source/AgentSystem/Presets/AgentPresetManager.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createAgentWorldSnapshotEvent } from "../Source/AgentSystem/World/AgentWorldEventTypes.js";
import { AgentPresetWorldActivationRuntime } from "../Source/AgentSystem/World/AgentPresetWorldActivationRuntime.js";
import { AgentWorldRuntime } from "../Source/AgentSystem/World/AgentWorldRuntime.js";
import type { AgentWebSocketServer } from "../Source/AgentSystem/WebSocket/AgentWebSocketServer.js";

export interface SeneraServerRuntimeConfigurationSynchronizationInput {
  readonly workspaceRoot: string;
  readonly configService: AgentConfigService;
  readonly configSnapshot: () => AgentSystemConfig;
  readonly presetActivation: AgentPresetWorldActivationRuntime;
  readonly channelService: AgentChannelService;
  readonly worldRuntime: AgentWorldRuntime;
  readonly server: Pick<AgentWebSocketServer, "broadcast">;
  readonly requestWorldWake: (reason: string) => void;
  readonly setResidentDisplayName: (name: string) => void;
  readonly logger: Pick<AgentLogger, "error">;
}

/**
 * Keeps services whose configuration has live side effects synchronized with
 * the authoritative config snapshot. It deliberately owns both subscriptions
 * so shutdown cannot leave one live after the server transport is stopped.
 */
export function bindSeneraServerRuntimeConfigurationSynchronization(
  input: SeneraServerRuntimeConfigurationSynchronizationInput,
): () => void {
  const unsubscribePresetActivation = input.configService.subscribe((snapshot) => {
    const manager = new AgentPresetManager({
      workspaceRoot: input.workspaceRoot,
      config: resolvePresetsConfig(snapshot.value),
      activation: input.presetActivation,
    });
    void manager
      .synchronizeActivePreset()
      .then((card) => {
        input.setResidentDisplayName(card?.title ?? resolveAgentWorldConfig(input.configSnapshot()).Name);
        input.requestWorldWake("preset_activation");
        return input.server.broadcast(createAgentWorldSnapshotEvent(input.worldRuntime));
      })
      .catch((error) => input.logger.error("角色世界同步失败", { error: errorMessage(error) }));
  });
  const unsubscribeChannelConfig = input.configService.subscribe(() => {
    void input.channelService.syncFromConfig().catch((error) => {
      input.logger.error("消息渠道配置同步失败", { error: errorMessage(error) });
    });
  });
  return () => {
    unsubscribeChannelConfig();
    unsubscribePresetActivation();
  };
}
