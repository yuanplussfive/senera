import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { resolveToolExecutionConfig } from "../Defaults/AgentRuntimeDefaults.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import { withAgentMcpToolClient, type AgentMcpToolClient } from "../Mcp/AgentMcpToolClient.js";
import type { AgentMcpToolDeclaration, AgentMcpToolsChangedHandler } from "../Mcp/AgentMcpToolCatalogChange.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentMcpSamplingHandler } from "../Mcp/AgentMcpSamplingRuntime.js";
import type { AgentMcpToolClientPool } from "../Mcp/AgentMcpToolClientPool.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { createAgentMcpPackageEndpoint } from "./AgentMcpPackageRuntime.js";
import type {
  AgentMcpPackage,
  AgentMcpPackageServer,
  AgentMcpRuntimeEndpoint,
  AgentMcpDeclaredEndpoint,
} from "./AgentMcpPackageTypes.js";
import {
  resolveAgentMcpPackageExecutionPolicy,
  type AgentMcpPackageExecutionPolicy,
} from "./AgentMcpPackageExecutionPolicy.js";
import { createAgentMcpExecutionProfile } from "../Mcp/AgentMcpExecutionProfile.js";
import type { AgentExtensionValueResolver } from "../Extensions/AgentExtensionValueExpression.js";
import { AgentMcpInputsRequiredError } from "./AgentMcpValueExpression.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import {
  detectAgentMcpHostCapabilities,
  missingAgentMcpHostCapabilities,
  type AgentMcpHostCapabilitySnapshot,
} from "./AgentMcpHostRequirements.js";
import { AgentMcpPackageSchemaCache, agentMcpConnectionDigest } from "./AgentMcpPackageSchemaCache.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";

export interface AgentDiscoveredMcpServer {
  readonly package_: AgentMcpPackage;
  readonly server: AgentMcpPackageServer;
  readonly declarations: readonly AgentMcpToolDeclaration[];
  readonly execution: AgentMcpPackageExecutionPolicy;
  readonly endpoint: AgentMcpDeclaredEndpoint;
}

export interface AgentDeferredMcpServer {
  readonly package_: AgentMcpPackage;
  readonly server: AgentMcpPackageServer;
}

export interface AgentMcpPackageDiscoveryFailure {
  readonly packageName: string;
  readonly serverName: string;
  readonly error: unknown;
}

export type AgentUnavailableMcpServer =
  | {
      readonly packageName: string;
      readonly serverName: string;
      readonly reason: "needs_input";
      readonly inputIds: readonly string[];
    }
  | {
      readonly packageName: string;
      readonly serverName: string;
      readonly reason: "missing_host_capability";
      readonly missingCapabilities: readonly string[];
    };

export interface AgentMcpPackageDiscoveryResult {
  readonly servers: readonly AgentDiscoveredMcpServer[];
  /** Servers whose declarations are not cached yet and must be discovered on demand. */
  readonly deferredServers: readonly AgentDeferredMcpServer[];
  readonly unavailableServers: readonly AgentUnavailableMcpServer[];
  readonly failures: readonly AgentMcpPackageDiscoveryFailure[];
}

type AgentMcpPackageDiscoveryOutcome =
  | { readonly status: "fulfilled"; readonly server: AgentDiscoveredMcpServer }
  | { readonly status: "unavailable"; readonly server: AgentUnavailableMcpServer }
  | { readonly status: "rejected"; readonly failure: AgentMcpPackageDiscoveryFailure };

type AgentMcpCachedDiscoveryOutcome =
  | { readonly status: "fulfilled"; readonly server: AgentDiscoveredMcpServer }
  | { readonly status: "deferred"; readonly server: AgentDeferredMcpServer }
  | { readonly status: "unavailable"; readonly server: AgentUnavailableMcpServer }
  | { readonly status: "rejected"; readonly failure: AgentMcpPackageDiscoveryFailure };

export interface AgentMcpPackageDiscoveryOptions {
  readonly clientPool?: AgentMcpToolClientPool;
  readonly sampling?: AgentMcpSamplingHandler;
  readonly onToolsChanged?: AgentMcpToolsChangedHandler;
  readonly inputs?: AgentExtensionValueResolver;
  readonly hostCapabilities?: AgentMcpHostCapabilitySnapshot;
  readonly schemaCache?: AgentMcpPackageSchemaCache;
  readonly logger?: AgentLogger;
}

export class AgentMcpPackageDiscoveryError extends AgentBaseError {
  constructor(readonly failures: readonly AgentMcpPackageDiscoveryFailure[]) {
    super(formatDiscoveryFailureMessage(failures), {
      cause: new AggregateError(
        failures.map((failure) => failure.error),
        "MCP package discovery failed.",
      ),
    });
  }
}

export class AgentMcpPackageDiscovery {
  private readonly hostCapabilities: AgentMcpHostCapabilitySnapshot;

  constructor(
    private readonly config: AgentSystemConfig,
    private readonly executionEnv: SeneraExecutionEnv,
    private readonly options: AgentMcpPackageDiscoveryOptions = {},
  ) {
    this.hostCapabilities = options.hostCapabilities ?? detectAgentMcpHostCapabilities();
  }

