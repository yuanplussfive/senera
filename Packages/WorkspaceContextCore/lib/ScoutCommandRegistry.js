"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const fastGlob = require("fast-glob");
const { resolveExistingWorkspacePath, toWorkspacePath } = require("./Context.js");
const { listDirectChildren } = require("./Discovery.js");
const { runRipgrepSearch } = require("./RipgrepSearch.js");
const { numberedLines, readTextFile, splitLines } = require("./TextFile.js");

function createScoutCommandRegistry(context, config, prepared, deps) {
  const registry = new Map();
  register(registry, rgCommand(context, config, prepared, deps));
  register(registry, readFileCommand(context, config));
  register(registry, treeCommand(context, config));
  register(registry, globCommand(context, config));
  return {
    definitions() {
      return [...registry.values()].map((command) => command.definition);
    },
    enabledDefinitions() {
      const enabled = new Set(config.scout.llmPlanner.commandTypes);
      return this.definitions().filter((definition) => enabled.has(definition.type));
    },
    async execute(command) {
      const entry = registry.get(command?.type);
      if (!entry) {
        return commandObservation(command, `未知 Scout 命令类型：${String(command?.type)}`, [], false);
      }
      if (!config.scout.llmPlanner.commandTypes.includes(entry.definition.type)) {
        return commandObservation(command, `Scout 命令未启用：${entry.definition.type}`, [], false);
      }
      return entry.execute(command);
    }
  };
}

function register(registry, command) {
  registry.set(command.definition.type, command);
}

function rgCommand(context, config, prepared, deps) {
  return {
    definition: {
      type: "rg",
      description: "Search workspace text with ripgrep.",
      args: {
        pattern: "string",
        path: "workspace relative path",
        include: "string[] optional",
        exclude: "string[] optional",
        regex: "boolean optional",
        caseSensitive: "boolean optional"
      }
    },
    async execute(command) {
      const pattern = readString(command.pattern);
      const workspacePath = readString(command.path) || ".";
      if (!pattern) {
        return commandObservation(command, "rg 缺少 pattern。", [], false);
      }
      const resolved = await resolveExistingWorkspacePath(context, workspacePath, fsp);
      if (!resolved) {
        return commandObservation(command, `rg 路径不存在：${workspacePath}`, [], false);
      }
      const roots = [toWorkspacePath(context, resolved)];
      const exclude = unique([
        ...prepared.exclude,
        ...readStringArray(command.exclude)
      ]);
      const results = await runRipgrepSearch(context, config, {
        rgPath: deps.rgPath,
        query: pattern,
        roots,
        exclude,
        contextLines: config.scout.llmPlanner.commandContextLines,
        regex: Boolean(command.regex),
        caseSensitive: Boolean(command.caseSensitive),
        maxResults: config.scout.llmPlanner.maxCommandResults
      });
      const candidates = results.map((result) => ({
        path: result.path,
        score: config.scout.llmPlanner.commandCandidateScore,
        startLine: result.startLine,
        endLine: result.endLine,
        line: result.line,
        reasons: [`LLM Scout rg: ${pattern}`],
        snippets: [result.snippet],
        focus: result.focusSummary ?? pattern
      }));
      return commandObservation(command, formatRgResults(results), candidates, true);
    }
  };
}

function readFileCommand(context, config) {
  return {
    definition: {
      type: "readfile",
      description: "Read a workspace file range with numbered lines.",
      args: {
        path: "workspace relative path",
        startLine: "integer optional",
        endLine: "integer optional"
      }
    },
    async execute(command) {
      const workspacePath = readString(command.path);
      if (!workspacePath) {
        return commandObservation(command, "readfile 缺少 path。", [], false);
      }
      const resolved = await resolveExistingWorkspacePath(context, workspacePath, fsp);
      if (!resolved) {
        return commandObservation(command, `readfile 路径不存在：${workspacePath}`, [], false);
      }
      const stat = await fsp.stat(resolved);
      if (!stat.isFile()) {
        return commandObservation(command, `readfile 目标不是文件：${workspacePath}`, [], false);
      }
      const loaded = await readTextFile(context, config, resolved, stat);
      const lines = splitLines(loaded.text);
      const startLine = Math.max(1, Number.isInteger(command.startLine) ? command.startLine : 1);
      const requestedEnd = Number.isInteger(command.endLine)
        ? command.endLine
        : startLine + config.scout.llmPlanner.readLineWindow - 1;
      const endLine = Math.max(startLine, Math.min(requestedEnd, lines.length));
      const content = numberedLines(lines, startLine, endLine);
      const candidate = {
        path: toWorkspacePath(context, resolved),
        score: config.scout.llmPlanner.commandCandidateScore,
        startLine,
        endLine,
        line: startLine,
        reasons: ["LLM Scout readfile"],
        snippets: [content],
        focus: `${startLine}-${endLine}`
      };
      return commandObservation(command, content, [candidate], true);
    }
  };
}

