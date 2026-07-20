import fs from "node:fs";
import path from "node:path";
import electron from "electron";
import { syncRuntimeDirectory } from "../RuntimeAssetSync.js";
import { resolveDesktopResourceRoot, resolveDesktopWorkspaceRoot } from "./DesktopRuntimePathResolver.js";

const { app } = electron;

export interface DesktopRuntimePaths {
  appRoot: string;
  resourceRoot: string;
  desktopDataRoot: string;
  workspaceRoot: string;
  configDatabasePath: string;
  configSeedPath: string;
  systemPluginRoot: string;
  userPluginRoot: string;
  sandboxRuntimeRoot: string;
  sandboxBundleRoot: string;
  frontendIndexHtml: string;
  windowIconPath: string;
  logPath: string;
}

const ConfigTemplateFileName = "senera.config.example.json";
const ConfigDatabaseFileName = "Config.sqlite";
const PluginConfigFileName = "PluginConfig.toml";
const DesktopIconFileName = "senera-icon.png";
const NodeModulesDirectoryName = "node_modules";

interface PackageJson {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface DependencyRequest {
  name: string;
  optional: boolean;
}

export function prepareDesktopRuntime(): DesktopRuntimePaths {
  const appRoot = resolveAppRoot();
  const resourceRoot = resolveDesktopResourceRoot({
    appPath: appRoot,
    isPackaged: app.isPackaged,
    launchRoot: process.cwd(),
  });
  const userDataRoot = app.getPath("userData");
  const workspaceRoot = resolveDesktopWorkspaceRoot({
    isPackaged: app.isPackaged,
    resourceRoot,
    userDataRoot,
  });
  const desktopDataRoot = path.join(userDataRoot, "runtime");
  const bundledSystemPlugins = path.join(resourceRoot, "System", "Plugins");
  const bundledUserPlugins = path.join(resourceRoot, "Plugins");
  const runtimeSystemPlugins = path.join(desktopDataRoot, "System", "Plugins");
  const runtimeUserPlugins = path.join(desktopDataRoot, "Plugins");
  const configDatabasePath = path.join(desktopDataRoot, ConfigDatabaseFileName);
  const configSeedPath = path.join(resourceRoot, ConfigTemplateFileName);
  const sandboxRuntimeRoot = path.join(desktopDataRoot, "SandboxRuntime");
  const sandboxBundleRoot = path.join(desktopDataRoot, "SandboxBundles");
  const bundledTerminalRuntimeRoot = app.isPackaged
    ? path.join(resourceRoot, "TerminalSidecarRuntime")
    : path.join(resourceRoot, ".senera", "sandbox-runtime", "terminal-sidecar");

  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(desktopDataRoot, { recursive: true });
  syncRuntimeDirectory(bundledSystemPlugins, runtimeSystemPlugins, {
    preserveFileNames: [PluginConfigFileName],
    pruneExtraneous: true,
  });
  syncRuntimeDirectory(bundledUserPlugins, runtimeUserPlugins, {
    preserveFileNames: [PluginConfigFileName],
    pruneExtraneous: true,
  });
  syncPluginRuntimeDependencies({
    pluginRoots: [bundledSystemPlugins, bundledUserPlugins],
    sourceNodeModulesRoots: dependencySourceNodeModulesRoots(resourceRoot),
    targetNodeModulesRoot: path.join(desktopDataRoot, NodeModulesDirectoryName),
  });
  syncRuntimeDirectory(
    bundledTerminalRuntimeRoot,
    path.join(sandboxRuntimeRoot, "terminal-sidecar"),
    { pruneExtraneous: true },
  );

  return {
    appRoot,
    resourceRoot,
    desktopDataRoot,
    workspaceRoot,
    configDatabasePath,
    configSeedPath,
    systemPluginRoot: runtimeSystemPlugins,
    userPluginRoot: runtimeUserPlugins,
    sandboxRuntimeRoot,
    sandboxBundleRoot,
    frontendIndexHtml: path.join(resourceRoot, "Frontend", "dist", "index.html"),
    windowIconPath: path.join(resourceRoot, "Apps", "Desktop", "Assets", DesktopIconFileName),
    logPath: path.join(userDataRoot, "desktop.log"),
  };
}

export function appendDesktopLog(logPath: string, message: string): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function resolveAppRoot(): string {
  return app.getAppPath();
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((value) => path.resolve(value)))];
}

function syncPluginRuntimeDependencies(options: {
  pluginRoots: readonly string[];
  sourceNodeModulesRoots: readonly string[];
  targetNodeModulesRoot: string;
}): void {
  const queue: DependencyRequest[] = [];
  const visited = new Set<string>();

  for (const pluginRoot of options.pluginRoots) {
    for (const pluginPackage of readPluginPackageJsons(pluginRoot)) {
      queue.push(...packageDependencyRequests(pluginPackage));
    }
  }

  while (queue.length > 0) {
    const request = queue.shift();
    if (!request || visited.has(request.name)) {
      continue;
    }

    visited.add(request.name);
    const sourcePackageRoot = resolveDependencyPackageRoot(options.sourceNodeModulesRoots, request.name);
    if (!sourcePackageRoot) {
      if (request.optional) {
        continue;
      }
      throw new Error(`桌面端插件运行依赖缺失：${request.name}`);
    }

    syncRuntimeDirectory(
      sourcePackageRoot,
      path.join(options.targetNodeModulesRoot, ...packageNamePathParts(request.name)),
    );
    queue.push(...packageDependencyRequests(readPackageJson(sourcePackageRoot), request.optional));
  }
}

function readPluginPackageJsons(pluginRoot: string): PackageJson[] {
  if (!fs.existsSync(pluginRoot)) {
    return [];
  }

  return fs
    .readdirSync(pluginRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(pluginRoot, entry.name))
    .map(readPackageJson)
    .filter((value): value is PackageJson => Boolean(value));
}

function readPackageJson(packageRoot: string): PackageJson | undefined {
  const packageJsonPath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJson;
}

function packageDependencyRequests(
  packageJson: PackageJson | undefined,
  inheritedOptional = false,
): DependencyRequest[] {
  if (!packageJson) {
    return [];
  }

  return [
    ...dependencyEntries(packageJson.dependencies, inheritedOptional),
    ...dependencyEntries(packageJson.peerDependencies, true),
    ...dependencyEntries(packageJson.optionalDependencies, true),
  ];
}

function dependencyEntries(dependencies: Record<string, string> | undefined, optional: boolean): DependencyRequest[] {
  return Object.keys(dependencies ?? {}).map((name) => ({
    name,
    optional,
  }));
}

function resolveDependencyPackageRoot(
  sourceNodeModulesRoots: readonly string[],
  packageName: string,
): string | undefined {
  return sourceNodeModulesRoots
    .map((root) => path.join(root, ...packageNamePathParts(packageName)))
    .find((packageRoot) => fs.existsSync(path.join(packageRoot, "package.json")));
}

function packageNamePathParts(packageName: string): string[] {
  const parts = packageName.split("/");
  return packageName.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1);
}

function dependencySourceNodeModulesRoots(appRoot: string): string[] {
  return uniquePaths([
    path.join(unpackedAppRoot(appRoot), NodeModulesDirectoryName),
    path.join(appRoot, NodeModulesDirectoryName),
  ]).filter((root) => fs.existsSync(root));
}

function unpackedAppRoot(appRoot: string): string {
  return appRoot.endsWith(".asar") ? appRoot.replace(/\.asar$/i, ".asar.unpacked") : appRoot;
}
