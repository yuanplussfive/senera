import fs from "node:fs";
import path from "node:path";
import { format, resolveConfig } from "prettier";
import { z } from "zod";
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
  AgentSystemExtensionManifestSchema,
  AgentSystemToolContractSchema,
  AgentToolObservationProjectionSchema,
} from "../Source/AgentSystem/SystemTools/AgentSystemExtensionManifest.js";
import { resolveSystemExtensionPackageFile } from "../Source/AgentSystem/SystemTools/AgentSystemExtensionPackagePath.js";
import { AgentBundledHostToolInputContracts } from "../Source/AgentSystem/SystemTools/AgentBundledHostToolInputContracts.js";
import { AgentOrchestrationConfigurationContracts } from "../Source/AgentSystem/Orchestration/AgentOrchestrationConfig.js";
import { ensureObjectRootJsonSchema } from "../Source/AgentSystem/ToolContracts/AgentJsonSchemaObjectRoot.js";

const check = process.argv.includes("--check");
const outputRoot = path.join(process.cwd(), "System", "Extensions");
const definitions = createAgentSystemTools({ ModelProviders: [] });

for (const group of groupByExtension(definitions)) await synchronizeExtension(group);
await synchronizeBundledHostToolInputContracts();
await synchronizeBundledExtensionConfigurationContracts();
verifyBundledObservationProjections();

console.log(`Generated System extension contracts ${check ? "verified" : "synchronized"}.`);

