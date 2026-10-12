import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { AgentMcpToolsChanged } from "../Mcp/AgentMcpToolCatalogChange.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import {
  validateAgentMcpToolDeclarations,
  type AgentDeferredMcpServer,
  type AgentDiscoveredMcpServer,
  type AgentMcpPackageDiscoveryResult,
} from "./AgentMcpPackageDiscovery.js";
import { createAgentMcpPackageOwner, projectAgentMcpPackageTools } from "./AgentMcpPackageToolProjector.js";
import type { AgentMcpPackage, AgentMcpServiceDiscoveryEntry } from "./AgentMcpPackageTypes.js";
import { ReadyAgentToolAvailability, type AgentToolAvailability } from "../ToolRuntime/AgentToolAvailability.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import type { AgentMcpPackageSchemaCache } from "./AgentMcpPackageSchemaCache.js";

export interface AgentMcpToolCatalogInvalidator {
  refresh(): void;
}

export interface AgentMcpPackageCatalogInstallOptions {
  readonly isDeferredToolReference?: (toolName: string) => boolean;
}

export interface AgentMcpPackageCatalogDeferredDiscovery {
  discover(server: AgentDeferredMcpServer, signal?: AbortSignal): Promise<AgentMcpPackageDiscoveryResult>;
}

export class AgentMcpPackageCatalog {
  private readonly servers = new Map<string, AgentDiscoveredMcpServer>();
  private readonly pendingChanges = new Map<string, AgentMcpToolsChanged>();
  private readonly updateLeases = new AgentKeyedLeaseQueue<string>();
  private readonly deferredServers = new Map<string, AgentDeferredMcpServer>();
  private readonly declaredServers = new Map<string, AgentDeferredMcpServer>();
  private readonly availability = new Map<string, AgentToolAvailability>();
  private readonly discoveryLeases = new AgentKeyedLeaseQueue<string>();
  private acceptingDiscoveryUpdates = true;
  private referenceValidation: AgentMcpPackageCatalogInstallOptions = {};
  private deferredDiscovery: AgentMcpPackageCatalogDeferredDiscovery | undefined;

  constructor(
    private readonly registry: AgentExtensionRegistry,
    private readonly invalidator: AgentMcpToolCatalogInvalidator,
    private readonly logger?: Pick<AgentLogger, "warn" | "info">,
    private readonly schemaCache?: Pick<AgentMcpPackageSchemaCache, "save">,
  ) {}

  registerPackages(packages: readonly AgentMcpPackage[]): void {
    for (const package_ of packages)
      for (const server of package_.servers) {
        this.declaredServers.set(server.name, { package_, server });
        this.availability.set(server.name, { status: "unverified" });
      }
  }

  services(): readonly AgentMcpServiceDiscoveryEntry[] {
    return [...this.declaredServers.values()].map(({ package_, server }) => ({
      id: server.name,
      revision: package_.revision,
      title: localizedValues(package_.displayName).join(" / ") || server.name,
      description: localizedValues(package_.description).join("\n") || server.name,
      aliases: [
        ...deferredServerSearchText({ package_, server }).split("\n"),
        ...(this.servers
          .get(server.name)
          ?.declarations.flatMap((tool) => [tool.name, ...(tool.description ? [tool.description] : [])]) ?? []),
      ],
      availability: this.availability.get(server.name)!,
      toolNames: [
        ...new Set([
          ...(this.servers.get(server.name)?.declarations.map((declaration) => declaration.name) ?? []),
          ...Object.keys(server.toolLocalization ?? {}),
        ]),
      ],
    }));
  }

  recordDiscoveryIssues(result: Pick<AgentMcpPackageDiscoveryResult, "failures" | "unavailableServers">): void {
    for (const failure of result.failures)
      this.setAvailability(failure.serverName, {
        status: "unavailable",
        reason: "discovery_failed",
        message: failure.error instanceof Error ? failure.error.message : String(failure.error),
      });
    for (const unavailable of result.unavailableServers)
      this.setAvailability(
        unavailable.serverName,
        unavailable.reason === "needs_input"
          ? { status: "needs_input", inputIds: unavailable.inputIds }
          : { status: "unavailable", reason: unavailable.reason, message: unavailable.missingCapabilities.join(", ") },
      );
  }

  async install(
    discoveredServers: readonly AgentDiscoveredMcpServer[],
    referenceValidation: AgentMcpPackageCatalogInstallOptions = {},
  ): Promise<void> {
    const replacements = discoveredServers.map((discovered) => this.prepareReplacement(discovered));
    try {
      for (const replacement of replacements) {
        this.registry.replaceToolExtension(replacement.owner, replacement.nextTools);
      }
      this.registry.validateAgentReferences(referenceValidation);
    } catch (error) {
      for (const replacement of [...replacements].reverse()) {
        this.registry.replaceToolExtension(replacement.owner, replacement.previousTools);
      }
      throw error;
    }
    this.referenceValidation = referenceValidation;
    for (const discovered of discoveredServers) {
      this.servers.set(discovered.server.name, discovered);
      this.declaredServers.set(discovered.server.name, discovered);
      this.availability.set(
        discovered.server.name,
        discovered.endpoint.transport === "unresolved" ? discovered.endpoint.availability : ReadyAgentToolAvailability,
      );
      if (discovered.endpoint.transport !== "unresolved") this.deferredServers.delete(discovered.server.name);
    }
    this.acceptingDiscoveryUpdates = false;
    this.invalidator.refresh();
    const pendingChanges = discoveredServers.flatMap((discovered) => {
      if (discovered.endpoint.transport === "unresolved") return [];
      const change = this.pendingChanges.get(discovered.server.name);
      this.pendingChanges.delete(discovered.server.name);
      return change ? [change] : [];
    });
    await Promise.all(pendingChanges.map((change) => this.update(change)));
  }

