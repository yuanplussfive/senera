import fs from "node:fs";
import path from "node:path";
import { format, resolveConfig } from "prettier";
import { z } from "zod";
import { Ajv } from "ajv";
import { synchronizeGeneratedFile } from "./GeneratedTextFile.js";
import { createAgentSystemTools } from "../Source/AgentSystem/SystemTools/AgentSystemTools.js";
import { systemToolCapability } from "../Source/AgentSystem/SystemTools/AgentSystemToolCatalog.js";
import type { AgentSystemToolDefinition } from "../Source/AgentSystem/SystemTools/AgentSystemToolDefinition.js";
import {
  AgentHostToolProtocolVersion,
  ToolResultAssessmentPolicies,
  ToolSchedulingModes,
} from "../Source/AgentSystem/Types/AgentToolContractTypes.js";
import { AgentJsonFileLoader } from "../Source/AgentSystem/Config/AgentJsonFileLoader.js";
import {
  AgentSystemSidecarToolContractSchema,
  AgentSystemToolContractSchema,
} from "../Source/AgentSystem/SystemTools/AgentSystemExtensionManifest.js";
import { resolveSystemExtensionPackageFile } from "../Source/AgentSystem/SystemTools/AgentSystemExtensionPackagePath.js";
import { validateAgentToolResourceManifests } from "../Source/AgentSystem/ToolRuntime/AgentToolResourceManifestValidation.js";
import { AgentBundledHostToolInputContracts } from "../Source/AgentSystem/SystemTools/AgentBundledHostToolInputContracts.js";
import { AgentOrchestrationConfigurationContracts } from "../Source/AgentSystem/Orchestration/AgentOrchestrationConfig.js";
import { ensureObjectRootJsonSchema } from "../Source/AgentSystem/ToolContracts/AgentJsonSchemaObjectRoot.js";
import { assertAgentSelfCommandContract } from "../Source/AgentSystem/SelfService/AgentSelfCommandContract.js";
import {
  discoverAgentSystemExtensionPackages,
  type AgentSystemExtensionPackageSource,
} from "../Source/AgentSystem/SystemTools/AgentSystemExtensionDiscovery.js";

const check = process.argv.includes("--check");
const outputRoot = path.join(process.cwd(), "System", "Extensions");
const definitions = createAgentSystemTools({ ModelProviders: [] });
const packageSources = discoverAgentSystemExtensionPackages(outputRoot);
const packageSourcesById = new Map(packageSources.map((source) => [source.manifest.id, source]));

assertAgentSelfCommandContract();

for (const group of groupByExtension(definitions)) await synchronizeExtension(group);
await synchronizeBundledHostToolInputContracts();
await synchronizeBundledExtensionConfigurationContracts();
validateBundledExtensionToolSchemas();

console.log(`Generated System extension contracts ${check ? "verified" : "synchronized"}.`);

