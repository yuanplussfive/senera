import { createHash } from "node:crypto";
import fs from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import crossSpawn from "cross-spawn";
import { isMainModule } from "../Source/AgentSystem/Core/AgentPath.js";

const { sync: spawnSync } = crossSpawn;

export const ElectronNativeStageDirectory = path.join(".cache", "electron-native");
type NativeModuleArtifactPathResolver = (
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
) => readonly string[];

const NativeModuleArtifactPaths = {
  "better-sqlite3": (platform: NodeJS.Platform, architecture: NodeJS.Architecture) => [
    `prebuilds/${platform}-${architecture}.node`,
    ...(platform === "linux" ? [`prebuilds/linuxmusl-${architecture}.node`] : []),
    "build/Release/better_sqlite3.node",
  ],
} as const satisfies Record<string, NativeModuleArtifactPathResolver>;

export type ElectronNativeModuleName = keyof typeof NativeModuleArtifactPaths;
const ElectronNativeModuleNames = Object.keys(NativeModuleArtifactPaths) as readonly ElectronNativeModuleName[];

export interface ElectronNativeModuleInstance {
  readonly name: ElectronNativeModuleName;
  readonly sourceRoot: string;
  readonly relativePath: string;
}

interface NativeStageModule {
  readonly name: ElectronNativeModuleName;
  readonly relativePath: string;
  readonly artifactPath: string;
}

interface NativeStageManifest {
  fingerprint: string;
  electronVersion: string;
  platform: NodeJS.Platform;
  architecture: NodeJS.Architecture;
  modules: readonly NativeStageModule[];
}

if (isMainModule(import.meta.url)) {
  const result = await prepareElectronNativeModules(process.cwd());
  process.stdout.write(`${result.stageRoot}\n`);
}

