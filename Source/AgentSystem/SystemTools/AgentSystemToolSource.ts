import { Ajv } from "ajv";
import { assertArtifactPolicyTemplates } from "../Artifacts/AgentArtifactTemplatePreflight.js";
import { AgentJsonFileLoader } from "../Config/AgentJsonFileLoader.js";
import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import { agentDirectoryRevision } from "../Core/AgentDirectoryRevision.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import {
  createAgentExtensionLocalizedText,
  resolveAgentExtensionLocalizedText,
  type AgentExtensionLocalizedText,
} from "../Extensions/AgentExtensionLocalization.js";
import { AgentSkillScanner } from "../Skills/AgentSkillScanner.js";
import type { RegisteredSkill } from "../Skills/AgentSkillTypes.js";
import { AgentJsonSchemaPromptContractProjector } from "../ToolContracts/AgentJsonSchemaPromptContractProjector.js";
import { ensureObjectRootJsonSchema } from "../ToolContracts/AgentJsonSchemaObjectRoot.js";
import type { RegisteredSidecarTool, RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { AgentToolPresentation } from "../Types/AgentToolPresentationTypes.js";
import {
  AgentSystemExtensionSettingsSurfaces,
  type AgentSystemExtensionSettingsSurface,
} from "../Types/AgentSystemExtensionSettingsSurface.js";
import type { AgentSystemExtensionConfig } from "../Types/AgentSystemConfigTypes.js";
import {
  AgentSystemExtensionConfigurationReader,
  type AgentSystemExtensionConfigurationSettings,
} from "./AgentSystemExtensionConfiguration.js";
import {
  AgentSystemToolContractSchema,
  type AgentSystemExtensionManifest,
  type AgentSystemHostToolContribution,
  type AgentSystemSidecarToolContribution,
  type AgentSystemSidecarToolContract,
  type AgentSystemToolContract,
  AgentSystemSidecarToolContractSchema,
} from "./AgentSystemExtensionManifest.js";
import {
  resolveSystemExtensionPackageDirectory,
  resolveSystemExtensionPackageFile,
} from "./AgentSystemExtensionPackagePath.js";
import { isAgentSystemExtensionApplicable, type AgentSystemExtensionPlatform } from "./AgentSystemExtensionPlatform.js";
import {
  discoverAgentSystemExtensionPackages,
  type AgentSystemExtensionPackageSource,
} from "./AgentSystemExtensionDiscovery.js";
import { resolveAgentSystemToolPresentation } from "./AgentSystemToolPresentation.js";
import { validateAgentToolResourceManifests } from "../ToolRuntime/AgentToolResourceManifestValidation.js";

export type { AgentSystemExtensionConfigurationSettings } from "./AgentSystemExtensionConfiguration.js";

export interface AgentSystemExtensionCatalogOptions {
  readonly capabilities: ReadonlySet<string>;
  readonly configurations?: Readonly<Record<string, AgentSystemExtensionConfig>>;
  readonly platform?: AgentSystemExtensionPlatform;
}

export interface AgentSystemMcpContribution {
  readonly extensionId: string;
  readonly descriptorPath: string;
}

export interface AgentSystemExtensionToolSettingsItem {
  readonly name: string;
  readonly description: AgentExtensionLocalizedText;
  readonly loading: string;
  readonly capability: string;
  /** Resolved domain, extension, and Tool-level workflow presentation. */
  readonly presentation: AgentToolPresentation;
}

export interface AgentSystemExtensionSettingsItem {
  readonly id: string;
  /** Declared owner for the package's user-facing settings configuration. */
  readonly settingsSurface: AgentSystemExtensionSettingsSurface;
  /** Stable authoring domain; unrelated to extension IDs or capability names. */
  readonly domain: {
    readonly id: string;
    readonly displayName: AgentExtensionLocalizedText;
    readonly description: AgentExtensionLocalizedText;
    readonly presentation: AgentToolPresentation;
  };
  readonly version: string;
  readonly displayName: AgentExtensionLocalizedText;
  readonly description: AgentExtensionLocalizedText;
  /** Resolved domain and extension-level presentation default. */
  readonly presentation: AgentToolPresentation;
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly priority?: number;
  readonly tools: readonly AgentSystemExtensionToolSettingsItem[];
  readonly skillCount: number;
  readonly mcpServerCount: number;
  readonly configuration?: AgentSystemExtensionConfigurationSettings;
}

/**
 * Traverses System extension packages and registers their contributions.
 * Manifest parsing, configuration materialization, and package path security
 * are delegated to focused collaborators.
 */
export class AgentSystemExtensionCatalog {
  private readonly json = new AgentJsonFileLoader();
  private readonly contracts = new AgentJsonSchemaPromptContractProjector();
  private readonly ajv = new Ajv({ allErrors: true, strict: true, validateFormats: false });
  private readonly configurations = new AgentSystemExtensionConfigurationReader();
  private readonly bindings = new Map<string, Set<string>>();
  private readonly mcpContributions: AgentSystemMcpContribution[] = [];
  private readonly extensions: AgentSystemExtensionSettingsItem[] = [];
  private readonly dedicatedSettingsSurfaces = new Map<string, string>();

  registerRoot(registry: AgentExtensionRegistry, rootPath: string, options: AgentSystemExtensionCatalogOptions): void {
    const packages = discoverAgentSystemExtensionPackages(rootPath);
    const packageIds = new Set(packages.map((source) => source.manifest.id));
    for (const source of packages) this.registerPackage(registry, source, options);
    this.applySkillToolBindings(registry);
    const unknownConfigurations = Object.keys(options.configurations ?? {}).filter((id) => !packageIds.has(id));
    if (unknownConfigurations.length > 0) {
      throw new Error(
        `Configuration references unknown System extensions: ${unknownConfigurations.sort().join(", ")}.`,
      );
    }
  }

  skillToolBindings(): ReadonlyMap<string, readonly string[]> {
    return new Map(
      [...this.bindings].map(([skill, tools]) => [skill, [...tools].sort((left, right) => left.localeCompare(right))]),
    );
  }

  listMcpContributions(): readonly AgentSystemMcpContribution[] {
    return [...this.mcpContributions];
  }

  listExtensions(): readonly AgentSystemExtensionSettingsItem[] {
    return [...this.extensions].sort(
      (left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id),
    );
  }

  private applySkillToolBindings(registry: AgentExtensionRegistry): void {
    const skillsBySource = new Map<string, RegisteredSkill[]>();
    for (const skill of registry.listSkills()) {
      if (skill.source.kind !== "system") continue;
      const sourceId = `system:${skill.source.id}`;
      const skills = skillsBySource.get(sourceId) ?? [];
      skills.push(skill);
      skillsBySource.set(sourceId, skills);
    }

    for (const [sourceId, skills] of skillsBySource) {
      let changed = false;
      const projected = skills.map((skill) => {
        const recommendedTools = [...new Set([...skill.recommendedTools, ...(this.bindings.get(skill.name) ?? [])])];
        if (recommendedTools.length === skill.recommendedTools.length) return skill;
        changed = true;
        return { ...skill, recommendedTools };
      });
      if (changed) registry.replaceSkills(sourceId, projected);
    }
  }

  private registerPackage(
    registry: AgentExtensionRegistry,
    sourcePackage: AgentSystemExtensionPackageSource,
    options: AgentSystemExtensionCatalogOptions,
  ): void {
    const packageRoot = sourcePackage.packageRoot;
    const manifest = deepFreeze(sourcePackage.manifest);
    if (!isAgentSystemExtensionApplicable(manifest.platforms, options.platform)) return;
    if (this.extensions.some((extension) => extension.id === manifest.id)) {
      throw new Error(`Duplicate System extension id: ${manifest.id}.`);
    }

    const configured = options.configurations?.[manifest.id];
    const enabled = configured?.Enabled ?? true;
    this.assertDedicatedSettingsSurface(manifest);
    const displayName = resolveAgentExtensionLocalizedText(manifest.displayName);
    const description = resolveAgentExtensionLocalizedText(manifest.description);
    const extensionPresentation = resolveAgentSystemToolPresentation(
      sourcePackage.domain.presentation,
      manifest.presentation,
    );
    const owner = {
      kind: "system" as const,
      name: manifest.id,
      title: displayName,
      description,
      rootPath: packageRoot,
      revision: agentDirectoryRevision(packageRoot),
      priority: manifest.priority,
      trusted: true,
      requiresApproval: false,
    };
    const contributions = manifest.contributions ?? [];
    const toolContributions = contributions.filter(
      (contribution): contribution is AgentSystemHostToolContribution => contribution.kind === "hostTool",
    );
    const sidecarToolContributions = contributions.filter(
      (contribution): contribution is AgentSystemSidecarToolContribution => contribution.kind === "sidecarTool",
    );
    assertUnique(
      toolContributions.map((contribution) => contribution.contract),
      `contract in ${manifest.id}`,
    );
    assertUnique(
      toolContributions.map((contribution) => contribution.capability),
      `capability in ${manifest.id}`,
    );
    const projectedTools = toolContributions.map((contribution) => {
      if (!options.capabilities.has(contribution.capability)) {
        throw new Error(
          `System extension ${manifest.id} references unregistered host capability ${contribution.capability}.`,
        );
      }
      const contractPath = resolveSystemExtensionPackageFile(packageRoot, contribution.contract, "host Tool contract");
      const contract = this.readContract(contractPath);
      const presentation = resolveAgentSystemToolPresentation(extensionPresentation, contract.presentation);
      for (const skill of enabled ? contribution.recommendedForSkills : []) {
        const toolNames = this.bindings.get(skill) ?? new Set<string>();
        toolNames.add(contract.name);
        this.bindings.set(skill, toolNames);
      }
      return {
        registered: this.project(owner, contract, contribution.capability, contribution.childGrant, presentation),
        settings: {
          name: contract.name,
          description: localizeSystemToolDescription(contract.search?.Summary ?? contract.description),
          loading: contract.loading,
          capability: contribution.capability,
          presentation: deepFreeze(presentation),
        },
      };
    });
    if (enabled && projectedTools.length > 0) {
      registry.registerToolExtension(
        owner,
        projectedTools.map((tool) => tool.registered),
      );
    }
    const sidecarTools = sidecarToolContributions.map((contribution) =>
      this.projectSidecarTool(
        owner,
        this.readSidecarContract(
          resolveSystemExtensionPackageFile(packageRoot, contribution.contract, "sidecar Tool contract"),
        ),
        contribution.capability,
      ),
    );
    if (enabled && sidecarTools.length > 0) registry.registerSidecarToolExtension(owner, sidecarTools);

    const skills = contributions
      .filter((contribution) => contribution.kind === "skill")
      .map((contribution) => {
        const skillRoot = resolveSystemExtensionPackageDirectory(packageRoot, contribution.path, "Skill contribution");
        const skill = new AgentSkillScanner().readSkillDirectory(skillRoot);
        return {
          ...skill,
          source: {
            kind: "system" as const,
            id: manifest.id,
            displayName,
            priority: manifest.priority,
          },
        };
      });
    if (enabled && skills.length > 0) registry.replaceSkills(`system:${manifest.id}`, skills);

    for (const contribution of enabled ? contributions.filter((entry) => entry.kind === "mcpServer") : []) {
      this.mcpContributions.push({
        extensionId: manifest.id,
        descriptorPath: resolveSystemExtensionPackageFile(packageRoot, contribution.descriptor, "MCP descriptor"),
      });
    }

    const configuration = this.configurations.read(packageRoot, manifest, configured?.Configuration);
    const mcpServerCount = contributions.filter((entry) => entry.kind === "mcpServer").length;
    // Sidecar-only packages are runtime implementation details. They remain
    // registered for their owning subsystem but do not create an empty entry
    // in the user-facing system-tools settings surface.
    if (projectedTools.length > 0 || skills.length > 0 || mcpServerCount > 0 || configuration) {
      this.extensions.push({
        id: manifest.id,
        settingsSurface: manifest.settingsSurface,
        domain: {
          id: sourcePackage.domain.id,
          displayName: sourcePackage.domain.displayName,
          description: sourcePackage.domain.description,
          presentation: deepFreeze(sourcePackage.domain.presentation),
        },
        version: manifest.version,
        displayName: manifest.displayName,
        description: manifest.description,
        presentation: deepFreeze(extensionPresentation),
        enabled,
        configured: configured !== undefined,
        priority: manifest.priority,
        tools: projectedTools.map((tool) => tool.settings),
        skillCount: skills.length,
        mcpServerCount,
        ...(configuration ? { configuration } : {}),
      });
    }
  }

  private assertDedicatedSettingsSurface(manifest: AgentSystemExtensionManifest): void {
    if (manifest.settingsSurface === AgentSystemExtensionSettingsSurfaces.SystemTools) return;
    const occupiedBy = this.dedicatedSettingsSurfaces.get(manifest.settingsSurface);
    if (occupiedBy) {
      throw new Error(
        `System settings surface '${manifest.settingsSurface}' is declared by both ${occupiedBy} and ${manifest.id}.`,
      );
    }
    this.dedicatedSettingsSurfaces.set(manifest.settingsSurface, manifest.id);
  }

  private readContract(filePath: string): AgentSystemToolContract {
    const loaded = this.json.load(filePath, AgentSystemToolContractSchema) as AgentSystemToolContract;
    validateAgentToolResourceManifests(loaded.resources);
    const source = deepFreeze({
      ...loaded,
      inputSchema: ensureObjectRootJsonSchema(loaded.inputSchema, `System Tool ${loaded.name} input`),
    });
    this.ajv.compile(source.inputSchema);
    if (source.outputSchema) this.ajv.compile(source.outputSchema);
    assertArtifactPolicyTemplates(source.artifacts, {
      argumentsSchema: source.inputSchema,
      resultSchema: source.outputSchema,
    });
    return source;
  }

  private readSidecarContract(filePath: string): AgentSystemSidecarToolContract {
    const source = deepFreeze(
      this.json.load(filePath, AgentSystemSidecarToolContractSchema) as AgentSystemSidecarToolContract,
    );
    this.ajv.compile(source.inputSchema);
    return source;
  }

  private project(
    owner: RegisteredTool["owner"],
    source: AgentSystemToolContract,
    capability: string,
    childGrant: RegisteredTool["childGrant"],
    presentation: NonNullable<RegisteredTool["presentation"]>,
  ): RegisteredTool {
    const description = resolveSystemToolDescription(source.description);
    return {
      owner,
      name: source.name,
      loading: source.loading,
      ...(source.planningModes ? { planningModes: source.planningModes } : {}),
      contract: deepFreeze({
        digest: sha256HexOfCanonicalJson({
          planningModes: source.planningModes,
          inputSchema: source.inputSchema,
          outputSchema: source.outputSchema,
          resultStorage: source.runtime.ResultStorage,
          artifacts: source.artifacts,
          surfaces: source.surfaces,
          resources: source.resources,
        }),
        arguments: this.contracts.project(source.inputSchema),
        outputSchema: source.outputSchema,
      }),
      permissions: source.permissions,
      handler: { kind: "HostCapability", capability, resources: source.resources },
      execution: source.execution,
      runtime: source.runtime,
      perception: source.perception,
      presentation: deepFreeze(presentation),
      sources: source.sources,
      search: source.search ?? { Summary: description },
      childGrant,
      evidenceCapabilities: source.evidenceCapabilities,
      approval: source.approval,
      artifactPolicy: source.artifacts,
      interactionSurfaces: source.surfaces,
    };
  }

  private projectSidecarTool(
    owner: RegisteredTool["owner"],
    source: AgentSystemSidecarToolContract,
    capability: string,
  ): RegisteredSidecarTool {
    return {
      owner,
      name: source.name,
      capability,
      description: source.description,
      instructions: source.instructions,
      inputSchema: ensureObjectRootJsonSchema(source.inputSchema, `System sidecar tool ${source.name} input`),
    };
  }
}

function localizeSystemToolDescription(value: string | AgentExtensionLocalizedText): AgentExtensionLocalizedText {
  return typeof value === "string" ? createAgentExtensionLocalizedText(value) : value;
}

function resolveSystemToolDescription(value: string | AgentExtensionLocalizedText): string {
  return typeof value === "string" ? value : resolveAgentExtensionLocalizedText(value);
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}
