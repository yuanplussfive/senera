import { collectRejected, closeRuntimeInfrastructure } from "./ServerRuntimeSupport.js";
import type { AgentArtifactRetentionService } from "../Source/AgentSystem/Artifacts/AgentArtifactRetentionService.js";
import type { AgentChannelService } from "../Source/AgentSystem/Channels/AgentChannelService.js";
import type { AgentConfigService } from "../Source/AgentSystem/Config/AgentConfigService.js";
import type { AgentContinuityRuntime } from "../Source/AgentSystem/Continuity/AgentContinuityRuntime.js";
import type { AgentExecutionResourceBroker } from "../Source/AgentSystem/ExecutionResources/AgentExecutionResourceBroker.js";
import type { AgentInteractionInputRuntime } from "../Source/AgentSystem/Interaction/AgentInteractionInputRuntime.js";
import type { AgentMcpInputService } from "../Source/AgentSystem/Credentials/AgentMcpInputService.js";
import type { AgentOrchestrationDatabase } from "../Source/AgentSystem/Orchestration/AgentOrchestrationDatabase.js";
import type { AgentSessionRepository } from "../Source/AgentSystem/Session/AgentSessionRepository.js";
import type { AgentSessionManager } from "../Source/AgentSystem/Session/AgentSessionManager.js";
import type { AgentSandboxRuntimeService } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimeService.js";
import type { AgentWorkflowService } from "../Source/AgentSystem/Orchestration/AgentWorkflowService.js";
import type { AgentScheduleRuntime } from "../Source/AgentSystem/Orchestration/AgentScheduleRuntime.js";
import type { AgentSystemRuntimeCache } from "../Source/AgentSystem/Runtime/AgentSystemRuntimeCache.js";
import type { AgentWorkspaceRuntime } from "../Source/AgentSystem/Runtime/AgentWorkspaceRuntime.js";
import type { SeneraServerRuntimePlatform } from "./ServerRuntimePlatform.js";

export interface SeneraServerRuntimeShutdownInput {
  readonly stopConfigWatch: () => void;
  readonly unsubscribeSandboxStatus: () => void;
  readonly sessionManager: AgentSessionManager;
  readonly schedules: AgentScheduleRuntime;
  readonly workflows: AgentWorkflowService;
  readonly delegation: { shutdown(): Promise<void> };
  readonly delegationCompletion: { stop(): Promise<void> };
  readonly channelService: AgentChannelService;
  readonly server: { stop(): Promise<void> };
  readonly platform: SeneraServerRuntimePlatform;
  readonly orchestrationEvents: { setSink(sink: undefined): void };
  readonly unbindRunDispatch: () => void;
  readonly runtimeCache: AgentSystemRuntimeCache;
  readonly workspaceRuntime: AgentWorkspaceRuntime;
  readonly executionResources: AgentExecutionResourceBroker;
  readonly interactionInput: AgentInteractionInputRuntime;
  readonly artifactRetention: AgentArtifactRetentionService;
  readonly sandboxRuntimeService: AgentSandboxRuntimeService;
  readonly configService: AgentConfigService;
  readonly mcpInputs: AgentMcpInputService;
  readonly continuityRuntime: AgentContinuityRuntime;
  readonly repository: AgentSessionRepository;
  readonly orchestrationDatabase: AgentOrchestrationDatabase;
  readonly channelsDatabase: { close(): void };
}

export function createSeneraServerRuntimeStop(input: SeneraServerRuntimeShutdownInput): () => Promise<void> {
  let stopPromise: Promise<void> | undefined;
  return () =>
    (stopPromise ??= (async () => {
      input.stopConfigWatch();
      input.unsubscribeSandboxStatus();
      input.sessionManager.beginShutdown();
      const failures: unknown[] = [];
      collectRejected(await Promise.allSettled([input.schedules.stop(), input.workflows.shutdown()]), failures);
      collectRejected(await Promise.allSettled([input.delegation.shutdown()]), failures);
      collectRejected(
        await Promise.allSettled([input.delegationCompletion.stop(), input.channelService.stop()]),
        failures,
      );
      collectRejected(await Promise.allSettled([input.server.stop(), input.sessionManager.shutdown()]), failures);
      collectRejected(await Promise.allSettled([input.platform.stop()]), failures);
      input.orchestrationEvents.setSink(undefined);
      input.unbindRunDispatch();
      try {
        collectRejected(
          await Promise.allSettled([
            closeRuntimeInfrastructure(input.runtimeCache, input.workspaceRuntime),
            input.executionResources.close(),
            input.interactionInput.close(),
            input.artifactRetention.close(),
            input.sandboxRuntimeService.close(),
          ]),
          failures,
        );
      } finally {
        for (const close of [
          () => input.configService.close(),
          () => input.mcpInputs.close(),
          () => input.continuityRuntime.close(),
          () => input.repository.close(),
          () => input.orchestrationDatabase.close(),
          () => input.channelsDatabase.close(),
        ]) {
          try {
            close();
          } catch (error) {
            failures.push(error);
          }
        }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "Senera server shutdown failed.");
    })());
}