function treeCommand(context, config) {
  return {
    definition: {
      type: "tree",
      description: "Inspect workspace directory tree.",
      args: {
        path: "workspace relative directory",
        depth: "integer optional"
      }
    },
    async execute(command) {
      const workspacePath = readString(command.path) || ".";
      const resolved = await resolveExistingWorkspacePath(context, workspacePath, fsp);
      if (!resolved) {
        return commandObservation(command, `tree 路径不存在：${workspacePath}`, [], false);
      }
      const stat = await fsp.stat(resolved);
      if (!stat.isDirectory()) {
        return commandObservation(command, `tree 目标不是目录：${workspacePath}`, [], false);
      }
      const depth = clampPositiveInteger(command.depth, config.scout.llmPlanner.treeDepth);
      const lines = await directoryTreeLines(context, config, resolved, depth);
      return commandObservation(command, lines.join("\n"), [], true);
    }
  };
}

function globCommand(context, config) {
  return {
    definition: {
      type: "glob",
      description: "Find workspace files by glob pattern.",
      args: {
        pattern: "glob pattern",
        path: "workspace relative directory optional"
      }
    },
    async execute(command) {
      const pattern = readString(command.pattern);
      const workspacePath = readString(command.path) || ".";
      if (!pattern) {
        return commandObservation(command, "glob 缺少 pattern。", [], false);
      }
      const resolved = await resolveExistingWorkspacePath(context, workspacePath, fsp);
      if (!resolved) {
        return commandObservation(command, `glob 路径不存在：${workspacePath}`, [], false);
      }
      const entries = await fastGlob(pattern, {
        cwd: resolved,
        onlyFiles: false,
        dot: true,
        ignore: config.exclude,
        unique: true,
        followSymbolicLinks: false
      });
      const items = entries
        .slice(0, config.scout.llmPlanner.maxCommandResults)
        .map((entry) => toWorkspacePath(context, path.join(resolved, entry)));
      return commandObservation(command, items.join("\n") || "(no matches)", [], true);
    }
  };
}

async function directoryTreeLines(context, config, absolutePath, depth, prefix = "") {
  const workspacePath = toWorkspacePath(context, absolutePath);
  const lines = [`${prefix}${workspacePath}`];
  if (depth <= 0) {
    return lines;
  }
  const children = await listDirectChildren(
    context,
    absolutePath,
    config.scout.llmPlanner.maxTreeChildren,
    config.exclude
  );
  for (const child of children) {
    const childPath = await resolveExistingWorkspacePath(context, child, fsp);
    if (!childPath) {
      continue;
    }
    let stat;
    try {
      stat = await fsp.stat(childPath);
    } catch {
      continue;
    }
    lines.push(`${prefix}${stat.isDirectory() ? "dir" : "file"} ${toWorkspacePath(context, childPath)}`);
    if (stat.isDirectory()) {
      const nested = await directoryTreeLines(context, config, childPath, depth - 1, `${prefix}  `);
      lines.push(...nested.slice(1));
    }
  }
  return lines;
}

function commandObservation(command, text, candidates, ok) {
  return {
    command,
    ok,
    text: String(text),
    candidates
  };
}

function formatRgResults(results) {
  if (results.length === 0) {
    return "(no matches)";
  }
  return results
    .map((result) => `${result.path}:${result.line}\n${result.snippet}`)
    .join("\n\n");
}

function clampPositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function unique(values) {
  return [...new Set(values)];
}

module.exports = {
  createScoutCommandRegistry
};
