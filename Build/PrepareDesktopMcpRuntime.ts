import fs from "node:fs";
import { cp, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { build, type Metafile } from "esbuild";
import { isMainModule, isPathWithin } from "../Source/AgentSystem/Core/AgentPath.js";

export const DesktopMcpRuntimeStageDirectory = path.join(".cache", "desktop-mcp-runtime");

interface McpPackageManifest {
  readonly server?: unknown;
  readonly _meta?: unknown;
}

interface RootPackageManifest {
  readonly engines?: {
    readonly node?: unknown;
  };
}

interface McpNodeBundleEntry {
  readonly name: string;
  readonly sourceEntryPoint: string;
  readonly entryPoint: string;
}

interface McpRuntimeAsset {
  readonly source: string;
  readonly target: string;
}

export interface DesktopMcpRuntimePreparationResult {
  readonly stageRoot: string;
  readonly packageCount: number;
  readonly bundledPackageNames: readonly string[];
}

if (isMainModule(import.meta.url)) {
  const result = await prepareDesktopMcpRuntime(process.cwd());
  process.stdout.write(
    `Desktop MCP runtime prepared: ${result.packageCount} packages, ${result.bundledPackageNames.length} bundled Node servers.\n`,
  );
}

/**
 * Build the bundled MCP collection used by Electron. Dependencies remain owned
 * by the root project and are resolved by esbuild at build time; the staged
 * resource contains executable server bundles plus manifest-declared native
 * runtime assets rather than a copied node_modules.
 */
export async function prepareDesktopMcpRuntime(workspaceRoot: string): Promise<DesktopMcpRuntimePreparationResult> {
  const root = path.resolve(workspaceRoot);
  const sourceRoot = path.join(root, "McpServers");
  const stageRoot = resolveDesktopMcpRuntimeStageRoot(root);
  const nodeTarget = readNodeBuildTarget(root);
  const packages = discoverMcpPackages(root, sourceRoot);
  const stagingRoot = await mkdtemp(path.join(path.dirname(stageRoot), ".desktop-mcp-runtime-"));

  try {
    const stageMcpRoot = path.join(stagingRoot, "McpServers");
    await mkdir(stageMcpRoot, { recursive: true });
    const bundles: McpNodeBundleEntry[] = [];

    for (const packageRoot of packages) {
      const targetRoot = path.join(stageMcpRoot, packageRoot.name);
      const bundle = packageRoot.nodeBundle;
      await cp(packageRoot.root, targetRoot, {
        recursive: true,
        force: true,
        filter: (source) => !bundle || !containsNodeModules(packageRoot.root, source),
      });
      for (const asset of packageRoot.runtimeAssets) {
        await cp(asset.source, path.join(targetRoot, asset.target), { force: true });
      }

      if (!bundle) continue;
      const targetEntryPoint = path.join(targetRoot, bundle.entryPoint);
      await mkdir(path.dirname(targetEntryPoint), { recursive: true });
      await buildNodeMcpBundle(root, bundle.sourceEntryPoint, targetEntryPoint, nodeTarget);
      bundles.push(bundle);
    }

    await rm(stageRoot, { recursive: true, force: true });
    await rename(stagingRoot, stageRoot);
    return {
      stageRoot,
      packageCount: packages.length,
      bundledPackageNames: bundles.map((bundle) => bundle.name),
    };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export function resolveDesktopMcpRuntimeStageRoot(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), DesktopMcpRuntimeStageDirectory);
}

function discoverMcpPackages(
  workspaceRoot: string,
  sourceRoot: string,
): readonly {
  readonly name: string;
  readonly root: string;
  readonly nodeBundle?: McpNodeBundleEntry;
  readonly runtimeAssets: readonly McpRuntimeAsset[];
}[] {
  if (!isDirectory(sourceRoot)) return [];

  return fs
    .readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith(".") && entry.isDirectory() && !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const root = path.join(sourceRoot, entry.name);
      const manifestPath = path.join(root, "manifest.json");
      const manifest = fs.existsSync(manifestPath) ? readManifest(manifestPath) : undefined;
      return {
        name: entry.name,
        root,
        nodeBundle: manifest ? readNodeBundleEntry(root, entry.name, manifestPath, manifest) : undefined,
        runtimeAssets: manifest ? readRuntimeAssets(workspaceRoot, entry.name, manifest) : [],
      };
    });
}

