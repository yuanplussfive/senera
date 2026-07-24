import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { format, resolveConfig } from "prettier";
import { z } from "zod";
import {
  AgentToolContractVersion,
  type AgentToolContractBundle,
} from "../Source/AgentSystem/ToolContracts/AgentToolContractTypes.js";
import { readOptionalUtf8, writeUtf8Atomically } from "./GeneratedTextFile.js";
import { AgentTypescriptToolContractProjector } from "./ToolContracts/AgentTypescriptToolContractProjector.js";

interface SourceToolManifest {
  Name: string;
}

interface SourcePluginManifest {
  Tools?: SourceToolManifest[];
}

const ToolContractAuthoringManifestSchema = z
  .object({
    contractSourceVersion: z.literal(1),
    tools: z.record(
      z.string().min(1),
      z
        .object({
          file: z.string().min(1),
          type: z.string().min(1).optional(),
        })
        .strict(),
    ),
  })
  .strict();

type ToolContractAuthoringManifest = z.infer<typeof ToolContractAuthoringManifestSchema>;

const check = process.argv.includes("--check");
const workspaceRoot = process.cwd();
const prettierConfig = (await resolveConfig(path.join(workspaceRoot, "package.json"))) ?? {};
const pluginCollectionRoots = [path.join(workspaceRoot, "System", "Plugins"), path.join(workspaceRoot, "Plugins")];
const projector = new AgentTypescriptToolContractProjector();
const changed: string[] = [];

for (const { pluginRoot, manifestPath, manifest } of discoverPlugins(pluginCollectionRoots)) {
  const bundlePath = path.join(pluginRoot, "ToolContracts.json");
  const declaredTools = manifest.Tools ?? [];
  if (declaredTools.length === 0) continue;
  const authoring = readToolContractAuthoringManifest(pluginRoot);
  assertToolCoverage(manifestPath, declaredTools, authoring);
  const tools = Object.fromEntries(
    declaredTools.map((tool) => {
      const source = authoring.tools[tool.Name];
      if (!source) throw new Error(`${manifestPath}: ${tool.Name} has no contract authoring metadata.`);
      const sourcePath = resolveInsidePluginRoot(pluginRoot, source.file);
      const sourceText = fs.readFileSync(sourcePath, "utf8");
      const input = projector.projectFromFile(sourcePath, "arguments", source.type);
      if (!input) throw new Error(`${manifestPath}: ${tool.Name} did not produce an input contract.`);
      return [
        tool.Name,
        {
          source: {
            kind: "typescript" as const,
            identity: `${normalizeRelativePath(source.file)}#${source.type ?? "default"}`,
            file: normalizeRelativePath(source.file),
            ...(source.type ? { type: source.type } : {}),
            sha256: crypto.createHash("sha256").update(sourceText).digest("hex"),
          },
          inputSchema: annotateJsonSchema(structuredClone(input.jsonSchema), input.properties),
        },
      ];
    }),
  );

  const bundle: AgentToolContractBundle = { contractVersion: AgentToolContractVersion, tools };
  const expected = await format(JSON.stringify(bundle), { ...prettierConfig, parser: "json", filepath: bundlePath });
  const actual = readOptionalUtf8(bundlePath);
  if (actual === expected) continue;
  changed.push(path.relative(workspaceRoot, bundlePath));
  if (!check) writeUtf8Atomically(bundlePath, expected);
}

if (check && changed.length > 0) {
  throw new Error(`Tool contract bundles are stale:\n${changed.map((file) => `- ${file}`).join("\n")}`);
}

process.stdout.write(
  changed.length === 0
    ? "Tool contract bundles are current.\n"
    : `Tool contract bundles ${check ? "would change" : "updated"}: ${changed.length}\n`,
);

