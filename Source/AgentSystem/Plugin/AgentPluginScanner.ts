import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { resolveFrom } from "../Core/AgentPath.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { PluginManifest, PluginRootKind } from "../Types/PluginManifestTypes.js";
import type { LoadedPlugin } from "../Types/PluginRuntimeTypes.js";
import { AgentJsonFileLoader } from "../Config/AgentJsonFileLoader.js";
import { PluginManifestSchema } from "../Schemas/PluginManifestSchema.js";
import { readLoadedPluginConfig } from "./AgentPluginConfig.js";
import { resolvePluginDiscoveryConfig, resolvePluginRootsConfig } from "../AgentDefaults.js";

export class AgentPluginScanner {
  constructor(
    private readonly workspaceRoot: string,
    private readonly config: AgentSystemConfig,
  ) {}

  scan(): LoadedPlugin[] {
    const roots = resolvePluginRootsConfig(this.config);
    const discovery = resolvePluginDiscoveryConfig(this.config);
    const pluginRoots: Array<{ kind: PluginRootKind; path: string }> = [
      ...roots.System.map((pluginRoot) => ({
        kind: "System" as const,
        path: pluginRoot,
      })),
      ...roots.User.map((pluginRoot) => ({
        kind: "User" as const,
        path: pluginRoot,
      })),
    ];

    const plugins: LoadedPlugin[] = [];

    for (const pluginRoot of pluginRoots) {
      const absoluteRoot = resolveFrom(this.workspaceRoot, pluginRoot.path);
      if (!fs.existsSync(absoluteRoot)) {
        continue;
      }

      for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }

        const rootPath = path.join(absoluteRoot, entry.name);
        const manifestPath = path.join(rootPath, discovery.ManifestFileName);

        if (!fs.existsSync(manifestPath)) {
          continue;
        }

        const manifest = new AgentJsonFileLoader().load(manifestPath, PluginManifestSchema) as PluginManifest;
        this.assertManifest(manifest, manifestPath);

        plugins.push({
          rootPath,
          rootKind: pluginRoot.kind,
          manifestPath,
          config: readLoadedPluginConfig(rootPath, this.config),
          manifest,
        });
      }
    }

    return plugins.sort((a, b) => a.manifest.Plugin.Name.localeCompare(b.manifest.Plugin.Name));
  }

  sourceRevision(): string {
    return AgentPluginScanner.sourceRevision(this.workspaceRoot, this.config);
  }

  static sourceRevision(workspaceRoot: string, config: AgentSystemConfig): string {
    const roots = resolvePluginRootsConfig(config);
    const discovery = resolvePluginDiscoveryConfig(config);
    const hash = crypto.createHash("sha256");
    for (const root of [...roots.System, ...roots.User]) {
      const absoluteRoot = resolveFrom(workspaceRoot, root);
      hash.update(root).update("\0");
      if (!fs.existsSync(absoluteRoot)) continue;
      for (const entry of fs
        .readdirSync(absoluteRoot, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory()) continue;
        const pluginRoot = path.join(absoluteRoot, entry.name);
        const manifestPath = path.join(pluginRoot, discovery.ManifestFileName);
        const dependencies = collectPluginSourceDependencies(workspaceRoot, pluginRoot, manifestPath, discovery);
        for (const filePath of [...dependencies].sort((left, right) => left.localeCompare(right))) {
          hash.update(path.relative(workspaceRoot, filePath)).update("\0");
          try {
            hash.update(fs.readFileSync(filePath));
          } catch (error) {
            if (!isMissingFile(error)) throw error;
            hash.update("<missing>");
          }
          hash.update("\0");
        }
      }
    }
    return hash.digest("hex");
  }

  private assertManifest(manifest: PluginManifest, manifestPath: string): void {
    if (!manifest?.Plugin?.Name || !manifest.Plugin.Version || !manifest.Plugin.Kind) {
      throw new Error(agentErrorMessage("plugin.manifestInvalid", { manifestPath }));
    }
  }
}

