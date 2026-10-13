import {
  InMemorySessionRepository,
  SqliteSessionRepository,
  type AgentSessionRepository,
} from "../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { resolvePersistenceConfig, resolveSandboxRuntimeConfig } from "../Source/AgentSystem/AgentDefaults.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import { AgentSystemRuntimeCache } from "../Source/AgentSystem/Runtime/AgentSystemRuntimeCache.js";
import { AgentSandboxRuntimeService } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimeService.js";
import { AgentUpgradeSession } from "../Source/AgentSystem/Upgrade/AgentUpgradeSession.js";
import { errorMessage } from "../Source/AgentSystem/Core/AgentErrors.js";
import { resolveAgentWorkspaceLayout } from "../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { AgentWorkspaceRuntime } from "../Source/AgentSystem/Runtime/AgentWorkspaceRuntime.js";
import { AgentRuntimeUpdateDeployments } from "../Source/AgentSystem/Runtime/AgentRuntimeUpdateContract.js";
import type { AgentRuntimeUpdateHttpApiOptions } from "../Source/AgentSystem/Runtime/AgentRuntimeUpdateHttpApi.js";
import type { AgentRuntimeUpdateOrigin } from "../Source/AgentSystem/Runtime/AgentRuntimeUpdateOrigin.js";
import http from "node:http";

export type ServerEventLogDetail = "compact" | "verbose";

export function createRuntimeUpdateOptions({
  currentVersion,
  deployment,
  updateManifestUrl,
  updateOrigin,
}: {
  currentVersion: string;
  deployment: (typeof AgentRuntimeUpdateDeployments)[keyof typeof AgentRuntimeUpdateDeployments];
  updateManifestUrl: string | undefined;
  updateOrigin: AgentRuntimeUpdateOrigin | undefined;
}): AgentRuntimeUpdateHttpApiOptions {
  if (updateManifestUrl?.trim()) {
    return { currentVersion, deployment, manifestUrl: updateManifestUrl };
  }
  return { currentVersion, deployment, ...(updateOrigin ? { updateOrigin } : {}) };
}

export function disableSandboxRuntime(config: AgentSystemConfig): AgentSystemConfig {
  return {
    ...config,
    SandboxRuntime: {
      ...config.SandboxRuntime,
      Enabled: false,
    },
  };
}

export function collectRejected(outcomes: readonly PromiseSettledResult<unknown>[], failures: unknown[]): void {
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") failures.push(outcome.reason);
  }
}

export async function closeRuntimeInfrastructure(
  runtimeCache: AgentSystemRuntimeCache,
  workspaceRuntime: AgentWorkspaceRuntime,
): Promise<void> {
  const failures: unknown[] = [];
  for (const close of [() => runtimeCache.clear(), () => workspaceRuntime.close()]) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Runtime infrastructure shutdown failed.");
  }
}

export async function probeSeneraReadiness(healthUrl: string): Promise<void> {
  // Startup must use a fresh connection, independent of pooled connections to a previous process on this port.
  await new Promise<void>((resolve, reject) => {
    const request = http.get(healthUrl, { agent: false, signal: AbortSignal.timeout(5_000) }, (response) => {
      response.resume();
      response.once("error", reject);
      response.once("end", () =>
        response.statusCode === 200
          ? resolve()
          : reject(new Error(`Senera readiness check failed for ${healthUrl}: HTTP ${response.statusCode}.`)),
      );
    });
    request.once("error", (cause) => reject(new Error(`Senera readiness check failed for ${healthUrl}.`, { cause })));
  });
}

export function resolveHealthCheckHost(host: string): string {
  const normalized = host.trim().toLowerCase();
  if (normalized === "0.0.0.0") return "127.0.0.1";
  if (normalized === "::" || normalized === "[::]") return "[::1]";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

export function startSandboxRuntimePreparation(input: {
  config: AgentSystemConfig;
  sandboxRuntimeService: AgentSandboxRuntimeService;
  logger: AgentLogger;
  prepared: boolean;
}): void {
  const sandboxRuntimeConfig = resolveSandboxRuntimeConfig(input.config);
  if (
    !sandboxRuntimeConfig.Enabled ||
    (process.platform === "win32" && !input.sandboxRuntimeService.sandboxBackendAvailable())
  ) {
    input.sandboxRuntimeService.markDisabled();
    input.logger.info("sandbox.runtime.disabled", {
      provider: input.sandboxRuntimeService.runtimeProvider(),
    });
    return;
  }
  if (!input.sandboxRuntimeService.sandboxBackendAvailable()) {
    const error = new Error("The configured sandbox execution boundary is unavailable.");
    input.sandboxRuntimeService.markUnavailable(error);
    input.logger.warn("sandbox.runtime.unavailable", {
      provider: input.sandboxRuntimeService.runtimeProvider(),
      message: error.message,
    });
    return;
  }

  if (input.prepared) {
    input.sandboxRuntimeService.markReady();
    input.logger.success("sandbox.runtime.ready", {
      provider: input.sandboxRuntimeService.runtimeProvider(),
    });
    return;
  }

  void input.sandboxRuntimeService.prepare({ config: sandboxRuntimeConfig }).then(
    () => {
      input.logger.success("sandbox.runtime.ready", {
        provider: input.sandboxRuntimeService.runtimeProvider(),
      });
    },
    (error: unknown) => {
      input.logger.warn("sandbox.runtime.unavailable", {
        message: errorMessage(error),
      });
    },
  );
}

export function createRepository(
  workspaceRoot: string,
  config: AgentSystemConfig,
  upgradeSession: AgentUpgradeSession,
  logger: AgentLogger,
  databasePath = resolveAgentWorkspaceLayout(workspaceRoot).databases.sessions,
): AgentSessionRepository {
  const persistence = resolvePersistenceConfig(config);
  if (persistence.Kind === "memory") {
    return new InMemorySessionRepository();
  }
  return new SqliteSessionRepository(databasePath, upgradeSession, (sessionId, issue) =>
    logger.warn("session.entry.decode_failed", { sessionId, ...issue }),
  );
}

export class SeneraStartupCleanup {
  private readonly callbacks = new Set<() => void | Promise<void>>();

  defer(callback: () => void | Promise<void>): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  disarm(): void {
    this.callbacks.clear();
  }

  async run(): Promise<void> {
    const failures: unknown[] = [];
    for (const callback of [...this.callbacks].reverse()) {
      try {
        await callback();
      } catch (error) {
        failures.push(error);
      }
    }
    this.callbacks.clear();
    if (failures.length > 0) {
      throw new AggregateError(failures, "Senera startup cleanup failed.");
    }
  }
}

export function resolveServerEventLogDetail(value: string | undefined): ServerEventLogDetail {
  return value?.trim().toLowerCase() === "verbose" ? "verbose" : "compact";
}
