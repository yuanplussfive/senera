import crypto from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { createPluginConfigurationArtifacts } from "@senera/tool-plugin-sdk";
import type { PluginConfigurationDefinition } from "@senera/tool-plugin-sdk";

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

if (check && changed.length > 0) {
  throw new Error(`Plugin configuration artifacts are stale:\n${changed.map((file) => `- ${file}`).join("\n")}`);
}

process.stdout.write(
  changed.length === 0
    ? "Plugin configuration artifacts are current.\n"
    : `Plugin configuration artifacts ${check ? "would change" : "updated"}: ${changed.length}\n`,
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
  const actual = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : undefined;
  if (actual === expected) return;
  changed.push(path.relative(workspaceRoot, filePath));
  if (!check) writeUtf8Atomically(filePath, expected);
}

function writeUtf8Atomically(filePath: string, content: string): void {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  fs.writeFileSync(temporaryPath, content, { encoding: "utf8", flag: "wx" });
  try {
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}