  registerDeferred(
    servers: readonly AgentDeferredMcpServer[],
    discovery: AgentMcpPackageCatalogDeferredDiscovery,
    referenceValidation: AgentMcpPackageCatalogInstallOptions = this.referenceValidation,
  ): void {
    this.deferredDiscovery = discovery;
    this.referenceValidation = referenceValidation;
    for (const server of servers) {
      this.deferredServers.set(server.server.name, server);
    }
    this.registry.validateAgentReferences(referenceValidation);
  }

  /**
   * Discovers only package servers whose declarative metadata overlaps the
   * current request. The catalog remains empty for unrelated servers, so a
   * search for one MCP capability cannot start every installed process.
   */
  async discoverServices(serviceIds: readonly string[], signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const discovery = this.deferredDiscovery;
    if (!discovery || this.deferredServers.size === 0) return;
    const candidates = [...this.deferredServers.values()].filter((server) => serviceIds.includes(server.server.name));
    for (const server of candidates) {
      await this.discoverDeferredServer(server, discovery, signal);
    }
  }

  async update(change: AgentMcpToolsChanged): Promise<void> {
    const release = await this.updateLeases.acquire(change.server.id);
    try {
      const installed = this.servers.get(change.server.id);
      if (this.deferredServers.has(change.server.id)) {
        this.pendingChanges.set(change.server.id, change);
        return;
      }
      if (!installed) {
        if (this.acceptingDiscoveryUpdates) {
          this.pendingChanges.set(change.server.id, change);
          return;
        }
        throw new Error(`MCP server ${change.server.id} is not installed in the active catalog.`);
      }
      validateAgentMcpToolDeclarations(change.declarations, installed.package_, installed.server);
      const updated: AgentDiscoveredMcpServer = {
        ...installed,
        declarations: change.declarations,
      };
      this.replaceServerTools(updated);
      try {
        if (updated.endpoint.transport !== "unresolved") {
          await this.schemaCache?.save(updated.package_, updated.server, updated.endpoint, updated.declarations);
        }
      } catch (error) {
        this.replaceServerTools(installed);
        throw error;
      }
      this.servers.set(change.server.id, updated);
      this.invalidator.refresh();
    } finally {
      release();
    }
  }

  private async discoverDeferredServer(
    server: AgentDeferredMcpServer,
    discovery: AgentMcpPackageCatalogDeferredDiscovery,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.discoveryLeases.run(
      server.server.name,
      async () => {
        if (!this.deferredServers.has(server.server.name)) return;
        const result = await discovery.discover(server, signal);
        throwIfAborted(signal);
        this.recordDiscoveryIssues(result);
        if (result.failures.length > 0) {
          this.logger?.warn("mcp.discovery.deferred_failed", {
            failures: result.failures.map((failure) => ({
              packageName: failure.packageName,
              serverName: failure.serverName,
              error: failure.error instanceof Error ? failure.error.message : String(failure.error),
            })),
          });
        }
        if (result.unavailableServers.length > 0) {
          this.logger?.info("mcp.discovery.deferred_unavailable", {
            servers: result.unavailableServers.map((unavailable) => unavailable.serverName),
          });
        }
        if (result.servers.length === 0) return;
        await this.install(result.servers, this.referenceValidation);
      },
      signal,
    );
  }

  private setAvailability(
    serverName: string,
    availability: Exclude<AgentToolAvailability, { readonly status: "ready" }>,
  ): void {
    this.availability.set(serverName, availability);
    const installed = this.servers.get(serverName);
    if (!installed) return;
    const updated: AgentDiscoveredMcpServer = {
      ...installed,
      endpoint: {
        id: serverName,
        revision: installed.package_.revision,
        packageName: installed.package_.name,
        packageRoot: installed.package_.rootPath,
        transport: "unresolved",
        availability,
      },
    };
    this.replaceServerTools(updated);
    this.servers.set(serverName, updated);
    this.invalidator.refresh();
  }

  private replaceServerTools(discovered: AgentDiscoveredMcpServer): void {
    const replacement = this.prepareReplacement(discovered);

    this.registry.replaceToolExtension(replacement.owner, replacement.nextTools);
    try {
      this.registry.validateAgentReferences(this.referenceValidation);
    } catch (error) {
      this.registry.replaceToolExtension(replacement.owner, replacement.previousTools);
      throw error;
    }
  }

  private prepareReplacement(discovered: AgentDiscoveredMcpServer) {
    const owner = createAgentMcpPackageOwner(discovered.package_, discovered.server);
    return {
      owner,
      previousTools: this.ownerTools(owner),
      nextTools: projectAgentMcpPackageTools(
        discovered.package_,
        discovered.server,
        discovered.declarations,
        discovered.execution,
        discovered.endpoint,
      ),
    };
  }

  private ownerTools(owner: Parameters<AgentExtensionRegistry["listToolsForOwner"]>[0]): RegisteredTool[] {
    return this.registry.listToolsForOwner(owner);
  }
}

function deferredServerSearchText(server: AgentDeferredMcpServer): string {
  return [
    server.package_.name,
    server.server.name,
    ...localizedValues(server.package_.displayName),
    ...localizedValues(server.package_.description),
    ...Object.entries(server.server.toolLocalization ?? {}).flatMap(([tool, aliases]) => [tool, ...aliases]),
  ].join("\n");
}

function localizedValues(value: AgentMcpPackage["displayName"]): string[] {
  return value ? [...new Set(Object.values(value))] : [];
}