async function synchronizeExtension(definitions: readonly AgentSystemToolDefinition[]): Promise<void> {
  const first = definitions[0];
  if (!first) return;
  const packageSource = requirePackageSource(first.extension.name);
  const extensionRoot = packageSource.packageRoot;
  const existing = packageSource.manifest;
  const configuration = readExtensionConfiguration(definitions);
  const contributions = definitions.map((definition) => ({
    kind: "hostTool",
    contract: `tools/${definition.name}.tool.json`,
    capability: systemToolCapability(definition),
    ...(definition.extension.childGrant ? { childGrant: definition.extension.childGrant } : {}),
    recommendedForSkills: [...(definition.extension.skills ?? [])],
  }));
  await synchronize(path.join(extensionRoot, "extension.json"), {
    $schema: "https://schemas.senera.ai/extension/v1.json",
    schemaVersion: 1,
    id: first.extension.name,
    domain: existing.domain,
    settingsSurface: existing.settingsSurface,
    version: existing.version,
    displayName: first.extension.displayName,
    description: first.extension.description,
    priority: first.extension.priority ?? existing.priority,
    ...(first.extension.platforms ? { platforms: [...first.extension.platforms] } : {}),
    ...(existing.presentation ? { presentation: existing.presentation } : {}),
    ...(configuration ? { configuration: { schema: "config.schema.json", ui: "ui.schema.json" } } : {}),
    contributions: [...contributions, ...(existing.contributions ?? []).filter((entry) => entry.kind !== "hostTool")],
  });
  if (configuration) {
    await synchronize(
      path.join(extensionRoot, "config.schema.json"),
      draftSevenJsonSchema(configuration.schema, "input"),
    );
    await synchronize(path.join(extensionRoot, "ui.schema.json"), configuration.ui);
  }
  for (const definition of definitions) {
    const metadata = definition.metadata;
    const contractPath = path.join(extensionRoot, "tools", `${definition.name}.tool.json`);
    const existingContract = new AgentJsonFileLoader().load(contractPath, AgentSystemToolContractSchema);
    validateAgentToolResourceManifests(existingContract.resources);
    const generatedContract = {
      name: definition.name,
      // The package contract owns provider exposure. The schema requires this
      // declaration, so generation never needs a hidden loading fallback.
      loading: existingContract.loading,
      ...(existingContract.planningModes ? { planningModes: existingContract.planningModes } : {}),
      description: metadata.description,
      ...(existingContract.presentation ? { presentation: existingContract.presentation } : {}),
      inputSchema: ensureObjectRootJsonSchema(
        draftSevenJsonSchema(definition.input, "input"),
        `System Tool ${definition.name} input`,
      ),
      outputSchema: draftSevenJsonSchema(definition.output, "output"),
      ...(metadata.perception ? { perception: metadata.perception } : {}),
      permissions: [...(metadata.permissions ?? [])],
      execution: metadata.execution ?? { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
      runtime: projectRuntime(metadata.runtime),
      resources: [...(metadata.resources ?? [])],
      sources: [...(metadata.sources ?? [])],
      search: metadata.search,
      evidenceCapabilities: [...(metadata.evidenceCapabilities ?? [])],
      approval: metadata.approval,
      artifacts: metadata.artifacts,
    };
    validateAgentToolResourceManifests(generatedContract.resources);
    await synchronize(contractPath, generatedContract);
  }
}

function projectRuntime(runtime: AgentSystemToolDefinition["metadata"]["runtime"]) {
  const resolved = runtime ?? {
    Lifecycle: "Immediate" as const,
    ProtocolVersion: AgentHostToolProtocolVersion,
    ResultAssessment: ToolResultAssessmentPolicies.ProcessExit,
  };
  return {
    ...resolved,
    Scheduling: resolved.Scheduling ?? ToolSchedulingModes.Parallel,
  };
}

function readExtensionConfiguration(definitions: readonly AgentSystemToolDefinition[]) {
  const configuration = definitions[0]?.extension.configuration;
  const expected = configuration ? configurationSignature(configuration) : undefined;
  for (const definition of definitions) {
    const candidate = definition.extension.configuration;
    const actual = candidate ? configurationSignature(candidate) : undefined;
    if (actual !== expected) {
      throw new Error(`System extension ${definition.extension.name} must declare one shared configuration contract.`);
    }
  }
  return configuration;
}

function configurationSignature(configuration: NonNullable<AgentSystemToolDefinition["extension"]["configuration"]>) {
  return JSON.stringify({
    schema: draftSevenJsonSchema(configuration.schema, "input"),
    ui: configuration.ui,
  });
}

async function synchronize(filePath: string, value: unknown): Promise<void> {
  synchronizeGeneratedFile({
    filePath,
    content: await format(JSON.stringify(value), { ...(await resolveConfig(filePath)), filepath: filePath }),
    check,
    regenerateCommand: "npm run generate.system-extension-contracts",
  });
}

function groupByExtension(definitions: readonly AgentSystemToolDefinition[]): AgentSystemToolDefinition[][] {
  const groups = new Map<string, AgentSystemToolDefinition[]>();
  for (const definition of definitions) {
    const group = groups.get(definition.extension.name) ?? [];
    group.push(definition);
    groups.set(definition.extension.name, group);
  }
  return [...groups.values()];
}

function requirePackageSource(extensionId: string): AgentSystemExtensionPackageSource {
  const source = packageSourcesById.get(extensionId);
  if (!source) {
    throw new Error(
      `System extension '${extensionId}' has runtime definitions but no declared package under System/Extensions/<domain>/.`,
    );
  }
  return source;
}

async function synchronizeBundledHostToolInputContracts(): Promise<void> {
  const contributions = bundledHostToolContributions();

  for (const definition of AgentBundledHostToolInputContracts) {
    const contribution = contributions.get(definition.capability);
    if (!contribution) {
      throw new Error(`Runtime Host Tool capability ${definition.capability} has no bundled extension contribution.`);
    }
    const contractSource = JSON.parse(fs.readFileSync(contribution.contractPath, "utf8")) as unknown;
    const contract = AgentSystemToolContractSchema.parse(contractSource);
    validateAgentToolResourceManifests(contract.resources);
    await synchronize(contribution.contractPath, {
      ...(contractSource as Record<string, unknown>),
      inputSchema: ensureObjectRootJsonSchema(
        draftSevenJsonSchema(definition.input, "input"),
        `Bundled Host Tool ${definition.capability} input`,
      ),
    });
  }
}

function bundledHostToolContributions(): Map<string, { readonly packageRoot: string; readonly contractPath: string }> {
  const contributions = new Map<string, { readonly packageRoot: string; readonly contractPath: string }>();
  for (const source of packageSources) {
    const { packageRoot, manifest } = source;
    for (const contribution of manifest.contributions ?? []) {
      if (contribution.kind !== "hostTool") continue;
      if (contributions.has(contribution.capability)) {
        throw new Error(`Bundled Host Tool capability ${contribution.capability} is declared more than once.`);
      }
      contributions.set(contribution.capability, {
        packageRoot,
        contractPath: resolveSystemExtensionPackageFile(packageRoot, contribution.contract, "host Tool contract"),
      });
    }
  }
  return contributions;
}

function validateBundledExtensionToolSchemas(): void {
  const json = new AgentJsonFileLoader();
  const compiler = new Ajv({ allErrors: true, strict: true, validateFormats: false });
  for (const source of packageSources) {
    for (const contribution of source.manifest.contributions ?? []) {
      if (contribution.kind !== "hostTool" && contribution.kind !== "sidecarTool") continue;
      const contractPath = resolveSystemExtensionPackageFile(
        source.packageRoot,
        contribution.contract,
        contribution.kind === "hostTool" ? "host Tool contract" : "sidecar Tool contract",
      );
      const contract =
        contribution.kind === "hostTool"
          ? json.load(contractPath, AgentSystemToolContractSchema)
          : json.load(contractPath, AgentSystemSidecarToolContractSchema);
      compiler.compile(contract.inputSchema);
      compiler.compile(contract.outputSchema);
    }
  }
}

async function synchronizeBundledExtensionConfigurationContracts(): Promise<void> {
  for (const definition of AgentOrchestrationConfigurationContracts) {
    const { packageRoot, manifest } = requirePackageSource(definition.extensionId);
    if (!manifest.configuration) {
      throw new Error(`Bundled extension ${definition.extensionId} has no configuration declaration.`);
    }
    const schemaPath = resolveSystemExtensionPackageFile(
      packageRoot,
      manifest.configuration.schema,
      "extension configuration schema",
    );
    await synchronize(schemaPath, draftSevenJsonSchema(definition.schema, "input"));
  }
}

/**
 * Zod's draft-07 emitter represents tuples with an `items` array, but does
 * not currently emit the tuple-closing keyword required by strict draft-07
 * validators. Complete the standard representation for every generated
 * schema, independent of the tool that introduced the tuple.
 */
function draftSevenJsonSchema(schema: z.ZodType, io: "input" | "output"): Readonly<Record<string, unknown>> {
  const normalized = normalizeDraftSevenTuples(z.toJSONSchema(schema, { target: "draft-7", io }));
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    throw new Error("Zod must emit a JSON Schema object for a bundled extension contract.");
  }
  return normalized as Readonly<Record<string, unknown>>;
}

function normalizeDraftSevenTuples(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeDraftSevenTuples);
  if (!value || typeof value !== "object") return value;

  const normalized = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, normalizeDraftSevenTuples(entry)]),
  );
  if (Array.isArray(normalized.items)) {
    normalized.additionalItems ??= false;
    normalized.minItems ??= normalized.items.length;
    normalized.maxItems ??= normalized.items.length;
  }
  return normalized;
}
