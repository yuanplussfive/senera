import path from "node:path";
import { AgentConfigService, type AgentConfigSourceOptions } from "../Source/AgentSystem/Config/AgentConfigService.js";
import { AgentConfigSecretCodec } from "../Source/AgentSystem/Config/AgentConfigSecretProtection.js";
import type { AgentUpgradeSession } from "../Source/AgentSystem/Upgrade/AgentUpgradeSession.js";
import {
  resolveAgentApplicationPaths,
  type AgentApplicationPaths,
} from "../Source/AgentSystem/Core/AgentApplicationPaths.js";
import {
  resolveAgentWorkspaceLayout,
  type AgentWorkspaceLayout,
} from "../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { ensureAgentWorkspaceStateDirectoryIgnored } from "../Source/AgentSystem/Core/AgentWorkspaceStateIgnore.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { AgentRuntimeDependencyManager } from "../Source/AgentSystem/Runtime/AgentRuntimeDependencyService.js";
import { DefaultAgentRuntimeDependencyHealthPolicy } from "../Source/AgentSystem/Runtime/AgentRuntimeDependencyTypes.js";
import { AgentBrowserConfigurationSchema } from "../Source/AgentSystem/Browser/AgentBrowserConfiguration.js";
import type { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import { AgentMcpPackageScanner } from "../Source/AgentSystem/McpPackages/AgentMcpPackageScanner.js";
import { AgentSkillScanner } from "../Source/AgentSystem/Skills/AgentSkillScanner.js";
import { migrateAgentWorkspaceState } from "../Source/AgentSystem/WorkspaceResources/AgentWorkspaceStateMigration.js";
import { resolveServerConfigSource, resolveServerRuntimeConfigPath } from "./ServerRuntimeConfig.js";
import { seedRuntimeConfigForSource } from "./RuntimeConfigBootstrap.js";
import { isSamePath, relativePathWithin } from "../Source/AgentSystem/Core/AgentPath.js";

type WorkspaceStateMigrationEntry = { readonly source: string; readonly target: string };

function resolveLegacySharedUserPluginMigrationEntries(
  paths: ReturnType<typeof resolveAgentApplicationPaths>,
  workspaceLayout: AgentWorkspaceLayout,
): readonly WorkspaceStateMigrationEntry[] {
  const source = path.resolve(paths.legacySharedUserPluginsRoot);
  const target = path.resolve(workspaceLayout.userPluginsRoot);

  // The application root can also be the selected workspace. In that case the
  // old shared directory is already the project's plugin directory and must not
  // be copied into its user scope.
  if (isSamePath(source, workspaceLayout.projectPluginsRoot) || isSamePath(source, target)) return [];

  if (relativePathWithin(source, target) !== undefined || relativePathWithin(target, source) !== undefined) {
    throw new Error(
      `Legacy shared user plugin directory overlaps the workspace plugin directory: ${source} -> ${target}`,
    );
  }

  return [{ source, target }];
}

export interface SeneraWorkspaceRuntimePreparation {
  readonly workspaceLayout: AgentWorkspaceLayout;
  readonly configSource: AgentConfigSourceOptions;
  readonly configPath: string;
}

export function projectSeneraSandboxWorkspace(root: string, workspace: string, guestRoot: string): string {
  const relative = relativePathWithin(root, workspace);
  if (relative === undefined) throw new Error("Workspace is not mounted by the application sandbox Worker.");
  return path.posix.join(guestRoot, relative.split(path.sep).join("/"));
}

export function projectSeneraWorkspaceRuntimeConfig(input: {
  readonly config: AgentSystemConfig;
  readonly workspaceRoot: string;
  readonly workspaceLayout: AgentWorkspaceLayout;
  readonly local: boolean;
  readonly project?: (config: AgentSystemConfig, workspaceRoot: string) => AgentSystemConfig;
  readonly disableSandbox: (config: AgentSystemConfig) => AgentSystemConfig;
}): AgentSystemConfig {
  const projected = input.project?.(input.config, input.workspaceRoot) ?? input.config;
  const executionConfig = input.local ? input.disableSandbox(projected) : projected;
  return {
    ...executionConfig,
    AgentLoop: {
      ...executionConfig.AgentLoop,
      PiSessions: { ...executionConfig.AgentLoop?.PiSessions, RootDir: input.workspaceLayout.piSessionsRoot },
    },
  };
}

export function createSeneraWorkspaceRuntimeDependencies(input: {
  readonly workspaceRoot: string;
  readonly resourcesRoot: string;
  readonly configSnapshot: () => AgentSystemConfig;
  readonly logger: AgentLogger;
}): AgentRuntimeDependencyManager {
  return new AgentRuntimeDependencyManager({
    workspaceRoot: input.workspaceRoot,
    resourcesPath: input.resourcesRoot,
    healthCheckPolicy: DefaultAgentRuntimeDependencyHealthPolicy,
    browserConfiguration: () =>
      AgentBrowserConfigurationSchema.parse(input.configSnapshot().Extensions?.["agent-browser"]?.Configuration ?? {}),
    logger: input.logger,
  });
}

export function createSeneraWorkspaceRuntimeSnapshot(input: {
  readonly configService: Pick<AgentConfigService, "snapshot">;
  readonly projectConfig: (config: AgentSystemConfig) => AgentSystemConfig;
  readonly resourceRoot: string;
  readonly workspaceLayout: AgentWorkspaceLayout;
  readonly mcpInputsRevision: () => string;
}) {
  return () => {
    const snapshot = input.configService.snapshot();
    return {
      version: snapshot.version,
      revision: snapshot.revision,
      sourceRevisions: {
        mcpPackages: AgentMcpPackageScanner.sourceRevision(path.join(input.resourceRoot, "McpServers")),
        workspaceMcp: AgentMcpPackageScanner.sourceRevision(input.workspaceLayout.mcpRoot),
        systemSkills: AgentSkillScanner.sourceRevision(path.join(input.resourceRoot, "System", "Skills")),
        workspaceSkills: AgentSkillScanner.sourceRevision(input.workspaceLayout.skillRoot),
        mcpInputs: input.mcpInputsRevision(),
      },
      config: input.projectConfig(snapshot.value),
    };
  };
}

export interface SeneraWorkspaceRuntimeOptions {
  readonly configPath?: string;
  readonly configSource?: AgentConfigSourceOptions;
}

export function resolveSeneraWorkspaceRuntime(input: {
  readonly paths: ReturnType<typeof resolveAgentApplicationPaths>;
  readonly workspaceRoot: string;
  readonly workspaceId: string;
  readonly resourcesRoot: string;
  readonly configPath?: string;
  readonly configSource?: AgentConfigSourceOptions;
  readonly migrateLegacyState?: boolean;
  readonly legacyConfigPath?: string;
  readonly additionalEntries?: readonly { readonly source: string; readonly target: string }[];
}): SeneraWorkspaceRuntimePreparation {
  const workspaceLayout = input.paths.workspaceLayout(input.workspaceRoot, input.workspaceId);
  const configSource =
    input.configSource ?? resolveServerConfigSource(input.workspaceRoot, { configPath: input.configPath });
  if (input.migrateLegacyState) {
    migrateAgentWorkspaceState({
      workspaceRoot: input.workspaceRoot,
      workspaceId: input.workspaceId,
      source: input.paths.legacyWorkspaceLayout(input.workspaceRoot, input.workspaceId),
      target: workspaceLayout,
      legacyConfigPath: input.legacyConfigPath,
      targetConfigPath: configSource.kind === "json" ? configSource.configPath : configSource.databasePath,
      additionalEntries: input.additionalEntries,
    });
  }
  const configPath = resolveServerRuntimeConfigPath(input.workspaceRoot, configSource);
  seedRuntimeConfigForSource(configSource, input.resourcesRoot, input.workspaceRoot, input.paths);
  ensureAgentWorkspaceStateDirectoryIgnored(input.workspaceRoot);
  return { workspaceLayout, configSource, configPath };
}

export function resolveSeneraInitialWorkspaceRuntime(input: {
  readonly paths: ReturnType<typeof resolveAgentApplicationPaths>;
  readonly workspaceRoot: string;
  readonly workspaceId: string;
  readonly resourcesRoot: string;
  readonly options: SeneraWorkspaceRuntimeOptions;
  readonly legacyConfigPath?: string;
}): SeneraWorkspaceRuntimePreparation {
  const applicationLayout = resolveAgentWorkspaceLayout(input.paths.root);
  const workspaceLayout = input.paths.workspaceLayout(input.workspaceRoot, input.workspaceId);
  const configSource =
    input.options.configSource ??
    resolveServerConfigSource(input.workspaceRoot, { configPath: input.options.configPath });
  return resolveSeneraWorkspaceRuntime({
    paths: input.paths,
    workspaceRoot: input.workspaceRoot,
    workspaceId: input.workspaceId,
    resourcesRoot: input.resourcesRoot,
    configPath: input.options.configPath,
    configSource: input.options.configSource,
    migrateLegacyState: true,
    legacyConfigPath: input.legacyConfigPath,
    additionalEntries: [
      ...(configSource.kind === "sqlite"
        ? [{ source: applicationLayout.databases.config, target: configSource.databasePath }]
        : []),
      ...resolveLegacySharedUserPluginMigrationEntries(input.paths, workspaceLayout),
    ],
  });
}

export function resolveSeneraHostedWorkspaceRuntime(input: {
  readonly paths: ReturnType<typeof resolveAgentApplicationPaths>;
  readonly workspaceRoot: string;
  readonly workspaceId: string;
  readonly resourcesRoot: string;
  readonly configSource: AgentConfigSourceOptions;
  readonly migrateLegacyState?: boolean;
}): SeneraWorkspaceRuntimePreparation {
  return resolveSeneraWorkspaceRuntime({
    ...input,
    migrateLegacyState: input.migrateLegacyState ?? false,
  });
}

export function createSeneraWorkspaceConfigService(input: {
  readonly workspaceRoot: string;
  readonly configSource: AgentConfigSourceOptions;
  readonly upgradeSession: AgentUpgradeSession;
  /** Complete host state for the deployment that owns this workspace. */
  readonly applicationPaths: AgentApplicationPaths;
}): AgentConfigService {
  return new AgentConfigService({
    workspaceRoot: input.workspaceRoot,
    source: input.configSource,
    upgradeSession: input.upgradeSession,
    secretCodec: new AgentConfigSecretCodec({
      workspaceRoot: input.workspaceRoot,
      applicationPaths: input.applicationPaths,
    }),
  });
}