  async discover(packages: readonly AgentMcpPackage[], signal?: AbortSignal): Promise<AgentMcpPackageDiscoveryResult> {
    throwIfAborted(signal);
    const outcomes = await Promise.all(
      packages.flatMap((package_) =>
        package_.servers.map((server) => this.discoverServerOutcome(package_, server, signal)),
      ),
    );
    const failures = outcomes.flatMap((outcome) =>
      outcome.status === "rejected" && !(outcome.failure.error instanceof AgentMcpInputsRequiredError)
        ? [outcome.failure]
        : [],
    );
    return {
      servers: outcomes.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.server] : [])),
      deferredServers: [],
      unavailableServers: outcomes.flatMap((outcome) => {
        if (outcome.status === "unavailable") return [outcome.server];
        if (outcome.status !== "rejected" || !(outcome.failure.error instanceof AgentMcpInputsRequiredError)) return [];
        return [
          {
            packageName: outcome.failure.packageName,
            serverName: outcome.failure.serverName,
            reason: "needs_input" as const,
            inputIds: outcome.failure.error.inputIds,
          },
        ];
      }),
      failures,
    };
  }

  /**
   * Loads only declarations already discovered in a previous run. A cache miss
   * is an explicit deferred state, not a reason to start the server during
   * runtime initialization.
   */
  async discoverCached(packages: readonly AgentMcpPackage[]): Promise<AgentMcpPackageDiscoveryResult> {
    const outcomes = await Promise.all(
      packages.flatMap((package_) =>
        package_.servers.map((server) => this.discoverCachedServerOutcome(package_, server)),
      ),
    );
    return {
      servers: outcomes.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.server] : [])),
      deferredServers: outcomes.flatMap((outcome) => (outcome.status === "deferred" ? [outcome.server] : [])),
      unavailableServers: outcomes.flatMap((outcome) => (outcome.status === "unavailable" ? [outcome.server] : [])),
      failures: outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.failure] : [])),
    };
  }

  private async discoverServerOutcome(
    package_: AgentMcpPackage,
    server: AgentMcpPackageServer,
    signal?: AbortSignal,
  ): Promise<AgentMcpPackageDiscoveryOutcome> {
    const missingCapabilities = missingAgentMcpHostCapabilities(package_.requirements, this.hostCapabilities);
    if (missingCapabilities.length > 0) {
      return {
        status: "unavailable",
        server: {
          packageName: package_.name,
          serverName: server.name,
          reason: "missing_host_capability",
          missingCapabilities,
        },
      };
    }
    try {
      return { status: "fulfilled", server: await this.discoverServer(package_, server, signal) };
    } catch (error) {
      throwIfAborted(signal);
      return {
        status: "rejected",
        failure: { packageName: package_.name, serverName: server.name, error },
      };
    }
  }

  private async discoverCachedServerOutcome(
    package_: AgentMcpPackage,
    server: AgentMcpPackageServer,
  ): Promise<AgentMcpCachedDiscoveryOutcome> {
    try {
      const cached = await this.options.schemaCache?.load(package_, server);
      if (!cached) return { status: "deferred", server: { package_, server } };
      validateAgentMcpToolDeclarations(cached.declarations, package_, server);
      let endpoint: AgentMcpDeclaredEndpoint;
      const missingCapabilities = missingAgentMcpHostCapabilities(package_.requirements, this.hostCapabilities);
      const unresolved = (
        availability: Extract<AgentMcpDeclaredEndpoint, { transport: "unresolved" }>["availability"],
      ): AgentMcpDeclaredEndpoint => ({
        id: server.name,
        revision: package_.revision,
        packageName: package_.name,
        packageRoot: package_.rootPath,
        transport: "unresolved",
        availability,
      });
      if (missingCapabilities.length > 0) {
        endpoint = unresolved({
          status: "unavailable",
          reason: "missing_host_capability",
          message: missingCapabilities.join(", "),
        });
      } else {
        try {
          const resolved = this.createServerContext(package_, server).endpoint;
          endpoint =
            cached.connectionDigest === agentMcpConnectionDigest(resolved)
              ? resolved
              : unresolved({ status: "unverified" });
        } catch (error) {
          if (!(error instanceof AgentMcpInputsRequiredError)) throw error;
          endpoint = unresolved({ status: "needs_input", inputIds: error.inputIds });
        }
      }
      return {
        status: "fulfilled",
        server: {
          package_,
          server,
          declarations: cached.declarations,
          execution: resolveAgentMcpPackageExecutionPolicy(package_, server, this.executionEnv),
          endpoint,
        },
      };
    } catch (error) {
      return { status: "rejected", failure: { packageName: package_.name, serverName: server.name, error } };
    }
  }

  private async discoverServer(
    package_: AgentMcpPackage,
    server: AgentMcpPackageServer,
    signal?: AbortSignal,
  ): Promise<AgentDiscoveredMcpServer> {
    const context = this.createServerContext(package_, server);
    const { execution, endpoint } = context;
    const connection = { ...this.createConnection(package_, server, context), signal };
    const listTools = (client: AgentMcpToolClient) => client.listTools(signal);
    const declarations = this.options.clientPool
      ? await this.options.clientPool.withClient(connection, listTools)
      : await withAgentMcpToolClient(connection, listTools);
    validateAgentMcpToolDeclarations(declarations, package_, server);
    await this.options.schemaCache?.save(package_, server, endpoint, declarations);
    return { package_, server, declarations, execution, endpoint };
  }

  private createServerContext(
    package_: AgentMcpPackage,
    server: AgentMcpPackageServer,
  ): {
    readonly execution: AgentMcpPackageExecutionPolicy;
    readonly endpoint: AgentMcpRuntimeEndpoint;
  } {
    const policy = resolveAgentMcpPackageExecutionPolicy(package_, server, this.executionEnv);
    const endpoint = createAgentMcpPackageEndpoint(
      package_,
      server,
      this.options.inputs,
      this.executionEnv.workspaceRoot,
    );
    return { execution: policy, endpoint };
  }

  private createConnection(
    package_: AgentMcpPackage,
    server: AgentMcpPackageServer,
    context: {
      readonly execution: AgentMcpPackageExecutionPolicy;
      readonly endpoint: AgentMcpRuntimeEndpoint;
    },
  ) {
    const execution = resolveToolExecutionConfig(this.config);
    const onToolsChanged = this.options.onToolsChanged;
    return {
      server: context.endpoint,
      requestTimeoutMs: execution.TimeoutMs,
      spawnPersistentProcess: this.executionEnv.spawnPersistentProcess,
      executionProfile: createAgentMcpExecutionProfile({
        backend: context.execution.preferredBackend,
        network: "default",
        workspaceMount: "readonly",
        packageRoot: context.endpoint.packageRoot,
        packageName: package_.name,
      }),
      terminationGraceMs: execution.Resources.TerminationGraceMs,
      maxFrameBytes: Math.max(execution.MaxStdoutBytes, execution.MaxStderrBytes),
      maxStderrBytes: execution.MaxStderrBytes,
      sampling: this.options.sampling,
      onToolsChanged:
        this.options.schemaCache || onToolsChanged
          ? async (change: Parameters<NonNullable<AgentMcpToolsChangedHandler>>[0]) => {
              validateAgentMcpToolDeclarations(change.declarations, package_, server);
              if (this.options.schemaCache) {
                try {
                  await this.options.schemaCache.save(package_, server, context.endpoint, change.declarations);
                } catch (error) {
                  this.options.logger?.warn("mcp.schema_cache.write_failed", {
                    packageName: package_.name,
                    serverName: server.name,
                    message: error instanceof Error ? error.message : String(error),
                  });
                }
              }
              await onToolsChanged?.(change);
            }
          : undefined,
    };
  }
}

