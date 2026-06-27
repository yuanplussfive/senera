"use strict";

const path = require("node:path");

const ConfigFileName = "PluginConfig.toml";

function createContext(options = {}) {
  const pluginRoot = requirePathOption(options, "pluginRoot");
  const workspaceRoot = requirePathOption(options, "workspaceRoot");
  return {
    pluginRoot,
    workspaceRoot,
    configFileName: options.configFileName ?? ConfigFileName
  };
}

function requirePathOption(options, key) {
  const value = options[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`缺少工作区插件运行上下文：${key}`);
  }

  return path.resolve(value);
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
