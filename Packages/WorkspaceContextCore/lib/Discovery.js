"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const fastGlob = require("fast-glob");
const ignore = require("ignore");
const {
  resolveExistingWorkspacePath,
  resolveWorkspacePath,
  toWorkspacePath
} = require("./Context.js");

async function prepareSearch(context, config, args) {
  const configuredRoots = await configuredSearchRoots(context, config);
  const requestedRoots = args.roots?.item ?? configuredRoots;
  const exclude = [
    ...config.exclude,
    ...(config.discovery.excludeDisabledPlugins ? await listDisabledManifestExcludes(context, config) : []),
    ...(args.exclude?.item ?? [])
  ];
  const rootResolution = await resolveExistingRoots(context, requestedRoots, { exclude });
  return {
    roots: rootResolution.roots,
    exclude,
    maxResults: args.maxResults ?? config.default_max_results,
    contextLines: args.contextLines ?? config.default_context_lines,
    warnings: rootResolution.warnings
  };
}

async function configuredSearchRoots(context, config) {
  return config.roots.length > 0
    ? config.roots
    : listAvailableRoots(context, config);
}

async function resolveExistingRoots(context, roots, options = {}) {
  const resolvedRoots = [];
  const warnings = [];
  const seen = new Set();
  for (const root of roots) {
    let absolutePath;
    try {
      absolutePath = await resolveExistingWorkspacePath(context, root, fsp);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (!absolutePath) {
      warnings.push(`工作区不存在 root：${root}。可用顶层 roots：${(await listAvailableRoots(context, { ...options, exclude: options.exclude ?? [] })).join(", ")}`);
      continue;
    }
    const key = toWorkspacePath(context, absolutePath).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      resolvedRoots.push(absolutePath);
    }
  }

  return { roots: resolvedRoots, warnings };
}

async function* walkFiles(context, config, roots, exclude) {
  const matcher = await createIgnoreMatcher(context, config, exclude);
  const patterns = roots.map((root) => {
    const relative = toWorkspacePath(context, root);
    return relative === "." ? "**/*" : `${relative}/**/*`;
  });

  const stream = fastGlob.stream(patterns, {
    cwd: context.workspaceRoot,
    absolute: true,
    onlyFiles: true,
    dot: true,
    ignore: exclude,
    followSymbolicLinks: config.discovery.followSymbolicLinks,
    unique: true
  });

  for await (const entry of stream) {
    const filePath = path.resolve(String(entry));
    const relative = toWorkspacePath(context, filePath);
    if (!matcher.ignores(relative)) {
      yield filePath;
    }
  }
}

async function* walkPathEntries(context, config, roots, exclude, options = {}) {
  const matcher = await createIgnoreMatcher(context, config, exclude);
  const patterns = roots.map((root) => {
    const relative = toWorkspacePath(context, root);
    return relative === "." ? "**/*" : `${relative}/**/*`;
  });

  const stream = fastGlob.stream(patterns, {
    cwd: context.workspaceRoot,
    absolute: true,
    onlyFiles: false,
    dot: true,
    ignore: exclude,
    followSymbolicLinks: config.discovery.followSymbolicLinks,
    unique: true
  });

  for await (const entry of stream) {
    const filePath = path.resolve(String(entry));
    const relative = toWorkspacePath(context, filePath);
    if (matcher.ignores(relative)) {
      continue;
    }

    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (options.includeDirectories) {
        yield {
          path: filePath,
          kind: "directory"
        };
      }
      continue;
    }

    if (stat.isFile()) {
      yield {
        path: filePath,
        kind: "file"
      };
    }
  }
}

async function createIgnoreMatcher(context, config, exclude) {
  const matcher = ignore();
  matcher.add(exclude);
  if (config.discovery.includeGitignore) {
    const gitignorePath = path.join(context.workspaceRoot, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      matcher.add(await fsp.readFile(gitignorePath, "utf8"));
    }
  }
  return matcher;
}

async function listAvailableRoots(context, configOrOptions) {
  const exclude = Array.isArray(configOrOptions?.exclude) ? configOrOptions.exclude : [];
  const matcher = ignore().add(exclude);
  const entries = await fsp.readdir(context.workspaceRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !matcher.ignores(name))
    .sort((left, right) => left.localeCompare(right));
}

async function listDirectChildren(context, rootPath, maxChildren, exclude) {
  if (maxChildren <= 0) {
    return [];
  }
  const matcher = ignore().add(exclude);
  const entries = await fsp.readdir(rootPath, { withFileTypes: true });
  return entries
    .map((entry) => ({
      entry,
      path: path.join(rootPath, entry.name),
      relative: toWorkspacePath(context, path.join(rootPath, entry.name))
    }))
    .filter((item) => !matcher.ignores(item.relative))
    .sort((left, right) => Number(right.entry.isDirectory()) - Number(left.entry.isDirectory()) || left.entry.name.localeCompare(right.entry.name))
    .slice(0, maxChildren)
    .map((item) => item.relative);
}

async function summarizeDirectoryChildren(rootPath) {
  const entries = await fsp.readdir(rootPath, { withFileTypes: true });
  return {
    childCount: entries.length,
    directoryCount: entries.filter((entry) => entry.isDirectory()).length,
    fileCount: entries.filter((entry) => entry.isFile()).length
  };
}

async function listDisabledManifestExcludes(context, config) {
  const disabledDirectories = [];
  await collectDisabledManifestDirectories(context, context.workspaceRoot, config, disabledDirectories);
  return disabledDirectories.map((directory) => `${toWorkspacePath(context, directory)}/**`);
}

async function collectDisabledManifestDirectories(context, directory, config, disabledDirectories, depth = 0) {
  if (depth > config.discovery.disabledPluginScanDepth) {
    return;
  }

  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  const names = new Set(entries.map((entry) => entry.name));
  if (names.has("PluginManifest.disabled.json") && !names.has("PluginManifest.json")) {
    disabledDirectories.push(directory);
    return;
  }

  const matcher = ignore().add(config.exclude);
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const childPath = path.join(directory, entry.name);
    if (matcher.ignores(toWorkspacePath(context, childPath))) {
      continue;
    }
    await collectDisabledManifestDirectories(context, childPath, config, disabledDirectories, depth + 1);
  }
}

function safeResolveWorkspacePath(context, value) {
  return resolveWorkspacePath(context, value);
}

module.exports = {
  prepareSearch,
  configuredSearchRoots,
  resolveExistingRoots,
  walkFiles,
  walkPathEntries,
  createIgnoreMatcher,
  listAvailableRoots,
  listDirectChildren,
  summarizeDirectoryChildren,
  safeResolveWorkspacePath
};
