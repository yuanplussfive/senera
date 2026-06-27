import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export interface DesktopRuntimePaths {
  appRoot: string;
  desktopDataRoot: string;
  workspaceRoot: string;
  configDatabasePath: string;
  configSeedPath: string;
  systemPluginRoot: string;
  userPluginRoot: string;
  frontendIndexHtml: string;
  windowIconPath: string;
  logPath: string;
}

const ConfigFileName = "senera.config.json";
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
  const userDataRoot = app.getPath("userData");
  const workspaceRoot = resolveWorkspaceRoot({
    appRoot,
    executableRoot: path.dirname(process.execPath),
    launchRoot: process.cwd(),
    userDataRoot,
  });
  const desktopDataRoot = path.join(userDataRoot, "runtime");
  const bundledSystemPlugins = path.join(appRoot, "System", "Plugins");
  const bundledUserPlugins = path.join(appRoot, "Plugins");
  const runtimeSystemPlugins = path.join(desktopDataRoot, "System", "Plugins");
  const runtimeUserPlugins = path.join(desktopDataRoot, "Plugins");
  const configDatabasePath = path.join(desktopDataRoot, ConfigDatabaseFileName);
  const configSeedPath = path.join(appRoot, ConfigTemplateFileName);

  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(desktopDataRoot, { recursive: true });
  syncDirectory(bundledSystemPlugins, runtimeSystemPlugins);
  syncDirectory(bundledUserPlugins, runtimeUserPlugins);
  syncPluginRuntimeDependencies({
    pluginRoots: [
      bundledSystemPlugins,
      bundledUserPlugins,
    ],
    sourceNodeModulesRoots: dependencySourceNodeModulesRoots(appRoot),
    targetNodeModulesRoot: path.join(desktopDataRoot, NodeModulesDirectoryName),
  });

  return {
    appRoot,
    desktopDataRoot,
    workspaceRoot,
    configDatabasePath,
    configSeedPath,
    systemPluginRoot: runtimeSystemPlugins,
    userPluginRoot: runtimeUserPlugins,
    frontendIndexHtml: path.join(appRoot, "Frontend", "dist", "index.html"),
    windowIconPath: path.join(appRoot, "Apps", "Desktop", "Assets", DesktopIconFileName),
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

function resolveWorkspaceRoot(paths: {
  appRoot: string;
  executableRoot: string;
  launchRoot: string;
  userDataRoot: string;
}): string {
  if (app.isPackaged) {
    return paths.userDataRoot;
  }

  for (const startPath of uniquePaths([
    paths.launchRoot,
    paths.executableRoot,
    paths.appRoot,
  ])) {
    const workspaceRoot = findWorkspaceRoot(startPath);
    if (workspaceRoot) {
      return workspaceRoot;
    }
  }

  return paths.userDataRoot;
}

function findWorkspaceRoot(startPath: string): string | undefined {
  let current = resolveDirectoryPath(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, ConfigFileName))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function resolveDirectoryPath(startPath: string): string {
  const resolved = path.resolve(startPath);
  return fs.existsSync(resolved) && fs.statSync(resolved).isFile()
    ? path.dirname(resolved)
    : resolved;
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((value) => path.resolve(value)))];
}

function syncDirectory(sourceRoot: string, targetRoot: string): void {
  if (!fs.existsSync(sourceRoot)) {
    return;
  }

  fs.mkdirSync(targetRoot, { recursive: true });

  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);

    if (entry.isDirectory()) {
      syncDirectory(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile()) {
      copyFileIfChanged(sourcePath, targetPath, {
        preserveExisting: entry.name === PluginConfigFileName,
      });
    }
  }
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
    const sourcePackageRoot = resolveDependencyPackageRoot(
      options.sourceNodeModulesRoots,
      request.name,
    );
    if (!sourcePackageRoot) {
      if (request.optional) {
        continue;
      }
      throw new Error(`桌面端插件运行依赖缺失：${request.name}`);
    }

    syncDirectory(
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

  return fs.readdirSync(pluginRoot, { withFileTypes: true })
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

function dependencyEntries(
  dependencies: Record<string, string> | undefined,
  optional: boolean,
): DependencyRequest[] {
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
  return appRoot.endsWith(".asar")
    ? appRoot.replace(/\.asar$/i, ".asar.unpacked")
    : appRoot;
}

function copyFileIfChanged(
  sourcePath: string,
  targetPath: string,
  options: { preserveExisting?: boolean } = {},
): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (options.preserveExisting && fs.existsSync(targetPath)) {
    return;
  }

  if (fs.existsSync(targetPath)) {
    const source = fs.statSync(sourcePath);
    const target = fs.statSync(targetPath);
    if (source.size === target.size && source.mtimeMs <= target.mtimeMs) {
      return;
    }
  }

  fs.copyFileSync(sourcePath, targetPath);
}
