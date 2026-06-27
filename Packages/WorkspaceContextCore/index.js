"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  createContext,
  isNodeErrorCode,
  resolveExistingWorkspacePath,
  resolveWorkspacePath,
  toWorkspacePath
} = require("./lib/Context.js");
const { readConfig, readConfigFromToml } = require("./lib/Config.js");
const {
  configuredSearchRoots,
  listAvailableRoots,
  listDirectChildren,
  prepareSearch,
  resolveExistingRoots,
  summarizeDirectoryChildren
} = require("./lib/Discovery.js");
const { numberedLines, readTextFile, splitLines } = require("./lib/TextFile.js");
const { runRipgrepSearch } = require("./lib/RipgrepSearch.js");
const { searchFuzzyPaths } = require("./lib/PathFuzzySearch.js");
const { mergeSearchResults } = require("./lib/SearchResults.js");
const {
  refreshWorkspaceIndex,
  searchIndexedDocuments,
  searchIndexedSymbols
} = require("./lib/SqliteIndex.js");
const { scoutWorkspace: runScoutWorkspace } = require("./lib/Scout.js");

async function readFileSegment(context, config, args) {
  const absolutePath = await resolveExistingWorkspacePath(context, args.path, fsp);
  if (!absolutePath) {
    return readMissingPathSummary(context, config, args);
  }

  let stat;
  try {
    stat = await fsp.stat(absolutePath);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return readMissingPathSummary(context, config, args);
    }
    throw error;
  }

  if (stat.isDirectory()) {
    return readDirectorySummary(context, config, absolutePath, args);
  }

  const loaded = await readTextFile(context, config, absolutePath, stat);
  const lines = splitLines(loaded.text);
  const startLine = Math.max(1, args.startLine ?? 1);
  const requestedEnd = args.endLine ?? startLine + config.read.defaultLineWindow - 1;
  const endLine = Math.max(startLine, Math.min(requestedEnd, lines.length));
  const content = numberedLines(lines, startLine, endLine);
  const maxChars = args.maxChars;
  const truncated = content.length > maxChars;

  return {
    kind: "file",
    path: toWorkspacePath(context, absolutePath),
    startLine,
    endLine,
    totalLines: lines.length,
    content: truncated ? content.slice(0, maxChars) : content,
    truncated
  };
}

async function readMissingPathSummary(context, config, args) {
  const requestedAbsolutePath = resolveWorkspacePath(context, args.path);
  const requestedPath = toWorkspacePath(context, requestedAbsolutePath);
  const nearestParent = await findNearestExistingParent(context, requestedAbsolutePath);
  const parentChildren = nearestParent
    ? await listDirectChildren(context, nearestParent, config.read.directoryMaxChildren, config.exclude)
    : [];
  const suggestions = await suggestExistingWorkspacePaths(context, config, requestedPath);

  return {
    kind: "missing_path",
    requestedPath,
    nearestExistingParent: nearestParent ? toWorkspacePath(context, nearestParent) : "",
    parentChildren: {
      item: parentChildren
    },
    suggestions: {
      item: suggestions
    },
    availableRoots: {
      item: await listAvailableRoots(context, { exclude: config.exclude })
    },
    guidance: {
      item: config.messages.missingPathGuidance
    }
  };
}