async function synchronizeExtension(definitions: readonly AgentSystemToolDefinition[]): Promise<void> {
  const first = definitions[0];
  if (!first) return;
  const extensionRoot = path.join(outputRoot, first.extension.name);
  const configuration = readExtensionConfiguration(definitions);
  const contributions = definitions.map((definition) => ({
    kind: "hostTool",
    contract: `tools/${definition.name}.tool.json`,
    capability: systemToolCapability(definition),
    recommendedForSkills: [...(definition.extension.skills ?? [])],
  }));
  await synchronize(path.join(extensionRoot, "extension.json"), {
    $schema: "https://schemas.senera.ai/extension/v1.json",
    schemaVersion: 1,
    id: first.extension.name,
    version: "1.0.0",
    displayName: first.extension.displayName,
    description: first.extension.description,
    priority: first.extension.priority,
    ...(first.extension.platforms ? { platforms: [...first.extension.platforms] } : {}),
    ...(configuration ? { configuration: { schema: "config.schema.json", ui: "ui.schema.json" } } : {}),
    contributions,
  });
  if (configuration) {
    await synchronize(
      path.join(extensionRoot, "config.schema.json"),
      z.toJSONSchema(configuration.schema, { target: "draft-7", io: "input" }),
    );
    await synchronize(path.join(extensionRoot, "ui.schema.json"), configuration.ui);
  }
  for (const definition of definitions) {
    const metadata = definition.metadata;
    const observationPath = `observations/${definition.name}.projection.json`;
    await synchronize(path.join(extensionRoot, "tools", `${definition.name}.tool.json`), {
      name: definition.name,
      description: metadata.description,
      inputSchema: ensureObjectRootJsonSchema(
        z.toJSONSchema(definition.input, { target: "draft-7", io: "input" }),
        `System Tool ${definition.name} input`,
      ),
      outputSchema: z.toJSONSchema(definition.output, { target: "draft-7", io: "output" }),
      observationProjection: observationPath,
      permissions: [...(metadata.permissions ?? [])],
      execution: metadata.execution ?? { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
      runtime: projectRuntime(metadata.runtime),
      resources: [...(metadata.resources ?? [])],
      sources: [...(metadata.sources ?? [])],
      search: metadata.search,
      evidenceCapabilities: [...(metadata.evidenceCapabilities ?? [])],
      approval: metadata.approval,
      artifacts: metadata.artifacts,
    });
    await synchronize(path.join(extensionRoot, observationPath), {
      $schema: "https://schemas.senera.ai/tool-observation-projection/v2.json",
      ...metadata.observation,
    });
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
    schema: z.toJSONSchema(configuration.schema, { target: "draft-7", io: "input" }),
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

function verifyBundledObservationProjections(): void {
  const loader = new AgentJsonFileLoader();
  for (const entry of fs.readdirSync(outputRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
    const packageRoot = path.join(outputRoot, entry.name);
    const manifest = loader.load(path.join(packageRoot, "extension.json"), AgentSystemExtensionManifestSchema);
    const referenced = new Set<string>();
    const contributions = manifest.contributions ?? [];
    for (const contribution of contributions) {
      if (contribution.kind !== "hostTool") continue;
      const contractPath = resolveSystemExtensionPackageFile(packageRoot, contribution.contract, "host Tool contract");
      const contract = loader.load(contractPath, AgentSystemToolContractSchema);
      const projectionPath = resolveSystemExtensionPackageFile(
        packageRoot,
        contract.observationProjection,
        "Tool observation projection",
      );
      loader.load(projectionPath, AgentToolObservationProjectionSchema);
      referenced.add(path.normalize(projectionPath));
    }
    const observationRoot = path.join(packageRoot, "observations");
    const packaged = fs.existsSync(observationRoot)
      ? fs
          .readdirSync(observationRoot, { withFileTypes: true })
          .filter((file) => file.isFile() && !file.isSymbolicLink() && file.name.endsWith(".projection.json"))
          .map((file) => path.normalize(path.join(observationRoot, file.name)))
      : [];
    const orphaned = packaged.filter((file) => !referenced.has(file));
    if (orphaned.length > 0) {
      throw new Error(
        `System extension ${manifest.id} contains unreferenced observation projections: ${orphaned
          .map((file) => path.relative(packageRoot, file))
          .join(", ")}.`,
      );
    }
  }
}

async function synchronizeBundledHostToolInputContracts(): Promise<void> {
  const loader = new AgentJsonFileLoader();
  const contributions = new Map<string, { readonly packageRoot: string; readonly contractPath: string }>();

  for (const entry of fs.readdirSync(outputRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
    const packageRoot = path.join(outputRoot, entry.name);
    const manifest = loader.load(path.join(packageRoot, "extension.json"), AgentSystemExtensionManifestSchema);
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

  for (const definition of AgentBundledHostToolInputContracts) {
    const contribution = contributions.get(definition.capability);
    if (!contribution) {
      throw new Error(`Runtime Host Tool capability ${definition.capability} has no bundled extension contribution.`);
    }
    const contractSource = JSON.parse(fs.readFileSync(contribution.contractPath, "utf8")) as unknown;
    AgentSystemToolContractSchema.parse(contractSource);
    await synchronize(contribution.contractPath, {
      ...(contractSource as Record<string, unknown>),
      inputSchema: ensureObjectRootJsonSchema(
        z.toJSONSchema(definition.input, { target: "draft-7", io: "input" }),
        `Bundled Host Tool ${definition.capability} input`,
      ),
    });
  }
}

async function synchronizeBundledExtensionConfigurationContracts(): Promise<void> {
  const loader = new AgentJsonFileLoader();
  for (const definition of AgentOrchestrationConfigurationContracts) {
    const packageRoot = path.join(outputRoot, definition.extensionId);
    const manifest = loader.load(path.join(packageRoot, "extension.json"), AgentSystemExtensionManifestSchema);
    if (!manifest.configuration) {
      throw new Error(`Bundled extension ${definition.extensionId} has no configuration declaration.`);
    }
    const schemaPath = resolveSystemExtensionPackageFile(
      packageRoot,
      manifest.configuration.schema,
      "extension configuration schema",
    );
    await synchronize(schemaPath, z.toJSONSchema(definition.schema, { target: "draft-7", io: "input" }));
  }
}
