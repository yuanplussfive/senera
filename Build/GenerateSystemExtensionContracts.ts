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
} from "../Source/AgentSystem/Types/AgentToolContractTypes.js";
import { AgentJsonFileLoader } from "../Source/AgentSystem/Config/AgentJsonFileLoader.js";
import {
  AgentSystemExtensionManifestSchema,
  AgentSystemToolContractSchema,
  AgentToolObservationProjectionSchema,
} from "../Source/AgentSystem/SystemTools/AgentSystemExtensionManifest.js";
import { resolveSystemExtensionPackageFile } from "../Source/AgentSystem/SystemTools/AgentSystemExtensionPackagePath.js";

const check = process.argv.includes("--check");
const outputRoot = path.join(process.cwd(), "System", "Extensions");
const definitions = createAgentSystemTools({ ModelProviders: [] });

for (const group of groupByExtension(definitions)) await synchronizeExtension(group);
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
      inputSchema: z.toJSONSchema(definition.input, { target: "draft-7", io: "input" }),
      outputSchema: z.toJSONSchema(definition.output, { target: "draft-7", io: "output" }),
      observationProjection: observationPath,
      permissions: [...(metadata.permissions ?? [])],
      execution: metadata.execution ?? { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
      runtime: metadata.runtime ?? {
        Lifecycle: "Immediate",
        ProtocolVersion: AgentHostToolProtocolVersion,
        ResultAssessment: ToolResultAssessmentPolicies.ProcessExit,
      },
      resources: [...(metadata.resources ?? [])],
      sources: [...(metadata.sources ?? [])],
      search: metadata.search,
      evidenceCapabilities: [...(metadata.evidenceCapabilities ?? [])],
      artifacts: metadata.artifacts,
    });
    await synchronize(path.join(extensionRoot, observationPath), {
      $schema: "https://schemas.senera.ai/tool-observation-projection/v1.json",
      ...metadata.observation,
    });
  }
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
    for (const contribution of manifest.contributions) {
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
