import path from "node:path";
import type { AgentConfigService } from "../Source/AgentSystem/Config/AgentConfigService.js";
import type { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import type { AgentWorkspaceLayout } from "../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import type { AgentPresetActivationRuntime } from "../Source/AgentSystem/Presets/AgentPresetActivationRuntime.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { ResolvedAgentPresetsConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentSessionStore } from "../Source/AgentSystem/Session/AgentSessionStore.js";
import { errorMessage } from "../Source/AgentSystem/Core/AgentErrors.js";
import { AgentPluginHost } from "../Source/AgentSystem/Plugins/AgentPluginHost.js";
import { AgentPluginSourceKinds } from "../Source/AgentSystem/Plugins/AgentPluginTypes.js";
import type { AgentPluginDiscoverySource } from "../Source/AgentSystem/Plugins/AgentPluginDiscovery.js";
import { AgentSelfHttpApi } from "../Source/AgentSystem/SelfService/AgentSelfHttpApi.js";
import {
  AgentApprovalTransportRegistry,
  createHttpApprovalTransport,
} from "../Source/AgentSystem/SelfService/AgentApprovalTransport.js";
import { AgentSelfApprovalRegistry } from "../Source/AgentSystem/SelfService/AgentSelfApprovalRegistry.js";
import type {
  AgentSelfServicePort,
  AgentSelfSkillSource,
} from "../Source/AgentSystem/SelfService/AgentSelfServiceTypes.js";
import { AgentRuntimeManifestStore } from "../Source/AgentSystem/Runtime/AgentRuntimeManifest.js";
import { createSeneraSelfServicePort } from "./SeneraSelfServiceHost.js";

export interface SeneraServerRuntimePlatform {
  readonly pluginHost: AgentPluginHost;
  readonly selfService: AgentSelfServicePort;
  readonly selfHttpApi: AgentSelfHttpApi;
  readonly approvalTransports: AgentApprovalTransportRegistry;
  readonly runtimeManifestStore: AgentRuntimeManifestStore;
  start(input: { readonly host: string; readonly port: number }): Promise<void>;
  stop(): Promise<void>;
}

export interface SeneraServerRuntimePlatformInput {
  readonly resourceRoot: string;
  readonly workspaceRoot: string;
  readonly workspaceLayout: AgentWorkspaceLayout;
  readonly configPath: string;
  readonly configSnapshot: () => AgentSystemConfig;
  readonly configService: AgentConfigService;
  readonly presetActivation: AgentPresetActivationRuntime;
  readonly resolvePresetsConfig: (config: AgentSystemConfig) => ResolvedAgentPresetsConfig;
  readonly sessionStore: AgentSessionStore;
  readonly logger: Pick<AgentLogger, "error" | "warn">;
}

/**
 * Creates the process-level platform services shared by the HTTP self-service
 * API and every runtime composition. The returned lifecycle is idempotent so
 * startup rollback and normal shutdown can safely use the same path.
 */
export async function createSeneraServerRuntimePlatform(
  input: SeneraServerRuntimePlatformInput,
): Promise<SeneraServerRuntimePlatform> {
  const approvalTransports = new AgentApprovalTransportRegistry();
  approvalTransports.register(createHttpApprovalTransport(new AgentSelfApprovalRegistry()));
  const pluginHost = new AgentPluginHost({
    sources: resolveAgentPluginDiscoverySources(input),
    enabled: input.configSnapshot().Plugins?.Enabled,
    approvalTransports,
  });
  pluginHost.discover();
  await pluginHost.load();
  for (const entry of pluginHost.list()) {
    if (entry.error) input.logger.warn("plugin.load.failed", { pluginId: entry.id, error: entry.error });
  }

  const selfService = createSeneraSelfServicePort({
    workspaceRoot: input.workspaceRoot,
    configPath: input.configPath,
    configSnapshot: input.configSnapshot,
    configService: input.configService,
    presetActivation: input.presetActivation,
    resolvePresetsConfig: input.resolvePresetsConfig,
    sessionStore: input.sessionStore,
    logsRoot: input.workspaceLayout.stateRoot,
    pluginHost,
    skillSources: [
      {
        id: "system",
        displayName: "Senera system Skills",
        kind: "system",
        root: path.join(input.resourceRoot, "System", "Skills"),
      } satisfies AgentSelfSkillSource,
      {
        id: "workspace",
        displayName: "Workspace Skills",
        kind: "workspace",
        root: input.workspaceLayout.skillRoot,
      } satisfies AgentSelfSkillSource,
    ],
  });
  const selfHttpApi = new AgentSelfHttpApi(selfService, {
    approvals: approvalTransports.preferred(),
  });
  const runtimeManifestStore = new AgentRuntimeManifestStore(input.workspaceRoot);
  let stopPromise: Promise<void> | undefined;

  return {
    pluginHost,
    selfService,
    selfHttpApi,
    approvalTransports,
    runtimeManifestStore,
    start: async ({ host, port }) => {
      try {
        await pluginHost.start();
      } catch (error) {
        input.logger.error("插件启动钩子失败", { error: errorMessage(error) });
      }
      const { token } = runtimeManifestStore.start({ host, port });
      selfHttpApi.bindToken(token);
    },
    stop: () =>
      (stopPromise ??= (async () => {
        const failures: unknown[] = [];
        try {
          await pluginHost.shutdown();
        } catch (error) {
          failures.push(error);
        }
        try {
          runtimeManifestStore.stop();
        } catch (error) {
          failures.push(error);
        }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) throw new AggregateError(failures, "Senera runtime platform shutdown failed.");
      })()),
  };
}

function resolveAgentPluginDiscoverySources(
  input: SeneraServerRuntimePlatformInput,
): readonly AgentPluginDiscoverySource[] {
  const directories = (input.configSnapshot().Plugins?.Directories ?? []).map((directory) =>
    path.isAbsolute(directory) ? path.resolve(directory) : path.resolve(input.workspaceRoot, directory),
  );
  return [
    { source: AgentPluginSourceKinds.Bundled, directory: path.join(input.resourceRoot, "System", "Plugins") },
    { source: AgentPluginSourceKinds.User, directory: path.join(input.workspaceLayout.stateRoot, "plugins") },
    { source: AgentPluginSourceKinds.Project, directory: path.join(input.workspaceRoot, "plugins") },
    ...directories.map((directory) => ({ source: AgentPluginSourceKinds.Pip, directory })),
  ];
}
