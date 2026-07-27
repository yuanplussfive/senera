import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { createPluginConfigurationArtifacts } from "@senera/tool-plugin-sdk";
import type { PluginConfigurationDefinition } from "@senera/tool-plugin-sdk";
import { readOptionalUtf8, synchronizeGeneratedFile } from "./GeneratedTextFile.js";

const ConfigurationDefinitionFileName = "PluginConfig.definition.cjs";
const check = process.argv.includes("--check");
const workspaceRoot = process.cwd();
const collectionRoots = [path.join(workspaceRoot, "System", "Plugins"), path.join(workspaceRoot, "Plugins")];
const changed: string[] = [];

for (const pluginRoot of discoverPluginRoots(collectionRoots)) {
  const definitionPath = path.join(pluginRoot, ConfigurationDefinitionFileName);
  if (!fs.existsSync(definitionPath)) continue;

  const definition = loadPluginConfigurationDefinition(definitionPath) as PluginConfigurationDefinition<unknown>;
  const artifacts = createPluginConfigurationArtifacts(definition);
  syncArtifact(path.join(pluginRoot, "PluginConfig.schema.toml"), artifacts.schemaToml);
  syncArtifact(path.join(pluginRoot, "PluginConfig.example.toml"), artifacts.exampleToml);
}

process.stdout.write(
  changed.length === 0
    ? "Plugin configuration artifacts are current.\n"
    : `Plugin configuration artifacts updated: ${changed.length}\n`,
);

function discoverPluginRoots(roots: readonly string[]): string[] {
  return roots.flatMap((root) => {
    if (!fs.existsSync(root)) return [];
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  });
}

function loadPluginConfigurationDefinition(definitionPath: string): unknown {
  const module = createRequire(import.meta.url)(definitionPath) as { configuration?: unknown };
  if (!module.configuration) {
    throw new Error(`${definitionPath} must export a configuration value.`);
  }
  return module.configuration;
}

function syncArtifact(filePath: string, expected: string): void {
  if (readOptionalUtf8(filePath) === expected) return;
  changed.push(path.relative(workspaceRoot, filePath));
  synchronizeGeneratedFile({
    filePath,
    content: expected,
    check,
    regenerateCommand: "npm run generate.plugin-config",
  });
}
