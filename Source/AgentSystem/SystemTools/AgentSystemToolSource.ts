import { Ajv } from "ajv";
import { assertArtifactPolicyTemplates } from "../Artifacts/AgentArtifactTemplatePreflight.js";
import { AgentJsonFileLoader } from "../Config/AgentJsonFileLoader.js";
import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import { agentDirectoryRevision } from "../Core/AgentDirectoryRevision.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import {
  createAgentExtensionLocalizedText,
  resolveAgentExtensionLocalizedText,
  type AgentExtensionLocalizedText,
} from "../Extensions/AgentExtensionLocalization.js";
import { AgentSkillScanner } from "../Skills/AgentSkillScanner.js";
import type { RegisteredSkill } from "../Skills/AgentSkillTypes.js";
import { createAgentToolContract } from "../ToolContracts/AgentToolContractIdentity.js";
import { ensureObjectRootJsonSchema } from "../ToolContracts/AgentJsonSchemaObjectRoot.js";
import { AgentToolModelOutputJsonSchemaKeyword } from "../ToolContracts/AgentToolModelOutput.js";
import type { AgentJsonSchema } from "../ToolContracts/AgentJsonSchemaPointer.js";
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
import {
  inspectAgentToolPresentationSchemaBindings,
  resolveAgentSystemToolPresentation,
} from "./AgentSystemToolPresentation.js";
import { validateAgentToolResourceManifests } from "../ToolRuntime/AgentToolResourceManifestValidation.js";

export type { AgentSystemExtensionConfigurationSettings } from "./AgentSystemExtensionConfiguration.js";

export interface AgentSystemExtensionCatalogOptions {
  /** Host capabilities implemented by the runtime that owns this catalog. */
  readonly capabilities: ReadonlySet<string>;
  /**
   * Complete capability namespace understood by this runtime family. When a
   * composition supplies fewer executable capabilities, packages requiring a
   * missing known capability are not published into that composition. A
   * contribution outside this namespace remains a hard contract error.
   */
  readonly capabilityUniverse?: ReadonlySet<string>;
  /**
   * Host capabilities that this runtime expects packages to publish exactly
   * once. This is deliberately separate from `capabilities`: focused catalog
   * tests can supply a small capability universe, while a production runtime
   * can make a missing package contract a startup error.
   */
  readonly requiredHostCapabilities?: ReadonlySet<string>;
  /** Internal sidecar capabilities that this runtime expects packages to publish exactly once. */
  readonly requiredSidecarCapabilities?: ReadonlySet<string>;
  readonly configurations?: Readonly<Record<string, AgentSystemExtensionConfig>>;
  readonly platform?: AgentSystemExtensionPlatform;
}

interface AgentSystemExtensionToolPublication {
  readonly extensionId: string;
  readonly kind: "hostTool" | "sidecarTool";
  readonly capability: string;
  readonly name: string;
  readonly contractPath: string;
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
  readonly documentation?: AgentExtensionLocalizedText;
  readonly skills?: readonly { readonly name: string; readonly title?: string; readonly description: string }[];
  readonly usageExamples?: readonly import("../Extensions/AgentPluginUsageExamples.js").AgentPluginUsageExample[];
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
  // Package schemas use normal JSON Schema composition to express cross-field
  // requirements. AJV's strictRequired lint only accepts repeated property
  // declarations inside each composition branch, which would duplicate the
  // public contract rather than strengthen it.
  private readonly ajv = new Ajv({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateFormats: false,
  }).addKeyword(AgentToolModelOutputJsonSchemaKeyword);
  private readonly configurations = new AgentSystemExtensionConfigurationReader();
  private readonly bindings = new Map<string, Set<string>>();
  private readonly mcpContributions: AgentSystemMcpContribution[] = [];
  private readonly extensions: AgentSystemExtensionSettingsItem[] = [];
  private readonly dedicatedSettingsSurfaces = new Map<string, string>();
  private readonly hostContracts = new Map<string, AgentSystemToolContract>();
  private readonly sidecarContracts = new Map<string, AgentSystemSidecarToolContract>();

