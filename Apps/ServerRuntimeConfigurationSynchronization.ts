import { AgentChannelService } from "../Source/AgentSystem/Channels/AgentChannelService.js";
import { AgentConfigService } from "../Source/AgentSystem/Config/AgentConfigService.js";
import { errorMessage } from "../Source/AgentSystem/Core/AgentErrors.js";
import type { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentWebSocketServer } from "../Source/AgentSystem/WebSocket/AgentWebSocketServer.js";

export interface SeneraServerRuntimeConfigurationSynchronizationInput {
  readonly workspaceRoot: string;
  readonly configService: AgentConfigService;
  readonly configSnapshot: () => AgentSystemConfig;
  readonly channelService: AgentChannelService;
  readonly server: Pick<AgentWebSocketServer, "broadcast">;
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
  const unsubscribeChannelConfig = input.configService.subscribe(() => {
    void input.channelService.syncFromConfig().catch((error) => {
      input.logger.error("消息渠道配置同步失败", { error: errorMessage(error) });
    });
  });
  return () => {
    unsubscribeChannelConfig();
  };
}
