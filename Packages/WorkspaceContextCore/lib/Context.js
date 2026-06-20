"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ConfigFileName = "PluginConfig.toml";

function createContext(options = {}) {
  const pluginRoot = path.resolve(options.pluginRoot ?? process.env.SENERA_PLUGIN_ROOT ?? process.cwd());
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.env.SENERA_WORKSPACE_ROOT ?? findWorkspaceRoot());
  return {
    pluginRoot,
    workspaceRoot,
    configFileName: options.configFileName ?? ConfigFileName
  };
}

function findWorkspaceRoot() {
  let current = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(current, "senera.config.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}

function resolveWorkspacePath(context, value) {
  const resolved = path.resolve(context.workspaceRoot, String(value));
  const relative = path.relative(context.workspaceRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`路径超出工作区：${value}`);
  }
  return resolved;
}

async function resolveExistingWorkspacePath(context, value, fsp) {
  const resolved = resolveWorkspacePath(context, value);
  const relative = path.relative(context.workspaceRoot, resolved);
  if (!relative) {
    return context.workspaceRoot;
  }

  let current = context.workspaceRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return null;
    }
    const exact = entries.find((entry) => entry.name === part);
    const matched = exact ?? entries.find((entry) => entry.name.toLowerCase() === part.toLowerCase());
    if (!matched) {
      return null;
    }
    current = path.join(current, matched.name);
  }
  return current;
}

function toWorkspacePath(context, filePath) {
  const relative = path.relative(context.workspaceRoot, filePath);
  return relative ? relative.split(path.sep).join("/") : ".";
}

function resolvePluginPath(context, value) {
  return path.isAbsolute(value)
    ? value
    : path.resolve(context.pluginRoot, value);
}

function isNodeErrorCode(error, code) {
  return Boolean(error && typeof error === "object" && error.code === code);
}

module.exports = {
  ConfigFileName,
  createContext,
  resolveWorkspacePath,
  resolveExistingWorkspacePath,
  toWorkspacePath,
  resolvePluginPath,
  isNodeErrorCode
};
