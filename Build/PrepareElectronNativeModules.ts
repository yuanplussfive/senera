import { createHash } from "node:crypto";
import fs from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import crossSpawn from "cross-spawn";
import { isMainModule } from "../Source/AgentSystem/Core/AgentPath.js";

const { sync: spawnSync } = crossSpawn;

export const ElectronNativeStageDirectory = path.join(".cache", "electron-native");
export const ElectronNativeModuleNames = ["better-sqlite3"] as const;

interface NativeStageManifest {
  fingerprint: string;
  electronVersion: string;
  architecture: NodeJS.Architecture;
  modules: readonly string[];
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
  const stageRoot = resolveElectronNativeStageRoot(workspaceRoot, electronVersion, process.arch);
  const fingerprint = await nativeStageFingerprint(workspaceRoot, electronVersion, process.arch);
  if (isCurrentStage(stageRoot, fingerprint)) return { stageRoot, prepared: false };

  const stageParent = path.dirname(stageRoot);
  await mkdir(stageParent, { recursive: true });
  const stagingRoot = await mkdtemp(path.join(stageParent, ".stage-"));
  try {
    await writeFile(
      path.join(stagingRoot, "package.json"),
      `${JSON.stringify({ private: true, dependencies: nativeModuleVersions(workspaceRoot) }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(stagingRoot, "package-lock.json"),
      `${JSON.stringify({ name: "senera-electron-native-stage", lockfileVersion: 3, requires: true, packages: {} }, null, 2)}\n`,
      "utf8",
    );
    for (const moduleName of ElectronNativeModuleNames) {
      await copyNativeModuleSource(workspaceRoot, stagingRoot, moduleName);
    }
    rebuildNativeModules(stagingRoot, electronVersion, process.arch);
    assertNativeStage(stagingRoot);
    await writeFile(
      path.join(stagingRoot, "manifest.json"),
      `${JSON.stringify(
        {
          fingerprint,
          electronVersion,
          architecture: process.arch,
          modules: ElectronNativeModuleNames,
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
): string {
  return path.join(workspaceRoot, ElectronNativeStageDirectory, `electron-${electronVersion}-${architecture}`);
}

function rebuildNativeModules(
  stagingRoot: string,
  electronVersion: string,
  architecture: NodeJS.Architecture,
): void {
  const result = spawnSync(
    "electron-rebuild",
    [
      "--force",
      "--only",
      ElectronNativeModuleNames.join(","),
      "--module-dir",
      stagingRoot,
      "--version",
      electronVersion,
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
  if (result.status !== 0) throw new Error(`Electron native module rebuild failed with exit code ${result.status}.`);
}

async function copyNativeModuleSource(workspaceRoot: string, stagingRoot: string, moduleName: string): Promise<void> {
  const sourceRoot = path.join(workspaceRoot, "node_modules", ...moduleName.split("/"));
  const targetRoot = path.join(stagingRoot, "node_modules", ...moduleName.split("/"));
  await cp(sourceRoot, targetRoot, {
    recursive: true,
    force: true,
    filter: (source) => !isNativeBuildOutput(sourceRoot, source),
  });
}

function isNativeBuildOutput(packageRoot: string, source: string): boolean {
  const [first] = path.relative(packageRoot, source).split(path.sep).filter(Boolean);
  return first === "build";
}

function nativeModuleVersions(workspaceRoot: string): Record<string, string> {
  return Object.fromEntries(
    ElectronNativeModuleNames.map((moduleName) => [
      moduleName,
      readPackageVersion(path.join(workspaceRoot, "node_modules", ...moduleName.split("/"))),
    ]),
  );
}

async function nativeStageFingerprint(
  workspaceRoot: string,
  electronVersion: string,
  architecture: NodeJS.Architecture,
): Promise<string> {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ electronVersion, architecture }));
  for (const moduleName of ElectronNativeModuleNames) {
    hash.update(moduleName);
    hash.update(await readFile(path.join(workspaceRoot, "node_modules", ...moduleName.split("/"), "package.json")));
  }
  return hash.digest("hex");
}

function isCurrentStage(stageRoot: string, fingerprint: string): boolean {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(stageRoot, "manifest.json"), "utf8")) as NativeStageManifest;
    assertNativeStage(stageRoot);
    return manifest.fingerprint === fingerprint;
  } catch {
    return false;
  }
}

function assertNativeStage(stageRoot: string): void {
  const missing = ElectronNativeModuleNames.map((moduleName) =>
    path.join(stageRoot, "node_modules", ...moduleName.split("/"), "build", "Release", nativeBinaryName(moduleName)),
  ).filter((file) => !fs.existsSync(file));
  if (missing.length > 0) throw new Error(`Electron native module staging is incomplete: ${missing.join(", ")}`);
}

function nativeBinaryName(moduleName: (typeof ElectronNativeModuleNames)[number]): string {
  const names = {
    "better-sqlite3": "better_sqlite3.node",
  } as const satisfies Record<(typeof ElectronNativeModuleNames)[number], string>;
  return names[moduleName];
}

function readPackageVersion(packageRoot: string): string {
  const parsed = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as { version: string };
  return parsed.version;
}