function formatDiscoveryFailureMessage(failures: readonly AgentMcpPackageDiscoveryFailure[]): string {
  const details = failures
    .map((failure) => `${failure.packageName}/${failure.serverName}: ${failureMessage(failure.error)}`)
    .join("; ");
  return `MCP discovery failed for ${failures.map((failure) => `${failure.packageName}/${failure.serverName}`).join(", ")}.${details ? ` ${details}` : ""}`;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function validateAgentMcpToolDeclarations(
  declarations: readonly AgentMcpToolDeclaration[],
  package_: AgentMcpPackage,
  server: AgentMcpPackageServer,
): void {
  const schemaOptions = { allErrors: true, strict: true, validateFormats: false } as const;
  const draft07Schemas = new Ajv(schemaOptions);
  const draft202012Schemas = new Ajv2020(schemaOptions);
  const names = new Set<string>();
  for (const declaration of declarations) {
    if (!declaration.name.trim()) throw new Error(`MCP server ${server.name} returned a tool without a name.`);
    if (names.has(declaration.name))
      throw new Error(`MCP server ${server.name} returned duplicate tool ${declaration.name}.`);
    names.add(declaration.name);
    try {
      compileMcpJsonSchema(declaration.inputSchema, draft07Schemas, draft202012Schemas);
      if (declaration.outputSchema) {
        compileMcpJsonSchema(declaration.outputSchema, draft07Schemas, draft202012Schemas);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `MCP tool ${server.name}/${declaration.name} in ${package_.configurationPath} has an invalid JSON Schema: ${detail}`,
        { cause: error },
      );
    }
  }
}

function compileMcpJsonSchema(
  schema: Readonly<Record<string, unknown>>,
  draft07Schemas: Ajv,
  draft202012Schemas: Ajv2020,
): void {
  const dialect = schema.$schema;
  if (isDraft202012Schema(dialect)) {
    draft202012Schemas.compile(schema);
    return;
  }
  draft07Schemas.compile(schema);
}

function isDraft202012Schema(value: unknown): boolean {
  return (
    value === "https://json-schema.org/draft/2020-12/schema" ||
    value === "https://json-schema.org/draft/2020-12/schema#" ||
    value === "http://json-schema.org/draft/2020-12/schema" ||
    value === "http://json-schema.org/draft/2020-12/schema#"
  );
}