export async function prepareElectronNativeModules(workspaceRoot: string): Promise<{
  stageRoot: string;
  prepared: boolean;
}> {
  const electronVersion = readPackageVersion(path.join(workspaceRoot, "node_modules", "electron"));
  const nativeModules = discoverElectronNativeModuleInstances(workspaceRoot);
  if (nativeModules.length === 0) {
    throw new Error(`No installed native modules were found for ${ElectronNativeModuleNames.join(", ")}.`);
  }

  const stageRoot = resolveElectronNativeStageRoot(workspaceRoot, electronVersion, process.arch, process.platform);
  const fingerprint = await nativeStageFingerprint(electronVersion, process.platform, process.arch, nativeModules);
  if (isCurrentStage(stageRoot, fingerprint, electronVersion, process.platform, process.arch, nativeModules)) {
    return { stageRoot, prepared: false };
  }

  const stageParent = path.dirname(stageRoot);
  await mkdir(stageParent, { recursive: true });
  const stagingRoot = await mkdtemp(path.join(stageParent, ".stage-"));
  try {
    for (const nativeModule of nativeModules) {
      await copyNativeModuleSource(nativeModule, stagingRoot);
    }
    rebuildNativeModules(stagingRoot, nativeModules, electronVersion, process.platform, process.arch);
    const stagedModules = assertNativeStage(stagingRoot, nativeModules, process.platform, process.arch);
    await writeFile(
      path.join(stagingRoot, "manifest.json"),
      `${JSON.stringify(
        {
          fingerprint,
          electronVersion,
          platform: process.platform,
          architecture: process.arch,
          modules: stagedModules,
        } satisfies NativeStageManifest,
        null,
        2,
      )}\n`,
      "utf8",
    );
    await rm(stageRoot, { recursive: true, force: true });
    await rename(stagingRoot, stageRoot);
    return { stageRoot, prepared: true };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export function resolveElectronNativeStageRoot(
  workspaceRoot: string,
  electronVersion: string,
  architecture: NodeJS.Architecture,
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(
    workspaceRoot,
    ElectronNativeStageDirectory,
    `electron-${electronVersion}-${platform}-${architecture}`,
  );
}

function rebuildNativeModules(
  stagingRoot: string,
  nativeModules: readonly ElectronNativeModuleInstance[],
  electronVersion: string,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): void {
  for (const nativeModule of nativeModules) {
    const moduleRoot = path.join(stagingRoot, nativeModule.relativePath);
    if (hasNativeModuleArtifact(moduleRoot, nativeModule.name, platform, architecture)) continue;

    const result = spawnSync(
      "electron-rebuild",
      [
        "--force",
        "--module-dir",
        moduleRoot,
        "--version",
        electronVersion,
        "--platform",
        platform,
        "--arch",
        architecture,
      ],
      {
        cwd: stagingRoot,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `Electron native module rebuild failed for ${nativeModule.relativePath} with exit code ${result.status}.`,
      );
    }
  }
}

async function copyNativeModuleSource(nativeModule: ElectronNativeModuleInstance, stagingRoot: string): Promise<void> {
  const targetRoot = path.join(stagingRoot, nativeModule.relativePath);
  await cp(nativeModule.sourceRoot, targetRoot, {
    recursive: true,
    force: true,
    filter: (source) => !isNativeBuildOutput(nativeModule.sourceRoot, source),
  });
}

function isNativeBuildOutput(packageRoot: string, source: string): boolean {
  const [first] = path.relative(packageRoot, source).split(path.sep).filter(Boolean);
  return first === "build";
}

async function nativeStageFingerprint(
  electronVersion: string,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
  nativeModules: readonly ElectronNativeModuleInstance[],
): Promise<string> {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify({
      electronVersion,
      platform,
      architecture,
      modules: nativeModules.map(({ name, relativePath }) => ({ name, relativePath })),
    }),
  );
  for (const nativeModule of nativeModules) {
    hash.update(await readFile(path.join(nativeModule.sourceRoot, "package.json")));
  }
  return hash.digest("hex");
}

function isCurrentStage(
  stageRoot: string,
  fingerprint: string,
  electronVersion: string,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
  nativeModules: readonly ElectronNativeModuleInstance[],
): boolean {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(stageRoot, "manifest.json"), "utf8")) as NativeStageManifest;
    if (
      manifest.fingerprint !== fingerprint ||
      manifest.electronVersion !== electronVersion ||
      manifest.platform !== platform ||
      manifest.architecture !== architecture ||
      !Array.isArray(manifest.modules) ||
      !manifest.modules.every(isNativeStageModule) ||
      !sameNativeModuleSet(manifest.modules, nativeModules)
    ) {
      return false;
    }
    assertExistingNativeStage(stageRoot, manifest.modules, platform, architecture);
    return true;
  } catch {
    return false;
  }
}

function assertNativeStage(
  stageRoot: string,
  nativeModules: readonly ElectronNativeModuleInstance[],
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): readonly NativeStageModule[] {
  const missing = nativeModules.flatMap((nativeModule) => {
    const moduleRoot = path.join(stageRoot, nativeModule.relativePath);
    return hasNativeModuleArtifact(moduleRoot, nativeModule.name, platform, architecture)
      ? []
      : [`${nativeModule.relativePath} (${nativeModuleArtifactDescription(nativeModule.name)})`];
  });
  if (missing.length > 0) {
    throw new Error(`Electron native module staging is incomplete: ${missing.join(", ")}`);
  }
  return nativeModules.map((nativeModule) => ({
    name: nativeModule.name,
    relativePath: nativeModule.relativePath,
    artifactPath: resolveNativeModuleArtifactPath(
      path.join(stageRoot, nativeModule.relativePath),
      nativeModule.name,
      platform,
      architecture,
    )!,
  }));
}

function assertExistingNativeStage(
  stageRoot: string,
  nativeModules: readonly NativeStageModule[],
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): void {
  const missing = nativeModules.filter((nativeModule) => {
    const moduleRoot = path.join(stageRoot, nativeModule.relativePath);
    return (
      resolveNativeModuleArtifactPath(moduleRoot, nativeModule.name, platform, architecture) !==
      nativeModule.artifactPath
    );
  });
  if (missing.length > 0) {
    throw new Error(
      `Electron native module staging is incomplete: ${missing.map((module) => module.relativePath).join(", ")}`,
    );
  }
}