function discoverPlugins(
  collectionRoots: readonly string[],
): Array<{ pluginRoot: string; manifestPath: string; manifest: SourcePluginManifest }> {
  return collectionRoots.flatMap((collectionRoot) =>
    fs
      .readdirSync(collectionRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const pluginRoot = path.join(collectionRoot, entry.name);
        const manifestPath = path.join(pluginRoot, "PluginManifest.json");
        const content = readOptionalUtf8(manifestPath);
        return content === undefined
          ? []
          : [{ pluginRoot, manifestPath, manifest: JSON.parse(content) as SourcePluginManifest }];
      }),
  );
}

function readToolContractAuthoringManifest(pluginRoot: string): ToolContractAuthoringManifest {
  const authoringPath = path.join(pluginRoot, "ToolContractSource.json");
  const content = readOptionalUtf8(authoringPath);
  if (content === undefined) throw new Error(`${pluginRoot}: missing ToolContractSource.json for declared tools.`);
  return ToolContractAuthoringManifestSchema.parse(JSON.parse(content));
}

function assertToolCoverage(
  manifestPath: string,
  declaredTools: readonly SourceToolManifest[],
  authoring: ToolContractAuthoringManifest,
): void {
  const declared = new Set(declaredTools.map((tool) => tool.Name));
  const authored = new Set(Object.keys(authoring.tools));
  const missing = [...declared].filter((name) => !authored.has(name));
  const extraneous = [...authored].filter((name) => !declared.has(name));
  if (missing.length === 0 && extraneous.length === 0) return;
  throw new Error(
    [
      `${manifestPath}: tool contract authoring metadata does not match declared tools.`,
      ...(missing.length > 0 ? [`Missing: ${missing.join(", ")}`] : []),
      ...(extraneous.length > 0 ? [`Extraneous: ${extraneous.join(", ")}`] : []),
    ].join("\n"),
  );
}

function resolveInsidePluginRoot(pluginRoot: string, file: string): string {
  const root = path.resolve(pluginRoot);
  const resolved = path.resolve(root, file);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Tool contract authoring source must stay inside its plugin root: ${file}`);
  }
  return resolved;
}

function normalizeRelativePath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  return normalized.startsWith("./") ? normalized : `./${normalized}`;
}

function annotateJsonSchema(
  schema: Record<string, unknown>,
  properties: import("../Source/AgentSystem/Prompt/AgentPromptContractTypes.js").AgentPromptContractProperty[],
): Record<string, unknown> {
  const schemaProperties = recordValue(schema.properties);
  if (!schemaProperties) return schema;
  for (const property of properties) {
    const propertySchema = recordValue(schemaProperties[property.name]);
    if (!propertySchema) continue;
    if (property.comment) propertySchema.description = property.comment;
    if (property.xmlHint) propertySchema["x-senera-xml-hint"] = property.xmlHint;
    annotatePropertyChildren(schema, propertySchema, property);
  }
  return schema;
}

function annotatePropertyChildren(
  rootSchema: Record<string, unknown>,
  propertySchema: Record<string, unknown>,
  property: import("../Source/AgentSystem/Prompt/AgentPromptContractTypes.js").AgentPromptContractProperty,
): void {
  const resolved = resolveLocalSchema(rootSchema, propertySchema);
  const childSchemas = recordValue(resolved.properties);
  if (childSchemas) {
    for (const child of property.children) {
      const childSchema = recordValue(childSchemas[child.name]);
      if (!childSchema) continue;
      if (child.comment) childSchema.description = child.comment;
      if (child.xmlHint) childSchema["x-senera-xml-hint"] = child.xmlHint;
      annotatePropertyChildren(rootSchema, childSchema, child);
    }
  }
  const itemSchema = recordValue(resolved.items);
  if (itemSchema && property.element) annotatePropertyChildren(rootSchema, itemSchema, property.element);
}

function resolveLocalSchema(
  rootSchema: Record<string, unknown>,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const reference = typeof schema.$ref === "string" ? schema.$ref : undefined;
  if (!reference?.startsWith("#/")) return schema;
  let value: unknown = rootSchema;
  for (const segment of reference
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    value = recordValue(value)?.[segment];
  }
  return recordValue(value) ?? schema;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