function readNodeBundleEntry(
  packageRoot: string,
  packageName: string,
  manifestPath: string,
  manifest: McpPackageManifest,
): McpNodeBundleEntry | undefined {
  const server = record(manifest.server);
  if (!server || server.type !== "node") return undefined;

  const entryPoint = text(server.entry_point);
  if (!entryPoint) {
    throw new Error(`Node MCP package ${packageName} must declare server.entry_point in ${manifestPath}.`);
  }

  const sourceEntryPoint = path.resolve(packageRoot, entryPoint);
  if (!isPathWithin(packageRoot, sourceEntryPoint) || !isFile(sourceEntryPoint)) {
    throw new Error(`Node MCP package ${packageName} has an invalid server.entry_point: ${entryPoint}.`);
  }

  return {
    name: packageName,
    sourceEntryPoint,
    entryPoint: path.relative(packageRoot, sourceEntryPoint),
  };
}

function readRuntimeAssets(
  workspaceRoot: string,
  packageName: string,
  manifest: McpPackageManifest,
): readonly McpRuntimeAsset[] {
  const metadata = record(manifest._meta);
  const runtime = record(metadata?.["ai.senera/runtime-assets"]);
  const declarations = runtime?.["node_modules"];
  if (declarations === undefined) return [];
  if (!Array.isArray(declarations)) {
    throw new Error(`MCP package ${packageName} runtime assets must declare an array in manifest.json.`);
  }
  return declarations.flatMap((declaration) => {
    const entry = record(declaration);
    const dependency = text(entry?.package);
    const files = entry?.files;
    if (!dependency || !Array.isArray(files) || files.some((file) => typeof file !== "string" || !file.trim())) {
      throw new Error(`MCP package ${packageName} has an invalid runtime asset declaration in manifest.json.`);
    }
    const dependencyRoot = path.resolve(workspaceRoot, "node_modules", ...dependency.split("/"));
    const sourceRoot = path.resolve(dependencyRoot);
    return files.map((file) => {
      const relativeFile = file.trim().replaceAll("\\", "/");
      const source = path.resolve(sourceRoot, relativeFile);
      if (!isPathWithin(sourceRoot, source) || !isFile(source)) {
        throw new Error(`MCP package ${packageName} runtime asset is missing: ${dependency}/${relativeFile}.`);
      }
      return {
        source,
        target: path.basename(relativeFile),
      };
    });
  });
}

async function buildNodeMcpBundle(
  workspaceRoot: string,
  sourceEntryPoint: string,
  targetEntryPoint: string,
  nodeTarget: string,
): Promise<void> {
  const result = await build({
    absWorkingDir: workspaceRoot,
    bundle: true,
    entryPoints: [sourceEntryPoint],
    outfile: targetEntryPoint,
    platform: "node",
    format: "esm",
    target: nodeTarget,
    sourcemap: false,
    metafile: true,
    logLevel: "silent",
    legalComments: "eof",
  });
  assertSelfContainedBundle(result.metafile, workspaceRoot, targetEntryPoint);
}

function readNodeBuildTarget(workspaceRoot: string): string {
  const packagePath = path.join(workspaceRoot, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8")) as RootPackageManifest;
  const nodeRange = text(packageJson.engines?.node);
  const major = nodeRange?.match(/\d+/u)?.[0];
  if (!major) throw new Error(`Root package.json must declare a numeric Node engine for MCP bundling: ${packagePath}.`);
  return `node${major}`;
}

function assertSelfContainedBundle(
  metafile: Metafile | undefined,
  workspaceRoot: string,
  targetEntryPoint: string,
): void {
  if (!metafile) throw new Error(`MCP bundle did not produce dependency metadata: ${targetEntryPoint}.`);
  const output = Object.entries(metafile.outputs).find(
    ([filePath]) => path.resolve(workspaceRoot, filePath) === path.resolve(targetEntryPoint),
  )?.[1];
  if (!output) throw new Error(`MCP bundle output was not reported by esbuild: ${targetEntryPoint}.`);

  const externalImports = (output.imports ?? [])
    .filter((entry) => entry.external && !isNodeBuiltin(entry.path))
    .map((entry) => entry.path);
  if (externalImports.length > 0) {
    throw new Error(`MCP bundle has unresolved runtime dependencies: ${externalImports.join(", ")}.`);
  }
}

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:") || builtinModules.includes(specifier);
}

function readManifest(filePath: string): McpPackageManifest {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as McpPackageManifest;
  } catch (error) {
    throw new Error(`Unable to read MCP manifest ${filePath}.`, { cause: error });
  }
}

function containsNodeModules(root: string, source: string): boolean {
  const relative = path.relative(root, source);
  return relative.split(path.sep).includes("node_modules");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isDirectory(value: string): boolean {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function isFile(value: string): boolean {
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
}