function sameNativeModuleSet(
  stagedModules: readonly NativeStageModule[],
  nativeModules: readonly ElectronNativeModuleInstance[],
): boolean {
  if (stagedModules.length !== nativeModules.length) return false;
  return nativeModules.every(
    (nativeModule, index) =>
      stagedModules[index]?.name === nativeModule.name &&
      stagedModules[index]?.relativePath === nativeModule.relativePath,
  );
}

function isNativeStageModule(value: unknown): value is NativeStageModule {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<NativeStageModule>;
  return (
    isElectronNativeModuleName(candidate.name) &&
    typeof candidate.relativePath === "string" &&
    typeof candidate.artifactPath === "string"
  );
}

export function nativeModuleArtifactRelativePaths(
  moduleName: ElectronNativeModuleName,
  platform: NodeJS.Platform = process.platform,
  architecture: NodeJS.Architecture = process.arch,
): readonly string[] {
  return NativeModuleArtifactPaths[moduleName](platform, architecture);
}

export function discoverElectronNativeModuleInstances(workspaceRoot: string): readonly ElectronNativeModuleInstance[] {
  const root = path.resolve(workspaceRoot);
  return ElectronNativeModuleNames.flatMap((name) =>
    findInstalledModuleRoots(path.join(root, "node_modules"), name).map((sourceRoot) => ({
      name,
      sourceRoot,
      relativePath: path.relative(root, sourceRoot).split(path.sep).join("/"),
    })),
  ).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function findInstalledModuleRoots(nodeModulesRoot: string, moduleName: string): readonly string[] {
  const roots: string[] = [];
  const visitedNodeModules = new Set<string>();

  function scan(directory: string): void {
    const realDirectory = realPath(directory);
    if (!realDirectory || visitedNodeModules.has(realDirectory)) return;
    visitedNodeModules.add(realDirectory);
    if (!isDirectory(directory)) return;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".bin") continue;
      const packageRoot = path.join(directory, entry.name);
      if (!isDirectory(packageRoot)) continue;

      if (entry.name === moduleName && isFile(path.join(packageRoot, "package.json"))) {
        roots.push(packageRoot);
      }

      if (entry.name.startsWith("@")) {
        for (const scopedEntry of fs.readdirSync(packageRoot, { withFileTypes: true })) {
          const scopedPackageRoot = path.join(packageRoot, scopedEntry.name);
          if (scopedEntry.isDirectory() || isDirectory(scopedPackageRoot)) scanPackageRoot(scopedPackageRoot);
        }
      } else {
        scanPackageRoot(packageRoot);
      }
    }
  }

  function scanPackageRoot(packageRoot: string): void {
    const nestedNodeModules = path.join(packageRoot, "node_modules");
    if (isDirectory(nestedNodeModules)) scan(nestedNodeModules);
  }

  scan(nodeModulesRoot);
  return [...new Set(roots.map((root) => path.resolve(root)))].sort();
}

function isElectronNativeModuleName(value: unknown): value is ElectronNativeModuleName {
  return typeof value === "string" && (ElectronNativeModuleNames as readonly string[]).includes(value);
}

function hasNativeModuleArtifact(
  moduleRoot: string,
  moduleName: ElectronNativeModuleName,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): boolean {
  return resolveNativeModuleArtifactPath(moduleRoot, moduleName, platform, architecture) !== undefined;
}

function resolveNativeModuleArtifactPath(
  moduleRoot: string,
  moduleName: ElectronNativeModuleName,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): string | undefined {
  return nativeModuleArtifactRelativePaths(moduleName, platform, architecture).find((relativePath) =>
    fs.existsSync(path.join(moduleRoot, relativePath)),
  );
}

function nativeModuleArtifactDescription(moduleName: ElectronNativeModuleName): string {
  return nativeModuleArtifactRelativePaths(moduleName).join(" or ");
}

function readPackageVersion(packageRoot: string): string {
  const parsed = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as { version: string };
  return parsed.version;
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(directory: string): boolean {
  try {
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

function realPath(filePath: string): string | undefined {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return undefined;
  }
}
