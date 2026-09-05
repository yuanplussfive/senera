import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { resolveToolExecutionConfig } from "../Defaults/AgentRuntimeDefaults.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import { withAgentMcpToolClient, type AgentMcpToolClient } from "../Mcp/AgentMcpToolClient.js";
import type { AgentMcpToolDeclaration, AgentMcpToolsChangedHandler } from "../Mcp/AgentMcpToolCatalogChange.js";
import type { AgentMcpSamplingHandler } from "../Mcp/AgentMcpSamplingRuntime.js";
import type { AgentMcpToolClientPool } from "../Mcp/AgentMcpToolClientPool.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { createAgentMcpPackageEndpoint } from "./AgentMcpPackageRuntime.js";
import type { AgentMcpPackage, AgentMcpPackageServer, AgentMcpRuntimeEndpoint } from "./AgentMcpPackageTypes.js";
import {
  resolveAgentMcpPackageExecutionPolicy,
  type AgentMcpPackageExecutionPolicy,
} from "./AgentMcpPackageExecutionPolicy.js";
import { createAgentMcpExecutionProfile } from "../Mcp/AgentMcpExecutionProfile.js";
import type { AgentExtensionValueResolver } from "../Extensions/AgentExtensionValueExpression.js";
import { AgentMcpInputsRequiredError } from "./AgentMcpValueExpression.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";

export interface AgentDiscoveredMcpServer {
  readonly package_: AgentMcpPackage;
  readonly server: AgentMcpPackageServer;
  readonly declarations: readonly AgentMcpToolDeclaration[];
  readonly execution: AgentMcpPackageExecutionPolicy;
  readonly endpoint: AgentMcpRuntimeEndpoint;
}

export interface AgentMcpPackageDiscoveryFailure {
  readonly packageName: string;
  readonly serverName: string;
  readonly error: unknown;
}

export interface AgentUnavailableMcpServer {
  readonly packageName: string;
  readonly serverName: string;
  readonly reason: "needs_input";
  readonly inputIds: readonly string[];
}

export interface AgentMcpPackageDiscoveryResult {
  readonly servers: readonly AgentDiscoveredMcpServer[];
  readonly unavailableServers: readonly AgentUnavailableMcpServer[];
  readonly failures: readonly AgentMcpPackageDiscoveryFailure[];
}

type AgentMcpPackageDiscoveryOutcome =
  | { readonly status: "fulfilled"; readonly server: AgentDiscoveredMcpServer }
  | { readonly status: "rejected"; readonly failure: AgentMcpPackageDiscoveryFailure };

export interface AgentMcpPackageDiscoveryOptions {
  readonly clientPool?: AgentMcpToolClientPool;
  readonly sampling?: AgentMcpSamplingHandler;
  readonly onToolsChanged?: AgentMcpToolsChangedHandler;
  readonly inputs?: AgentExtensionValueResolver;
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
  constructor(
    private readonly config: AgentSystemConfig,
    private readonly executionEnv: SeneraExecutionEnv,
    private readonly options: AgentMcpPackageDiscoveryOptions = {},
  ) {}

  async discover(packages: readonly AgentMcpPackage[]): Promise<AgentMcpPackageDiscoveryResult> {
    const outcomes = await Promise.all(
      packages.flatMap((package_) => package_.servers.map((server) => this.discoverServerOutcome(package_, server))),
    );
    const failures = outcomes.flatMap((outcome) =>
      outcome.status === "rejected" && !(outcome.failure.error instanceof AgentMcpInputsRequiredError)
        ? [outcome.failure]
        : [],
    );
    return {
      servers: outcomes.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.server] : [])),
      unavailableServers: outcomes.flatMap((outcome) => {
        if (outcome.status === "fulfilled" || !(outcome.failure.error instanceof AgentMcpInputsRequiredError)) {
          return [];
        }
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

  private async discoverServerOutcome(
    package_: AgentMcpPackage,
    server: AgentMcpPackageServer,
  ): Promise<AgentMcpPackageDiscoveryOutcome> {
    try {
      return { status: "fulfilled", server: await this.discoverServer(package_, server) };
    } catch (error) {
      return {
        status: "rejected",
        failure: { packageName: package_.name, serverName: server.name, error },
      };
    }
  }

  private async discoverServer(
    package_: AgentMcpPackage,
    server: AgentMcpPackageServer,
  ): Promise<AgentDiscoveredMcpServer> {
    const execution = resolveToolExecutionConfig(this.config);
    const policy = resolveAgentMcpPackageExecutionPolicy(package_, server, this.executionEnv);
    const endpoint = createAgentMcpPackageEndpoint(
      package_,
      server,
      this.options.inputs,
      this.executionEnv.workspaceRoot,
    );
    const connection = {
      server: endpoint,
      requestTimeoutMs: execution.TimeoutMs,
      spawnPersistentProcess: this.executionEnv.spawnPersistentProcess,
      executionProfile: createAgentMcpExecutionProfile({
        backend: policy.preferredBackend,
        network: "default",
        workspaceMount: "readonly",
        packageRoot: package_.rootPath,
      }),
      terminationGraceMs: execution.Resources.TerminationGraceMs,
      maxFrameBytes: Math.max(execution.MaxStdoutBytes, execution.MaxStderrBytes),
      maxStderrBytes: execution.MaxStderrBytes,
      sampling: this.options.sampling,
      onToolsChanged: this.options.onToolsChanged,
    };
    const listTools = (client: AgentMcpToolClient) => client.listTools();
    const declarations = this.options.clientPool
      ? await this.options.clientPool.withClient(connection, listTools)
      : await withAgentMcpToolClient(connection, listTools);
    validateAgentMcpToolDeclarations(declarations, package_, server);
    return { package_, server, declarations, execution: policy, endpoint };
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