interface PluginDiscoveryIdentity {
  readonly ManifestFileName: string;
  readonly ConfigFileName: string;
}

function collectPluginSourceDependencies(
  workspaceRoot: string,
  pluginRoot: string,
  manifestPath: string,
  discovery: PluginDiscoveryIdentity,
): Set<string> {
  const dependencies = new Set<string>([
    manifestPath,
    path.join(pluginRoot, discovery.ConfigFileName),
    path.join(pluginRoot, "package.json"),
  ]);
  const configName = path.parse(discovery.ConfigFileName);
  dependencies.add(path.join(pluginRoot, `${configName.name}.schema${configName.ext}`));
  dependencies.add(path.join(pluginRoot, `${configName.name}.example${configName.ext}`));

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    return dependencies;
  }

  const addPluginFile = (value: unknown): void => {
    if (typeof value !== "string" || value.trim().length === 0) return;
    dependencies.add(resolveFrom(pluginRoot, value));
  };
  const runtimeFiles: string[] = [];
  const queuedRuntimeFiles = new Set<string>();
  const addRuntimeFile = (filePath: string): void => {
    dependencies.add(filePath);
    if (queuedRuntimeFiles.has(filePath) || !isRegularFile(filePath)) return;
    queuedRuntimeFiles.add(filePath);
    runtimeFiles.push(filePath);
  };
  const addRuntimeModule = (value: string): void => {
    const runtimeModulePattern = /\$\{runtimeModule:([^}]+)\}/gu;
    for (const match of value.matchAll(runtimeModulePattern)) {
      const modulePath = match[1];
      if (!modulePath) continue;
      const workspacePath = resolveFrom(workspaceRoot, modulePath);
      addRuntimeFile(workspacePath);
      addRuntimeFile(workspacePath.replace(/\.js$/iu, ".ts"));
    }
  };
  const addMcpTemplatePath = (value: string, key: string | undefined): void => {
    if (key !== "Args" && key !== "Command") return;
    const pluginTemplate = value.match(/^\$\{pluginRoot\}\/?(.+)$/u)?.[1];
    if (pluginTemplate) addRuntimeFile(resolveFrom(pluginRoot, pluginTemplate));
    const workspaceTemplate = value.match(/^\$\{workspaceRoot\}\/?(.+)$/u)?.[1];
    if (workspaceTemplate) addRuntimeFile(resolveFrom(workspaceRoot, workspaceTemplate));
  };
  const visit = (value: unknown, key?: string): void => {
    if (typeof value === "string") {
      addRuntimeModule(value);
      addMcpTemplatePath(value, key);
      if (key?.endsWith("File") || key === "Path") addPluginFile(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
  };
  visit(manifest);
  for (let index = 0; index < runtimeFiles.length; index += 1) {
    const runtimeFile = runtimeFiles[index]!;
    const source = readTextFile(runtimeFile);
    if (source === undefined) continue;
    for (const specifier of extractRelativeModuleSpecifiers(source)) {
      const dependency = resolveRuntimeImport(runtimeFile, specifier);
      addRuntimeFile(dependency);
    }
  }
  return dependencies;
}

function extractRelativeModuleSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /\b(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/gu,
    /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier?.startsWith(".")) specifiers.add(specifier);
    }
  }
  return [...specifiers];
}

function resolveRuntimeImport(importer: string, specifier: string): string {
  const raw = path.resolve(path.dirname(importer), specifier);
  const candidates = [
    raw,
    raw.replace(/\.js$/iu, ".ts"),
    raw.replace(/\.mjs$/iu, ".mts"),
    raw.replace(/\.cjs$/iu, ".cts"),
    `${raw}.ts`,
    `${raw}.tsx`,
    `${raw}.js`,
    `${raw}.mjs`,
    `${raw}.cjs`,
    path.join(raw, "index.ts"),
    path.join(raw, "index.js"),
  ];
  const existing = candidates.find(isRegularFile);
  return existing ?? raw;
}

function isRegularFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

function readTextFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
