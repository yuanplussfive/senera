import type { AgentProductMetadata } from "../Source/AgentSystem/Core/AgentProductMetadata.js";
import type { AgentConfigService, AgentConfigSourceOptions } from "../Source/AgentSystem/Config/AgentConfigService.js";
import type { AgentWorkspaceSnapshotData } from "../Source/AgentSystem/Config/AgentConfigEventTypes.js";
import { errorMessage } from "../Source/AgentSystem/Core/AgentErrors.js";
import { AgentUpgradeSession } from "../Source/AgentSystem/Upgrade/AgentUpgradeSession.js";
import {
  AgentWorkspaceInUseError,
  type AgentWorkspaceCatalog,
} from "../Source/AgentSystem/WorkspaceResources/AgentWorkspaceCatalog.js";
import type { AgentWorkspaceCatalogSnapshot } from "../Source/AgentSystem/WorkspaceResources/AgentWorkspaceCatalogContract.js";
import { scopeAgentWorkspaceUrl } from "../Source/AgentSystem/WorkspaceResources/AgentWorkspaceTransportScope.js";
import {
  resolveSeneraHostedWorkspaceRuntime,
  type SeneraWorkspaceRuntimePreparation,
} from "./ServerWorkspaceRuntime.js";
import { resolveServerRuntimeConfigPath, resolveWorkspaceServerConfigSource } from "./ServerRuntimeConfig.js";
import { SeneraStartupCleanup } from "./ServerRuntimeSupport.js";
import type { SeneraServerHandle, SeneraServerOptions, SeneraWorkspaceHandle } from "./ServerRuntime.js";
import type { AgentWebSocketTransport } from "../Source/AgentSystem/WebSocket/AgentWebSocketTransport.js";
import type { AgentWorkspaceSwitchResult } from "../Source/AgentSystem/WebSocket/AgentWebSocketTypes.js";
import type { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";

export interface SeneraWorkspaceSwitchOutcome {
  runtime: SeneraWorkspaceHandle;
  result: AgentWorkspaceSwitchResult;
}

export interface SeneraWorkspaceHost {
  catalog: AgentWorkspaceCatalog;
  readonly resourcesRoot: string;
  readonly configService: AgentConfigService;
  readonly configSource: AgentConfigSourceOptions;
  readonly configPath: string;
  readonly paths: SeneraServerHostPaths;
  readonly transport: AgentWebSocketTransport;
  readonly initialWorkspaceRoot: string;
  resolveConfigSource(root: string): AgentConfigSourceOptions;
  configPathForWorkspace(root: string): string;
  snapshot(root: string): AgentWorkspaceSnapshotData;
  open(root: string): Promise<SeneraServerHandle>;
  switchWorkspace(fromRoot: string, toRoot: string): Promise<SeneraWorkspaceSwitchOutcome>;
  forgetWorkspace(id: string): Promise<AgentWorkspaceCatalogSnapshot>;
  onWorkspaceClientCountChanged(workspaceId: string, count: number): void;
}

type SeneraServerHostPaths = ReturnType<
  (typeof import("../Source/AgentSystem/Core/AgentApplicationPaths.js"))["resolveAgentApplicationPaths"]
>;

interface SeneraWorkspaceHostInput {
  readonly catalog: AgentWorkspaceCatalog;
  readonly resourcesRoot: string;
  readonly initialWorkspaceRoot: string;
  readonly configService: AgentConfigService;
  readonly configSource: AgentConfigSourceOptions;
  readonly configPath: string;
  readonly paths: SeneraServerHostPaths;
  readonly transport: AgentWebSocketTransport;
  readonly defaultWorkspaceId: string;
  readonly product: AgentProductMetadata;
  readonly options: SeneraServerOptions;
  readonly runtimes: Map<string, SeneraWorkspaceHandle>;
  readonly pending: Map<string, Promise<SeneraServerHandle>>;
  readonly retiring: Map<string, Promise<void>>;
  readonly workspaceSwitchReservations: Map<string, number>;
  readonly retireWhenIdle: Set<string>;
  readonly workspaceClientCounts: Map<string, number>;
  readonly isClosing: () => boolean;
  readonly hostLogger: AgentLogger;
  readonly enqueueWorkspaceLifecycle: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly retireRuntime: (workspaceId: string) => Promise<void>;
  readonly publicHandle: (runtime: SeneraWorkspaceHandle) => SeneraServerHandle;
  readonly startRuntime: (
    options: SeneraServerOptions,
    workspaceRoot: string,
    workspaceRuntime: SeneraWorkspaceRuntimePreparation,
    upgradeSession: AgentUpgradeSession,
    startupCleanup: SeneraStartupCleanup,
    product: AgentProductMetadata,
    host: SeneraWorkspaceHost,
  ) => Promise<SeneraWorkspaceHandle>;
}

export function createSeneraWorkspaceHost(input: SeneraWorkspaceHostInput): SeneraWorkspaceHost {
  // Initial startup already prepared the default workspace before this host exists. Hosted workspaces
  // receive one compatibility preparation attempt per host lifetime; the durable marker remains the
  // authority across restarts.
  const preparedWorkspaceState = new Set<string>([input.defaultWorkspaceId]);
  const host: SeneraWorkspaceHost = {
    catalog: input.catalog,
    resourcesRoot: input.resourcesRoot,
    initialWorkspaceRoot: input.initialWorkspaceRoot,
    configService: input.configService,
    configSource: input.configSource,
    configPath: input.configPath,
    paths: input.paths,
    transport: input.transport,
    resolveConfigSource: (root) =>
      resolveWorkspaceServerConfigSource(root, input.configSource, input.initialWorkspaceRoot),
    configPathForWorkspace: (root) =>
      resolveServerRuntimeConfigPath(
        root,
        root === input.initialWorkspaceRoot
          ? input.configSource
          : resolveWorkspaceServerConfigSource(root, input.configSource, input.initialWorkspaceRoot),
      ),
    snapshot: (root) => {
      const descriptor = input.catalog.register(root);
      return {
        workspaceId: descriptor.id,
        defaultWorkspaceId: input.defaultWorkspaceId,
        workspaceRoot: descriptor.root,
        configPath: host.configPathForWorkspace(root),
        websocketUrl: scopeAgentWorkspaceUrl(input.transport.websocketUrl, descriptor.id),
        workspaces: input.catalog.list(),
        capabilities: { browseDirectories: true },
      };
    },
    switchWorkspace: async (fromRoot, toRoot) => {
      const source = input.catalog.register(fromRoot);
      const target = input.catalog.register(toRoot);
      reserveWorkspaceSwitch(input.workspaceSwitchReservations, target.id);
      try {
        await host.open(target.root);
        const nextRuntime = input.runtimes.get(target.id);
        if (!nextRuntime) throw new Error(`Workspace runtime is unavailable: ${target.id}`);
        return {
          runtime: nextRuntime,
          result: {
            snapshot: host.snapshot(nextRuntime.workspaceRoot),
            finalize: async () => {
              try {
                await input.enqueueWorkspaceLifecycle(async () => {
                  if (source.id === target.id) return;
                  const sourceRuntime = input.runtimes.get(source.id);
                  if (sourceRuntime && sourceRuntime.server.clientCount > 1) {
                    input.retireWhenIdle.add(source.id);
                    return;
                  }
                  input.retireWhenIdle.delete(source.id);
                  await input.retireRuntime(source.id);
                });
              } finally {
                releaseWorkspaceSwitch(input.workspaceSwitchReservations, target.id);
              }
            },
          },
        };
      } catch (error) {
        releaseWorkspaceSwitch(input.workspaceSwitchReservations, target.id);
        throw error;
      }
    },
    forgetWorkspace: (id) =>
      input.enqueueWorkspaceLifecycle(async () => {
        if (id === input.defaultWorkspaceId) throw new AgentWorkspaceInUseError(id);
        if (input.workspaceSwitchReservations.has(id)) throw new AgentWorkspaceInUseError(id);
        input.catalog.get(id);
        const pendingRuntime = input.pending.get(id);
        if (pendingRuntime) await pendingRuntime;
        const runtime = input.runtimes.get(id);
        if (runtime?.server.clientCount) throw new AgentWorkspaceInUseError(id);
        input.retireWhenIdle.delete(id);
        await input.retireRuntime(id);
        input.workspaceClientCounts.delete(id);
        input.catalog.forget(id);
        return { workspaces: [...input.catalog.list()], defaultWorkspaceId: input.defaultWorkspaceId };
      }),
    onWorkspaceClientCountChanged: (workspaceId, count) => {
      const previousCount = input.workspaceClientCounts.get(workspaceId) ?? 0;
      input.workspaceClientCounts.set(workspaceId, count);
      if (count > 0) {
        if (previousCount === 0) input.retireWhenIdle.delete(workspaceId);
        return;
      }
      if (count !== 0 || input.isClosing() || !input.retireWhenIdle.has(workspaceId)) return;
      void input
        .enqueueWorkspaceLifecycle(async () => {
          const runtime = input.runtimes.get(workspaceId);
          if (!input.retireWhenIdle.has(workspaceId) || runtime?.server.clientCount !== 0) return;
          input.retireWhenIdle.delete(workspaceId);
          await input.retireRuntime(workspaceId);
        })
        .catch((error) => {
          input.hostLogger.error("工作区空闲运行时回收失败", {
            workspaceId,
            error: errorMessage(error),
          });
        });
    },
    open: (root) =>
      input.enqueueWorkspaceLifecycle(async () => {
        if (input.isClosing()) throw new Error("Application is shutting down.");
        const descriptor = input.catalog.register(root);
        const retiringRuntime = input.retiring.get(descriptor.id);
        if (retiringRuntime) await retiringRuntime;
        const existing = input.runtimes.get(descriptor.id);
        if (existing) {
          input.catalog.recordOpened(descriptor.root);
          input.options.onWorkspaceOpened?.(descriptor.root, descriptor.id);
          return input.publicHandle(existing);
        }
        const running = input.pending.get(descriptor.id);
        if (running) return running;
        const operation = (async () => {
          const workspaceCleanup = new SeneraStartupCleanup();
          const prepareLegacyState = !preparedWorkspaceState.has(descriptor.id);
          const workspaceRuntime = resolveSeneraHostedWorkspaceRuntime({
            paths: input.paths,
            workspaceRoot: descriptor.root,
            workspaceId: descriptor.id,
            resourcesRoot: input.resourcesRoot,
            configSource: resolveWorkspaceServerConfigSource(
              descriptor.root,
              input.configSource,
              input.initialWorkspaceRoot,
            ),
            migrateLegacyState: prepareLegacyState,
          });
          preparedWorkspaceState.add(descriptor.id);
          const session = new AgentUpgradeSession({
            workspaceRoot: descriptor.root,
            stateRoot: workspaceRuntime.workspaceLayout.stateRoot,
            allowedDataRoots: [workspaceRuntime.workspaceLayout.stateRoot],
            appVersion: input.product.version,
          });
          try {
            session.recoverInterruptedUpgrade();
            const runtime = await input.startRuntime(
              input.options,
              descriptor.root,
              workspaceRuntime,
              session,
              workspaceCleanup,
              input.product,
              host,
            );
            input.catalog.recordOpened(descriptor.root);
            input.options.onWorkspaceOpened?.(descriptor.root, descriptor.id);
            session.markHealthy();
            input.runtimes.set(descriptor.id, runtime);
            workspaceCleanup.disarm();
            return input.publicHandle(runtime);
          } catch (error) {
            const failures: unknown[] = [error];
            try {
              await workspaceCleanup.run();
            } catch (cleanupError) {
              failures.push(cleanupError);
            }
            try {
              session.failAndRollback(error);
            } catch (rollbackError) {
              failures.push(rollbackError);
            }
            if (failures.length > 1) {
              throw new AggregateError(failures, "Workspace startup cleanup failed.", { cause: error });
            }
            throw error;
          } finally {
            input.pending.delete(descriptor.id);
          }
        })();
        input.pending.set(descriptor.id, operation);
        return operation;
      }),
  };
  return host;
}

function reserveWorkspaceSwitch(reservations: Map<string, number>, workspaceId: string): void {
  reservations.set(workspaceId, (reservations.get(workspaceId) ?? 0) + 1);
}

function releaseWorkspaceSwitch(reservations: Map<string, number>, workspaceId: string): void {
  const remaining = (reservations.get(workspaceId) ?? 0) - 1;
  if (remaining > 0) reservations.set(workspaceId, remaining);
  else reservations.delete(workspaceId);
}