  registerRoot(registry: AgentExtensionRegistry, rootPath: string, options: AgentSystemExtensionCatalogOptions): void {
    const packages = discoverAgentSystemExtensionPackages(rootPath);
    const packageIds = new Set(packages.map((source) => source.manifest.id));
    const platformPackages = packages.filter((source) =>
      isAgentSystemExtensionApplicable(source.manifest.platforms, options.platform),
    );
    this.assertKnownHostCapabilities(platformPackages, options.capabilityUniverse ?? options.capabilities);
    const applicablePackages = platformPackages.filter((source) =>
      this.isExecutableInRuntime(source, options.capabilities),
    );
    this.preflightPublishedContracts(applicablePackages, options);
    for (const source of applicablePackages) this.registerPackage(registry, source, options);
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

  listExtensions(skills: readonly RegisteredSkill[] = []): readonly AgentSystemExtensionSettingsItem[] {
    return this.extensions
      .map((extension) => {
        const tools = new Set(extension.tools.map((tool) => tool.name));
        const related = new Map((extension.skills ?? []).map((skill) => [skill.name, skill]));
        for (const skill of skills) {
          if (skill.source.kind !== "system" || !skill.recommendedTools.some((tool) => tools.has(tool))) continue;
          related.set(skill.name, { name: skill.name, title: skill.title, description: skill.description });
        }
        return { ...extension, skills: [...related.values()], skillCount: related.size };
      })
      .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id));
  }

  private assertKnownHostCapabilities(
    packages: readonly AgentSystemExtensionPackageSource[],
    capabilityUniverse: ReadonlySet<string>,
  ): void {
    for (const sourcePackage of packages) {
      for (const contribution of sourcePackage.manifest.contributions ?? []) {
        if (contribution.kind !== "hostTool" || capabilityUniverse.has(contribution.capability)) continue;
        throw new Error(
          `System extension ${sourcePackage.manifest.id} references unregistered host capability ${contribution.capability}.`,
        );
      }
    }
  }

  private isExecutableInRuntime(
    sourcePackage: AgentSystemExtensionPackageSource,
    capabilities: ReadonlySet<string>,
  ): boolean {
    return (sourcePackage.manifest.contributions ?? [])
      .filter((contribution): contribution is AgentSystemHostToolContribution => contribution.kind === "hostTool")
      .every((contribution) => capabilities.has(contribution.capability));
  }

  /**
   * System package contracts are a closed publication set. Resolve every
   * contract before registering anything so duplicate symbols cannot be
   * hidden by registry priority and a missing required contract fails before
   * a partially populated runtime escapes.
   */
  private preflightPublishedContracts(
    packages: readonly AgentSystemExtensionPackageSource[],
    options: AgentSystemExtensionCatalogOptions,
  ): void {
    const unavailableRequiredCapabilities = [...(options.requiredHostCapabilities ?? [])].filter(
      (capability) => !options.capabilities.has(capability),
    );
    if (unavailableRequiredCapabilities.length > 0) {
      throw new Error(
        `Required System host capabilities are not registered by this runtime: ${unavailableRequiredCapabilities.sort().join(", ")}.`,
      );
    }

    const hostCapabilities = new Map<string, AgentSystemExtensionToolPublication>();
    const sidecarCapabilities = new Map<string, AgentSystemExtensionToolPublication>();
    const toolNames = new Map<string, AgentSystemExtensionToolPublication>();
    for (const sourcePackage of packages) {
      const packageRoot = sourcePackage.packageRoot;
      for (const contribution of sourcePackage.manifest.contributions ?? []) {
        if (contribution.kind === "hostTool") {
          const contractPath = resolveSystemExtensionPackageFile(
            packageRoot,
            contribution.contract,
            "host Tool contract",
          );
          const contract = this.readContract(contractPath);
          const publication: AgentSystemExtensionToolPublication = {
            extensionId: sourcePackage.manifest.id,
            kind: contribution.kind,
            capability: contribution.capability,
            name: contract.name,
            contractPath,
          };
          this.claimPublication(hostCapabilities, publication.capability, "host capability", publication);
          this.claimPublication(toolNames, publication.name, "tool name", publication);
          continue;
        }
        if (contribution.kind !== "sidecarTool") continue;
        const contractPath = resolveSystemExtensionPackageFile(
          packageRoot,
          contribution.contract,
          "sidecar Tool contract",
        );
        const contract = this.readSidecarContract(contractPath);
        const publication: AgentSystemExtensionToolPublication = {
          extensionId: sourcePackage.manifest.id,
          kind: contribution.kind,
          capability: contribution.capability,
          name: contract.name,
          contractPath,
        };
        this.claimPublication(sidecarCapabilities, publication.capability, "sidecar capability", publication);
        this.claimPublication(toolNames, publication.name, "tool name", publication);
      }
    }
    this.assertRequiredPublications(options.requiredHostCapabilities, hostCapabilities, "host capability");
    this.assertRequiredPublications(options.requiredSidecarCapabilities, sidecarCapabilities, "sidecar capability");
  }

  private claimPublication(
    publications: Map<string, AgentSystemExtensionToolPublication>,
    key: string,
    label: string,
    publication: AgentSystemExtensionToolPublication,
  ): void {
    const existing = publications.get(key);
    if (!existing) {
      publications.set(key, publication);
      return;
    }
    throw new Error(
      `System extension '${publication.extensionId}' publishes duplicate ${label} '${key}' from ${publication.contractPath}; it is already published by '${existing.extensionId}' from ${existing.contractPath}.`,
    );
  }

  private assertRequiredPublications(
    required: ReadonlySet<string> | undefined,
    publications: ReadonlyMap<string, AgentSystemExtensionToolPublication>,
    label: string,
  ): void {
    if (!required || required.size === 0) return;
    const missing = [...required].filter((capability) => !publications.has(capability)).sort();
    if (missing.length === 0) return;
    throw new Error(`System extension catalog is missing required ${label} publication(s): ${missing.join(", ")}.`);
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
    const projectedTools = toolContributions.map((contribution) => {
      const contractPath = resolveSystemExtensionPackageFile(packageRoot, contribution.contract, "host Tool contract");
      const contract = this.readContract(contractPath);
      const presentation = resolveAgentSystemToolPresentation(extensionPresentation, contract.presentation);
      this.assertPresentationBindings(contract.name, presentation, contract.inputSchema, contract.outputSchema);
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
    const sidecarTools = sidecarToolContributions.map((contribution) => {
      const contract = this.readSidecarContract(
        resolveSystemExtensionPackageFile(packageRoot, contribution.contract, "sidecar Tool contract"),
      );
      const presentation = resolveAgentSystemToolPresentation(extensionPresentation, contract.presentation);
      this.assertPresentationBindings(contract.name, presentation, contract.inputSchema, contract.outputSchema);
      return this.projectSidecarTool(owner, contract, contribution.capability, presentation);
    });
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
        displayName: manifest.displayName,
        description: manifest.description,
        ...(manifest.usageExamples ? { usageExamples: manifest.usageExamples } : {}),
        ...(manifest.documentation ? { documentation: manifest.documentation } : {}),
        skills: skills.map(({ name, title, description }) => ({ name, ...(title ? { title } : {}), description })),
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
    const cached = this.hostContracts.get(filePath);
    if (cached) return cached;
    const loaded = this.json.load(filePath, AgentSystemToolContractSchema) as AgentSystemToolContract;
    validateAgentToolResourceManifests(loaded.resources);
    const source = deepFreeze({
      ...loaded,
      inputSchema: ensureObjectRootJsonSchema(loaded.inputSchema, `System Tool ${loaded.name} input`),
    });
    this.ajv.compile(source.inputSchema);
    this.ajv.compile(source.outputSchema);
    assertArtifactPolicyTemplates(source.artifacts, {
      argumentsSchema: source.inputSchema,
      resultSchema: source.outputSchema,
    });
    this.hostContracts.set(filePath, source);
    return source;
  }

  private readSidecarContract(filePath: string): AgentSystemSidecarToolContract {
    const cached = this.sidecarContracts.get(filePath);
    if (cached) return cached;
    const source = deepFreeze(
      this.json.load(filePath, AgentSystemSidecarToolContractSchema) as AgentSystemSidecarToolContract,
    );
    this.ajv.compile(source.inputSchema);
    this.ajv.compile(source.outputSchema);
    this.sidecarContracts.set(filePath, source);
    return source;
  }

  private assertPresentationBindings(
    toolName: string,
    presentation: AgentToolPresentation,
    inputSchema: AgentJsonSchema,
    outputSchema: AgentJsonSchema,
  ): void {
    const failures = inspectAgentToolPresentationSchemaBindings({ inputSchema, outputSchema, presentation });
    if (failures.length === 0) return;
    throw new Error(`System Tool ${toolName} has invalid presentation bindings:\n- ${failures.join("\n- ")}`);
  }

  private project(
    owner: RegisteredTool["owner"],
    source: AgentSystemToolContract,
    capability: string,
    childGrant: RegisteredTool["childGrant"],
    presentation: NonNullable<RegisteredTool["presentation"]>,
  ): RegisteredTool {
    const description = resolveSystemToolDescription(source.description);
    const tool: RegisteredTool = {
      owner,
      name: source.name,
      description,
      loading: source.loading,
      ...(source.planningModes ? { planningModes: source.planningModes } : {}),
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
      interactionPlatforms: source.platforms,
    };
    return { ...tool, contract: createAgentToolContract(tool, source.inputSchema, source.outputSchema) };
  }

  private projectSidecarTool(
    owner: RegisteredTool["owner"],
    source: AgentSystemSidecarToolContract,
    capability: string,
    presentation: AgentToolPresentation,
  ): RegisteredSidecarTool {
    return {
      owner,
      name: source.name,
      capability,
      description: source.description,
      instructions: source.instructions,
      inputSchema: ensureObjectRootJsonSchema(source.inputSchema, `System sidecar tool ${source.name} input`),
      outputSchema: source.outputSchema,
      presentation: deepFreeze(presentation),
    };
  }
}

function localizeSystemToolDescription(value: string | AgentExtensionLocalizedText): AgentExtensionLocalizedText {
  return typeof value === "string" ? createAgentExtensionLocalizedText(value) : value;
}

function resolveSystemToolDescription(value: string | AgentExtensionLocalizedText): string {
  return typeof value === "string" ? value : resolveAgentExtensionLocalizedText(value);
}