async function findNearestExistingParent(context, absolutePath) {
  const workspaceRoot = resolveWorkspacePath(context, ".");
  let current = absolutePath;
  while (current !== workspaceRoot) {
    current = path.dirname(current);
    try {
      const stat = await fsp.stat(current);
      if (stat.isDirectory()) {
        return current;
      }
    } catch (error) {
      if (!isNodeErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
  }
  return workspaceRoot;
}

async function suggestExistingWorkspacePaths(context, config, requestedPath) {
  const configuredRoots = await configuredSearchRoots(context, config);
  const rootResolution = await resolveExistingRoots(context, configuredRoots, {
    exclude: config.exclude
  });
  const prepared = {
    roots: rootResolution.roots,
    exclude: config.exclude,
    warnings: rootResolution.warnings,
    maxResults: config.default_max_results,
    contextLines: config.default_context_lines
  };
  const queries = unique([
    requestedPath,
    path.basename(requestedPath)
  ].filter(Boolean));
  const requestedLeaf = path.basename(requestedPath).toLowerCase();
  const ranked = new Map();

  for (const query of queries) {
    const fuzzy = await searchFuzzyPaths(context, config, prepared, query, {
      maxResults: config.default_max_results
    });
    for (const result of fuzzy.results) {
      const current = ranked.get(result.path);
      if (!current || result.score > current.score) {
        ranked.set(result.path, {
          path: result.path,
          score: result.score,
          exactLeaf: path.basename(result.path).toLowerCase() === requestedLeaf,
          depth: result.path.split("/").length
        });
      }
    }
  }

  return [...ranked.values()]
    .sort((left, right) =>
      Number(right.exactLeaf) - Number(left.exactLeaf)
      || left.depth - right.depth
      || right.score - left.score
      || left.path.localeCompare(right.path))
    .map((entry) => entry.path);
}

async function readDirectorySummary(context, config, absolutePath, args) {
  const budgetedChildren = Math.max(1, Math.floor(args.maxChars / config.read.directoryChildCharBudget));
  const maxChildren = Math.min(config.read.directoryMaxChildren, budgetedChildren);
  const children = await listDirectChildren(context, absolutePath, maxChildren, config.exclude);
  const stats = await summarizeDirectoryChildren(absolutePath);
  return {
    kind: "directory",
    path: toWorkspacePath(context, absolutePath),
    children: {
      item: children
    },
    childCount: stats.childCount,
    directoryCount: stats.directoryCount,
    fileCount: stats.fileCount,
    truncated: stats.childCount > children.length,
    guidance: {
      item: config.messages.directoryGuidance
    }
  };
}

async function searchWorkspace(context, config, args, rgPath) {
  const startedAt = Date.now();
  const prepared = await prepareSearch(context, config, args);
  const ripgrepResults = await runRipgrepSearch(context, config, {
    rgPath,
    query: args.query,
    roots: prepared.roots,
    exclude: prepared.exclude,
    contextLines: prepared.contextLines,
    regex: args.regex,
    caseSensitive: args.caseSensitive,
    maxResults: prepared.maxResults
  });

  return searchResultEnvelope(context, config, args.query, ripgrepResults, prepared, {
    engines: ["ripgrep"],
    ripgrepMatchCount: ripgrepResults.length,
    pathFuzzyMatchCount: 0,
    pathFuzzyScanned: 0,
    pathFuzzyCapped: false,
    indexDocumentCount: 0,
    indexedFiles: 0,
    indexedSymbols: 0,
    refreshedIndex: false,
    stateFile: "",
    elapsedMs: Date.now() - startedAt
  });
}

async function searchHybrid(context, config, args, deps) {
  const startedAt = Date.now();
  const prepared = await prepareSearch(context, config, args);
  const engines = [];
  const ripgrepResults = await runRipgrepSearch(context, config, {
    rgPath: deps.rgPath,
    query: args.query,
    roots: prepared.roots,
    exclude: prepared.exclude,
    contextLines: prepared.contextLines,
    regex: args.regex,
    caseSensitive: args.caseSensitive,
    maxResults: prepared.maxResults
  });
  engines.push("ripgrep");
  let pathFuzzyResults = [];
  let pathFuzzyStats = emptyPathFuzzyStats();

  if (config.search.engines.includes("path_fuzzy")) {
    const fuzzyPaths = await searchFuzzyPaths(context, config, prepared, args.query, {
      maxResults: prepared.maxResults * config.search.collectMultiplier
    });
    pathFuzzyResults = fuzzyPaths.results;
    pathFuzzyStats = fuzzyPaths.stats;
    engines.push("path_fuzzy");
  }

  let indexResults = [];
  let indexStats = emptyIndexStats();
  let stateFile = "";
  let refreshedIndex = false;

  if (args.refreshIndex) {
    const refreshed = await refreshWorkspaceIndex(context, config, prepared, { force: true });
    refreshedIndex = true;
    stateFile = refreshed.stateFile;
  }

  if (ripgrepResults.length < config.hybrid_min_ripgrep_results || args.refreshIndex) {
    const indexed = await searchIndexedDocuments(context, config, prepared, args.query, {
      maxResults: prepared.maxResults * config.search.collectMultiplier
    });
    indexResults = indexed.results;
    indexStats = indexed.stats;
    stateFile = indexed.stateFile;
    engines.push(...config.search.engines.filter((engine) => engine !== "ripgrep"));
  }

  const results = mergeSearchResults([...ripgrepResults, ...pathFuzzyResults, ...indexResults], prepared.maxResults, config);
  return searchResultEnvelope(context, config, args.query, results, prepared, {
    engines: unique(engines),
    ripgrepMatchCount: ripgrepResults.length,
    pathFuzzyMatchCount: pathFuzzyStats.matched,
    pathFuzzyScanned: pathFuzzyStats.scanned,
    pathFuzzyCapped: pathFuzzyStats.capped,
    indexDocumentCount: indexStats.chunks,
    indexedFiles: indexStats.files,
    indexedSymbols: indexStats.symbols,
    refreshedIndex,
    stateFile,
    elapsedMs: Date.now() - startedAt
  });
}

async function searchIndex(context, config, args) {
  const startedAt = Date.now();
  const prepared = await prepareSearch(context, config, args);
  let refreshedIndex = false;
  if (args.refreshIndex) {
    await refreshWorkspaceIndex(context, config, prepared, { force: true });
    refreshedIndex = true;
  }
  const indexed = await searchIndexedDocuments(context, config, prepared, args.query, {
    maxResults: prepared.maxResults
  });
  let pathFuzzyResults = [];
  let pathFuzzyStats = emptyPathFuzzyStats();
  if (config.search.engines.includes("path_fuzzy")) {
    const fuzzyPaths = await searchFuzzyPaths(context, config, prepared, args.query, {
      maxResults: prepared.maxResults
    });
    pathFuzzyResults = fuzzyPaths.results;
    pathFuzzyStats = fuzzyPaths.stats;
  }
  const results = mergeSearchResults([...indexed.results, ...pathFuzzyResults], prepared.maxResults, config);
  return searchResultEnvelope(context, config, args.query, results, prepared, {
    engines: unique([
      ...config.search.engines.filter((engine) => engine !== "ripgrep"),
      ...(pathFuzzyResults.length > 0 ? ["path_fuzzy"] : [])
    ]),
    ripgrepMatchCount: 0,
    pathFuzzyMatchCount: pathFuzzyStats.matched,
    pathFuzzyScanned: pathFuzzyStats.scanned,
    pathFuzzyCapped: pathFuzzyStats.capped,
    indexDocumentCount: indexed.stats.chunks,
    indexedFiles: indexed.stats.files,
    indexedSymbols: indexed.stats.symbols,
    refreshedIndex,
    stateFile: indexed.stateFile,
    elapsedMs: Date.now() - startedAt
  });
}

async function searchSymbols(context, config, args) {
  const startedAt = Date.now();
  const prepared = await prepareSearch(context, config, args);
  let refreshedIndex = false;
  if (args.refreshIndex) {
    await refreshWorkspaceIndex(context, config, prepared, { force: true });
    refreshedIndex = true;
  }
  const indexed = await searchIndexedSymbols(context, config, prepared, args.query, {
    maxResults: prepared.maxResults,
    kinds: args.kind?.item ?? []
  });
  return {
    query: args.query,
    workspaceRoot: context.workspaceRoot,
    symbols: {
      item: indexed.symbols
    },
    warnings: {
      item: prepared.warnings
    },
    availableRoots: {
      item: await listAvailableRoots(context, { exclude: config.exclude })
    },
    stats: {
      resultCount: indexed.symbols.length,
      symbolCount: indexed.stats.symbols,
      indexedFiles: indexed.stats.files,
      indexDocumentCount: indexed.stats.chunks,
      engines: {
        item: ["symbol"]
      },
      stateFile: indexed.stateFile,
      refreshedIndex,
      elapsedMs: Date.now() - startedAt
    }
  };
}

async function refreshIndex(context, config, args) {
  const startedAt = Date.now();
  const configuredRoots = await configuredSearchRoots(context, config);
  const requestedRoots = args.roots?.item ?? configuredRoots;
  const rootResolution = await resolveExistingRoots(context, requestedRoots, {
    exclude: config.exclude
  });
  const prepared = {
    roots: rootResolution.roots,
    exclude: config.exclude,
    warnings: rootResolution.warnings,
    maxResults: config.default_max_results,
    contextLines: config.default_context_lines
  };
  const result = await refreshWorkspaceIndex(context, config, prepared, {
    force: args.force
  });
  return {
    ...result,
    availableRoots: {
      item: await listAvailableRoots(context, { exclude: config.exclude })
    },
    elapsedMs: Date.now() - startedAt
  };
}

async function getWorkspaceMap(context, config, args) {
  const availableRoots = await listAvailableRoots(context, { exclude: config.exclude });
  const configuredRoots = await configuredSearchRoots(context, config);
  const indexed = await resolveExistingRoots(context, configuredRoots, {
    exclude: config.exclude
  });
  const topLevel = [];

  for (const name of availableRoots) {
    const absolutePath = resolveWorkspacePath(context, name);
    const stat = await fsp.stat(absolutePath);
    const children = stat.isDirectory()
      ? await listDirectChildren(context, absolutePath, args.maxChildrenPerRoot, config.exclude)
      : [];
    topLevel.push({
      path: name,
      kind: stat.isDirectory() ? "directory" : "file",
      purpose: purposeFromConfig(name, config),
      children: {
        item: children
      }
    });
  }

  return {
    workspaceRoot: context.workspaceRoot,
    topLevel: {
      item: topLevel
    },
    indexedRoots: {
      item: indexed.roots.map((root) => toWorkspacePath(context, root))
    },
    availableRoots: {
      item: availableRoots
    },
    project: summarizeProject(context, availableRoots, config),
    guidance: {
      item: config.messages.workspaceMapGuidance
    }
  };
}

function summarizeProject(context, topLevelNames, config) {
  const topLevel = new Set(topLevelNames.map((name) => name.toLowerCase()));
  const markers = config.map.markerFiles.filter((name) => fs.existsSync(path.join(context.workspaceRoot, name)));
  const sourceRoots = config.map.sourceRootNames.filter((name) => topLevel.has(name.toLowerCase()));
  const entryPoints = config.map.entryPointNames.filter((name) => topLevel.has(name.toLowerCase()));
  return {
    markers: {
      item: markers
    },
    sourceRoots: {
      item: sourceRoots
    },
    entryPoints: {
      item: entryPoints
    },
    recommendedRoots: {
      item: unique([...entryPoints, ...sourceRoots])
    }
  };
}

function purposeFromConfig(name, config) {
  if (config.map.sourceRootNames.some((item) => item.toLowerCase() === name.toLowerCase())) {
    return "source-root";
  }
  if (config.map.entryPointNames.some((item) => item.toLowerCase() === name.toLowerCase())) {
    return "entry-point";
  }
  return undefined;
}

async function searchResultEnvelope(context, config, query, results, prepared, stats) {
  return {
    query,
    workspaceRoot: context.workspaceRoot,
    results: {
      item: results
    },
    warnings: {
      item: prepared.warnings
    },
    availableRoots: {
      item: await listAvailableRoots(context, { exclude: config.exclude })
    },
    stats: {
      resultCount: results.length,
      ripgrepMatchCount: stats.ripgrepMatchCount ?? 0,
      pathFuzzyMatchCount: stats.pathFuzzyMatchCount ?? 0,
      pathFuzzyScanned: stats.pathFuzzyScanned ?? 0,
      pathFuzzyCapped: stats.pathFuzzyCapped ?? false,
      indexDocumentCount: stats.indexDocumentCount,
      indexedFiles: stats.indexedFiles,
      indexedSymbols: stats.indexedSymbols,
      engines: {
        item: stats.engines
      },
      refreshedIndex: stats.refreshedIndex,
      stateFile: stats.stateFile,
      elapsedMs: stats.elapsedMs
    }
  };
}

async function scoutWorkspace(context, config, args, deps) {
  return runScoutWorkspace(context, config, args, {
    ...deps,
    searchHybrid
  });
}

function emptyIndexStats() {
  return {
    files: 0,
    chunks: 0,
    symbols: 0
  };
}

function emptyPathFuzzyStats() {
  return {
    scanned: 0,
    matched: 0,
    capped: false
  };
}

function unique(values) {
  return [...new Set(values)];
}

module.exports = {
  createContext,
  readConfig,
  readConfigFromToml,
  readFileSegment,
  searchWorkspace,
  searchHybrid,
  scoutWorkspace,
  searchIndex,
  searchSymbols,
  refreshIndex,
  getWorkspaceMap
};
