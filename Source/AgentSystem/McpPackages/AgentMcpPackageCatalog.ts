import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { AgentMcpToolsChanged } from "../Mcp/AgentMcpToolCatalogChange.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { validateAgentMcpToolDeclarations, type AgentDiscoveredMcpServer } from "./AgentMcpPackageDiscovery.js";
import { createAgentMcpPackageOwner, projectAgentMcpPackageTools } from "./AgentMcpPackageToolProjector.js";

export interface AgentMcpToolCatalogInvalidator {
  refresh(): void;
}

export interface AgentMcpPackageCatalogInstallOptions {
  readonly isDeferredToolReference?: (toolName: string) => boolean;
}

export class AgentMcpPackageCatalog {
  private readonly servers = new Map<string, AgentDiscoveredMcpServer>();
  private readonly pendingChanges = new Map<string, AgentMcpToolsChanged>();
  private readonly updateLeases = new AgentKeyedLeaseQueue<string>();
  private acceptingDiscoveryUpdates = true;
  private referenceValidation: AgentMcpPackageCatalogInstallOptions = {};

  constructor(
    private readonly registry: AgentExtensionRegistry,
    private readonly invalidator: AgentMcpToolCatalogInvalidator,
  ) {}

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
    for (const discovered of discoveredServers) this.servers.set(discovered.server.name, discovered);
    this.acceptingDiscoveryUpdates = false;
    this.invalidator.refresh();
    const pendingChanges = discoveredServers.flatMap((discovered) => {
      const change = this.pendingChanges.get(discovered.server.name);
      this.pendingChanges.delete(discovered.server.name);
      return change ? [change] : [];
    });
    await Promise.all(pendingChanges.map((change) => this.update(change)));
  }

  async update(change: AgentMcpToolsChanged): Promise<void> {
    const release = await this.updateLeases.acquire(change.server.id);
    try {
      const installed = this.servers.get(change.server.id);
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
      this.servers.set(change.server.id, updated);
      this.invalidator.refresh();
    } finally {
      release();
    }
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
      previousTools: this.ownerTools(owner.name),
      nextTools: projectAgentMcpPackageTools(
        discovered.package_,
        discovered.server,
        discovered.declarations,
        discovered.execution,
        discovered.endpoint,
      ),
    };
  }

  private ownerTools(ownerName: string): RegisteredTool[] {
    return this.registry.listTools().filter((tool) => tool.owner.name === ownerName);
  }
}
