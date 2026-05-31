"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const ConfigFileName = "PluginConfig.toml";
const IndexVersion = 4;
const DefaultConfig = {
  roots: ["."],
  exclude: [
    ".git",
    ".claude",
    "Dist",
    "**/Dist/**",
    "dist",
    "**/dist/**",
    "build",
    "**/build/**",
    "coverage",
    "**/coverage/**",
    "node_modules",
    "**/node_modules/**",
    "Plugins/*/node_modules",
    "Plugins/*/.state",
    ".senera",
    ".state",
    "**/.state/**",
    "package-lock.json"
  ],
  max_file_bytes: 300000,
  max_index_files: 1200,
  default_max_results: 12,
  default_context_lines: 4,
  state_dir: ".state",
  hybrid_min_ripgrep_results: 3,
  ripgrep_timeout_ms: 8000
};

function createContext(options = {}) {
  const pluginRoot = path.resolve(options.pluginRoot ?? process.env.SENERA_PLUGIN_ROOT ?? process.cwd());
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.env.SENERA_WORKSPACE_ROOT ?? findWorkspaceRoot());
  return {
    pluginRoot,
    workspaceRoot,
    configFileName: options.configFileName ?? ConfigFileName
  };
}

function readConfig(context, parseTomlConfig) {
  const configPath = path.join(context.pluginRoot, context.configFileName);
  const parsed = fs.existsSync(configPath)
    ? parseTomlConfig(fs.readFileSync(configPath, "utf8"))
    : {};
  const raw = asRecord(parsed.fast_context);
  return {
    roots: readStringArray(raw.roots, DefaultConfig.roots),
    exclude: readStringArray(raw.exclude, DefaultConfig.exclude),
    max_file_bytes: readInteger(raw.max_file_bytes, 1000, 5000000, DefaultConfig.max_file_bytes),
    max_index_files: readInteger(raw.max_index_files, 1, 50000, DefaultConfig.max_index_files),
    default_max_results: readInteger(raw.default_max_results, 1, 50, DefaultConfig.default_max_results),
    default_context_lines: readInteger(raw.default_context_lines, 0, 20, DefaultConfig.default_context_lines),
    state_dir: readNonEmptyString(raw.state_dir, DefaultConfig.state_dir),
    hybrid_min_ripgrep_results: readInteger(raw.hybrid_min_ripgrep_results, 0, 50, DefaultConfig.hybrid_min_ripgrep_results),
    ripgrep_timeout_ms: readInteger(raw.ripgrep_timeout_ms, 1000, 60000, DefaultConfig.ripgrep_timeout_ms)
  };
}

async function readFileSegment(context, config, args) {
  const absolutePath = resolveWorkspacePath(context, args.path);
  const stat = await fsp.stat(absolutePath);
  if (stat.isDirectory()) {
    return readDirectorySummary(context, config, absolutePath, args);
  }
  await assertReadableTextFile(context, absolutePath, config, stat);
  const content = await fsp.readFile(absolutePath, "utf8");
  const lines = content.split(/\r?\n/);
  const startLine = Math.max(1, args.startLine ?? 1);
  const endLine = Math.max(startLine, Math.min(args.endLine ?? startLine + 120, lines.length));
  const selectedLines = lines.slice(startLine - 1, endLine);
  const numbered = selectedLines
    .map((line, index) => `${startLine + index}: ${line}`)
    .join("\n");
  const maxChars = args.maxChars ?? 12000;
  const truncated = numbered.length > maxChars;
  return {
    kind: "file",
    path: toWorkspacePath(context, absolutePath),
    startLine,
    endLine,
    totalLines: lines.length,
    content: truncated ? numbered.slice(0, maxChars) : numbered,
    truncated
  };
}

async function readDirectorySummary(context, config, absolutePath, args) {
  const maxChildren = Math.max(1, Math.min(80, Math.floor((args.maxChars ?? 12000) / 120)));
  const children = await listDirectChildren(context, absolutePath, maxChildren, config.exclude);
  const stats = await summarizeDirectoryChildren(context, absolutePath, children);
  const pathText = toWorkspacePath(context, absolutePath) || ".";
  return {
    kind: "directory",
    path: pathText,
    children: {
      item: children
    },
    childCount: stats.childCount,
    directoryCount: stats.directoryCount,
    fileCount: stats.fileCount,
    truncated: stats.childCount > children.length,
    guidance: {
      item: [
        "这是目录摘要，不是文件内容。",
        "要读取源码，请从 children 中选择具体文件路径再调用 FastContextReadTool。",
        `要搜索此目录内逻辑，请调用 FastContextHybridSearchTool 并设置 roots.item 为 ${pathText}。`
      ]
    }
  };
}

async function searchWorkspace(context, config, args, rgPath) {
  const startedAt = Date.now();
  const prepared = await prepareSearch(context, config, args);
  const queryPlan = buildQueryPlan(args.query, { regex: args.regex });
  const ripgrepResults = prepared.roots.length === 0
    ? []
    : await runRipgrepSearchPlan(context, {
      rgPath,
      queryPlan,
      roots: prepared.roots,
      exclude: prepared.exclude,
      contextLines: prepared.contextLines,
      regex: args.regex,
      caseSensitive: args.caseSensitive,
      maxResults: prepared.maxResults * 4,
      ripgrepTimeoutMs: config.ripgrep_timeout_ms
    });
  const results = ripgrepResults.slice(0, prepared.maxResults);
  return searchResultEnvelope(context, config, args.query, results, prepared, {
    ripgrepMatchCount: ripgrepResults.length,
    queryPatternCount: queryPlan.ripgrepPatterns.length,
    indexDocumentCount: 0,
    refreshedIndex: false,
    elapsedMs: Date.now() - startedAt
  });
}

async function searchHybrid(context, config, args, deps) {
  const startedAt = Date.now();
  const prepared = await prepareSearch(context, config, args);
  const queryPlan = buildQueryPlan(args.query, { regex: args.regex });
  const ripgrepResults = prepared.roots.length === 0 || !deps.rgPath
    ? []
    : await runRipgrepSearchPlan(context, {
      rgPath: deps.rgPath,
      queryPlan,
      roots: prepared.roots,
      exclude: prepared.exclude,
      contextLines: prepared.contextLines,
      regex: args.regex,
      caseSensitive: args.caseSensitive,
      maxResults: prepared.maxResults * 4,
      ripgrepTimeoutMs: config.ripgrep_timeout_ms
    });
  if (!args.refreshIndex && ripgrepResults.length >= config.hybrid_min_ripgrep_results) {
    return searchResultEnvelope(context, config, args.query, ripgrepResults.slice(0, prepared.maxResults), prepared, {
      ripgrepMatchCount: ripgrepResults.length,
      queryPatternCount: queryPlan.ripgrepPatterns.length,
      indexDocumentCount: 0,
      refreshedIndex: false,
      elapsedMs: Date.now() - startedAt
    });
  }
  const indexData = prepared.roots.length === 0
    ? emptyIndexData(context, prepared)
    : args.refreshIndex
      ? await buildAndSaveIndex(context, config, prepared, deps)
      : await loadIndexOrEmpty(context, config, prepared);
  const indexResults = searchIndexDocuments(indexData, queryPlan, prepared.maxResults * 4, prepared.contextLines);
  const results = mergeResults({
    queryPlan,
    ripgrepResults,
    indexResults,
    maxResults: prepared.maxResults
  });
  return searchResultEnvelope(context, config, args.query, results, prepared, {
    ripgrepMatchCount: ripgrepResults.length,
    queryPatternCount: queryPlan.ripgrepPatterns.length,
    indexDocumentCount: indexData.documents.length,
    refreshedIndex: Boolean(args.refreshIndex),
    elapsedMs: Date.now() - startedAt
  });
}

async function searchIndex(context, config, args, deps) {
  const startedAt = Date.now();
  const prepared = await prepareSearch(context, config, args);
  const queryPlan = buildQueryPlan(args.query);
  const indexData = prepared.roots.length === 0
    ? emptyIndexData(context, prepared)
    : args.refreshIndex
      ? await buildAndSaveIndex(context, config, prepared, deps)
      : await loadOrBuildIndex(context, config, prepared, deps);
  const results = searchIndexDocuments(indexData, queryPlan, prepared.maxResults, prepared.contextLines);
  return searchResultEnvelope(context, config, args.query, results, prepared, {
    ripgrepMatchCount: 0,
    queryPatternCount: queryPlan.ripgrepPatterns.length,
    indexDocumentCount: indexData.documents.length,
    refreshedIndex: Boolean(args.refreshIndex),
    elapsedMs: Date.now() - startedAt
  });
}

async function searchSymbols(context, config, args, deps) {
  const startedAt = Date.now();
  const prepared = await prepareSearch(context, config, args);
  const queryPlan = buildQueryPlan(args.query);
  const indexData = prepared.roots.length === 0
    ? emptyIndexData(context, prepared)
    : args.refreshIndex
      ? await buildAndSaveIndex(context, config, prepared, deps)
      : await loadOrBuildIndex(context, config, prepared, deps);
  const allowedKinds = new Set(args.kind?.item ?? []);
  const symbols = indexData.symbols
    .map((symbol) => ({
      ...symbol,
      score: scoreSymbol(symbol, queryPlan)
    }))
    .filter((symbol) => symbol.score > 0)
    .filter((symbol) => allowedKinds.size === 0 || allowedKinds.has(symbol.kind))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || left.line - right.line)
    .slice(0, prepared.maxResults);
  return {
    query: args.query,
    workspaceRoot: context.workspaceRoot,
    symbols: {
      item: symbols
    },
    warnings: {
      item: prepared.warnings
    },
    availableRoots: {
      item: await listAvailableRoots(context, config.exclude)
    },
    stats: {
      resultCount: symbols.length,
      symbolCount: indexData.symbols.length,
      refreshedIndex: Boolean(args.refreshIndex),
      elapsedMs: Date.now() - startedAt
    }
  };
}

async function refreshIndex(context, config, args, deps) {
  const startedAt = Date.now();
  const configuredRoots = await configuredSearchRoots(context, config);
  const requestedRoots = args.roots?.item ?? configuredRoots;
  const rootResolution = await resolveExistingRoots(context, requestedRoots, {
    fallbackRoots: args.roots ? configuredRoots : [],
    exclude: config.exclude
  });
  const prepared = {
    roots: rootResolution.roots,
    exclude: config.exclude,
    maxResults: config.default_max_results,
    contextLines: config.default_context_lines,
    warnings: rootResolution.warnings
  };
  const indexData = await buildAndSaveIndex(context, config, prepared, deps);
  return {
    workspaceRoot: context.workspaceRoot,
    indexedFiles: indexData.indexedFiles,
    indexedDocuments: indexData.documents.length,
    indexedSymbols: indexData.symbols.length,
    skippedFiles: indexData.skippedFiles,
    stateFile: indexStatePath(context, config),
    warnings: {
      item: prepared.warnings
    },
    availableRoots: {
      item: await listAvailableRoots(context, config.exclude)
    },
    elapsedMs: Date.now() - startedAt
  };
}

async function getWorkspaceMap(context, config, args) {
  const topLevelNames = await listAvailableRoots(context, config.exclude);
  const configuredRoots = await configuredSearchRoots(context, config);
  const indexed = await resolveExistingRoots(context, configuredRoots, {
    exclude: config.exclude
  });
  const maxChildren = args.maxChildrenPerRoot ?? 24;
  const topLevel = [];
  for (const name of topLevelNames) {
    const absolutePath = resolveWorkspacePath(context, name);
    const stat = await fsp.stat(absolutePath);
    const children = stat.isDirectory()
      ? await listDirectChildren(context, absolutePath, maxChildren, config.exclude)
      : [];
    topLevel.push({
      path: name,
      kind: stat.isDirectory() ? "directory" : "file",
      purpose: summarizePathPurpose(name, children, stat),
      children: {
        item: children
      }
    });
  }
  const project = summarizeProject(context, topLevelNames, topLevel);
  return {
    workspaceRoot: context.workspaceRoot,
    topLevel: {
      item: topLevel
    },
    indexedRoots: {
      item: indexed.roots.map((root) => toWorkspacePath(context, root))
    },
    availableRoots: {
      item: topLevelNames
    },
    project,
    guidance: {
      item: [
        "优先使用 availableRoots 或 indexedRoots 中真实存在的路径，不要猜常见目录名。",
        "不确定目录时省略 roots，使用插件配置的默认搜索范围。",
        "需要更大上下文时先用搜索结果 path，再调用读取工具按行读取。",
        "搜索不到时换更短的关键词、标识符片段或路径片段重试。"
      ]
    }
  };
}

async function prepareSearch(context, config, args) {
  const configuredRoots = await configuredSearchRoots(context, config);
  const requestedRoots = args.roots?.item ?? configuredRoots;
  const exclude = [
    ...config.exclude,
    ...await listDisabledManifestExcludes(context, config.exclude),
    ...(args.exclude?.item ?? [])
  ];
  const rootResolution = await resolveExistingRoots(context, requestedRoots, {
    fallbackRoots: args.roots ? configuredRoots : [],
    exclude
  });
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
    : listAvailableRoots(context, config.exclude);
}

async function loadOrBuildIndex(context, config, prepared, deps) {
  const indexData = await loadIndexOrEmpty(context, config, prepared);
  return indexData.documents.length > 0 || indexData.symbols.length > 0
    ? indexData
    : buildAndSaveIndex(context, config, prepared, deps);
}

async function loadIndexOrEmpty(context, config, prepared) {
  const stateFile = indexStatePath(context, config);
  try {
    const parsed = JSON.parse(await fsp.readFile(stateFile, "utf8"));
    if (isUsableIndex(context, parsed, prepared)) {
      return parsed;
    }
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
  return emptyIndexData(context, prepared);
}

async function buildAndSaveIndex(context, config, prepared, deps = {}) {
  const documents = [];
  const symbols = [];
  let indexedFiles = 0;
  let skippedFiles = 0;
  for (const root of prepared.roots) {
    for await (const filePath of walkFiles(context, root, config, prepared.exclude, deps)) {
      if (indexedFiles >= config.max_index_files) {
        skippedFiles += 1;
        continue;
      }
      try {
        const file = await fileToIndexEntries(context, filePath, config);
        if (file.documents.length === 0) {
          skippedFiles += 1;
          continue;
        }
        documents.push(...file.documents);
        symbols.push(...file.symbols);
        indexedFiles += 1;
      } catch {
        skippedFiles += 1;
      }
    }
  }
  const indexData = {
    version: IndexVersion,
    workspaceRoot: context.workspaceRoot,
    roots: prepared.roots.map((root) => toWorkspacePath(context, root)),
    exclude: prepared.exclude,
    documents,
    symbols,
    indexedFiles,
    skippedFiles,
    updatedAt: new Date().toISOString()
  };
  const stateFile = indexStatePath(context, config);
  await fsp.mkdir(path.dirname(stateFile), { recursive: true });
  await fsp.writeFile(stateFile, JSON.stringify(indexData), "utf8");
  return indexData;
}

function isUsableIndex(context, value, prepared) {
  return value
    && value.version === IndexVersion
    && value.workspaceRoot === context.workspaceRoot
    && Array.isArray(value.documents)
    && Array.isArray(value.symbols)
    && JSON.stringify(value.roots) === JSON.stringify(prepared.roots.map((root) => toWorkspacePath(context, root)))
    && JSON.stringify(value.exclude) === JSON.stringify(prepared.exclude);
}

function searchIndexDocuments(indexData, queryPlan, maxResults, contextLines) {
  const found = scanDocuments(indexData.documents, queryPlan, maxResults);
  return found.map((document, indexOffset) => ({
    path: document.path,
    startLine: Math.max(1, document.startLine - contextLines),
    endLine: document.endLine,
    line: document.startLine,
    snippet: numberSnippet(document.text, document.startLine, 24),
    score: Math.max(0.1, document.tokenScore + 1.2 - indexOffset * 0.03),
    source: "index",
    matches: {
      item: queryPlan.terms
    },
    reason: "local lightweight index match"
  }));
}

async function runRipgrepSearchPlan(context, options) {
  const requestedMaxResults = options.maxResults;
  const collectMaxResults = Math.max(requestedMaxResults * 8, requestedMaxResults);
  const patterns = options.queryPlan.regex
    ? [options.queryPlan.original]
    : options.queryPlan.ripgrepPatterns;
  const results = await runRipgrepSearch(context, {
    ...options,
    patterns,
    regex: options.queryPlan.regex || options.regex,
    maxResults: collectMaxResults,
    resultLimit: requestedMaxResults
  });
  return results;
}

async function runRipgrepSearch(context, options) {
  const args = [
    "--json",
    "--with-filename",
    "--line-number",
    "--max-count",
    String(options.maxResults),
    ...options.exclude.flatMap((item) => ["--glob", `!${item}`]),
    options.caseSensitive ? "--case-sensitive" : "--ignore-case"
  ];
  if (!options.regex) {
    args.push("--fixed-strings");
  }
  for (const pattern of options.patterns) {
    args.push("--regexp", pattern);
  }
  args.push(...options.roots);
  const output = await spawnCollect(options.rgPath, args, context.workspaceRoot, options.ripgrepTimeoutMs ?? DefaultConfig.ripgrep_timeout_ms);
  if (output.exitCode !== 0 && output.exitCode !== 1) {
    throw new Error(`ripgrep 搜索失败：${output.stderr || output.stdout}`);
  }
  const matches = parseRipgrepJsonMatches(context, output.stdout)
    .filter((match) => !isExcluded(context, match.absolutePath, path.basename(match.absolutePath), options.exclude));
  return hydrateRipgrepResults(context, matches, options.contextLines, options.resultLimit ?? options.maxResults, options.queryPlan);
}

function parseRipgrepJsonMatches(context, stdout) {
  const results = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== "match") {
      continue;
    }
    const absolutePath = event.data?.path?.text;
    const lineNumber = event.data?.line_number;
    const text = event.data?.lines?.text ?? "";
    if (!absolutePath || !lineNumber) {
      continue;
    }
    results.push({
      path: toWorkspacePath(context, absolutePath),
      absolutePath,
      line: lineNumber,
      text: trimLineBreak(text)
    });
  }
  return results;
}

async function hydrateRipgrepResults(context, matches, contextLines, maxResults, queryPlan) {
  const byKey = new Map();
  for (const match of matches) {
    const key = `${match.path}:${match.line}`;
    if (!byKey.has(key)) {
      byKey.set(key, match);
    }
  }
  const hydrated = [];
  for (const match of byKey.values()) {
    try {
      const content = await fsp.readFile(match.absolutePath, "utf8");
      const lines = content.split(/\r?\n/);
      const startLine = Math.max(1, match.line - contextLines);
      const endLine = Math.min(lines.length, match.line + contextLines);
      const snippet = lines
        .slice(startLine - 1, endLine)
        .map((line, index) => `${startLine + index}: ${line}`)
        .join("\n");
      hydrated.push({
        path: match.path,
        startLine,
        endLine,
        line: match.line,
        snippet,
        score: 1,
        source: "ripgrep",
        matches: {
          item: []
        },
        reason: "ripgrep exact text match"
      });
    } catch {
      hydrated.push({
        path: match.path,
        startLine: match.line,
        endLine: match.line,
        line: match.line,
        snippet: `${match.line}: ${match.text}`,
        score: 1,
        source: "ripgrep",
        matches: {
          item: []
        },
        reason: "ripgrep exact text match"
      });
    }
  }
  return hydrated
    .map((result) => ({
      ...result,
      score: 1 + scoreResultContent(result, queryPlan)
    }))
    .sort((left, right) =>
      right.score - left.score
      || scorePath(right.path, queryPlan.terms) - scorePath(left.path, queryPlan.terms)
      || left.path.localeCompare(right.path)
      || left.line - right.line)
    .slice(0, maxResults);
}

function mergeResults(options) {
  const byKey = new Map();
  for (const result of options.ripgrepResults) {
    byKey.set(resultKey(result), {
      ...result,
      matches: {
        item: options.queryPlan.terms
      },
      score: 1.5 + scorePath(result.path, options.queryPlan.terms),
      source: "ripgrep"
    });
  }
  for (const result of options.indexResults) {
    const key = resultKey(result);
    const existing = byKey.get(key);
    byKey.set(key, existing
      ? {
        ...existing,
        source: "combined",
        score: existing.score + result.score,
        reason: "ripgrep exact match plus local index match"
      }
      : {
        ...result,
        score: result.score + scorePath(result.path, options.queryPlan.terms)
      });
  }
  return [...byKey.values()]
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || left.line - right.line)
    .slice(0, options.maxResults)
    .map((item) => ({
      ...item,
      score: Math.round(item.score * 1000) / 1000
    }));
}

function searchResultEnvelope(context, config, query, results, prepared, stats) {
  const envelope = {
    query,
    workspaceRoot: context.workspaceRoot,
    results: {
      item: results
    },
    warnings: {
      item: prepared.warnings
    },
    availableRoots: {
      item: []
    },
    stats: {
      resultCount: results.length,
      ...stats
    }
  };
  return listAvailableRoots(context, config.exclude)
    .then((availableRoots) => ({
      ...envelope,
      availableRoots: {
        item: availableRoots
      }
    }));
}

async function* walkFiles(context, root, config, exclude, deps = {}) {
  if (deps.fastGlob) {
    const entries = await deps.fastGlob("**/*", {
      cwd: root,
      absolute: true,
      onlyFiles: true,
      dot: true,
      ignore: exclude
    });
    for (const filePath of entries) {
      if (!isExcluded(context, filePath, path.basename(filePath), exclude, deps)) {
        yield filePath;
      }
    }
    return;
  }
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    if (isExcluded(context, filePath, entry.name, exclude, deps)) {
      continue;
    }
    if (entry.isDirectory()) {
      yield* walkFiles(context, filePath, config, exclude, deps);
      continue;
    }
    if (entry.isFile()) {
      yield filePath;
    }
  }
}

async function fileToIndexEntries(context, filePath, config) {
  await assertReadableTextFile(context, filePath, config);
  const content = await fsp.readFile(filePath, "utf8");
  if (content.includes("\0")) {
    return {
      documents: [],
      symbols: []
    };
  }
  const lines = content.split(/\r?\n/);
  const documents = [];
  const chunkSize = 80;
  const overlap = 12;
  for (let start = 0; start < lines.length; start += chunkSize - overlap) {
    const selected = lines.slice(start, start + chunkSize);
    const text = selected.join("\n").trim();
    if (!text) {
      continue;
    }
    documents.push({
      id: `${toWorkspacePath(context, filePath)}:${start + 1}`,
      path: toWorkspacePath(context, filePath),
      startLine: start + 1,
      endLine: Math.min(lines.length, start + selected.length),
      text,
      searchText: buildSearchText(context, filePath, text)
    });
  }
  return {
    documents,
    symbols: extractSymbols(context, filePath, lines)
  };
}

function extractSymbols(context, filePath, lines) {
  const relativePath = toWorkspacePath(context, filePath);
  const symbols = [];
  const patterns = [
    { kind: "function", regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/ },
    { kind: "class", regex: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/ },
    { kind: "interface", regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/ },
    { kind: "type", regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b/ },
    { kind: "enum", regex: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)\b/ },
    { kind: "const", regex: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\b/ }
  ];
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      const match = pattern.regex.exec(line);
      if (!match) {
        continue;
      }
      const name = match[1];
      const kind = pattern.kind === "const" && /^[A-Z]/.test(name) && /(?:jsx|tsx|React|return\s*\()/i.test(lines.slice(index, index + 8).join("\n"))
        ? "component"
        : pattern.kind;
      symbols.push({
        id: `${relativePath}:${index + 1}:${name}`,
        name,
        kind,
        path: relativePath,
        line: index + 1,
        startLine: index + 1,
        endLine: index + 1,
        signature: line.trim().slice(0, 240),
        exported: /\bexport\b/.test(line),
        imports: {
          item: []
        },
        score: 0
      });
      break;
    }
  });
  return symbols;
}

async function assertReadableTextFile(context, filePath, config, knownStat) {
  const stat = knownStat ?? await fsp.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`不是文件：${toWorkspacePath(context, filePath)}`);
  }
  if (stat.size > config.max_file_bytes) {
    throw new Error(`文件超过 max_file_bytes 限制：${toWorkspacePath(context, filePath)}`);
  }
}

async function resolveExistingRoots(context, roots, options = {}) {
  const resolvedRoots = [];
  const warnings = [];
  const seen = new Set();
  for (const root of roots) {
    let absolutePath;
    try {
      absolutePath = await resolveExistingWorkspacePath(context, root);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (!absolutePath) {
      warnings.push(`工作区不存在 root：${root}。可用顶层 roots：${(await listAvailableRoots(context, options.exclude)).join(", ")}`);
      continue;
    }
    const key = toWorkspacePath(context, absolutePath).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      resolvedRoots.push(absolutePath);
    }
  }
  if (resolvedRoots.length > 0 || !options.fallbackRoots?.length) {
    return {
      roots: resolvedRoots,
      warnings
    };
  }
  const fallback = await resolveExistingRoots(context, options.fallbackRoots, {
    exclude: options.exclude
  });
  return {
    roots: fallback.roots,
    warnings: [
      ...warnings,
      `请求的 roots 都不可用，已回退到插件默认 roots：${fallback.roots.map((root) => toWorkspacePath(context, root)).join(", ")}`,
      ...fallback.warnings
    ]
  };
}

async function resolveExistingWorkspacePath(context, value) {
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
    const matched = entries.find((entry) => entry.name === part)
      ?? entries.find((entry) => entry.name.toLowerCase() === part.toLowerCase());
    if (!matched) {
      return null;
    }
    current = path.join(current, matched.name);
  }
  return current;
}

function resolveWorkspacePath(context, value) {
  const resolved = path.resolve(context.workspaceRoot, value);
  const relative = path.relative(context.workspaceRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`路径超出工作区：${value}`);
  }
  return resolved;
}

async function listAvailableRoots(context, exclude = DefaultConfig.exclude) {
  const entries = await fsp.readdir(context.workspaceRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !isExcluded(context, path.join(context.workspaceRoot, name), name, exclude))
    .sort((left, right) => left.localeCompare(right));
}

async function listDirectChildren(context, rootPath, maxChildren, exclude) {
  if (maxChildren <= 0) {
    return [];
  }
  const entries = await fsp.readdir(rootPath, { withFileTypes: true });
  return entries
    .filter((entry) => !isExcluded(context, path.join(rootPath, entry.name), entry.name, exclude))
    .sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name))
    .slice(0, maxChildren)
    .map((entry) => toWorkspacePath(context, path.join(rootPath, entry.name)));
}

async function listDisabledManifestExcludes(context, exclude) {
  const disabledDirectories = [];
  await collectDisabledManifestDirectories(context, context.workspaceRoot, exclude, disabledDirectories);
  return disabledDirectories.map((directory) => `${toWorkspacePath(context, directory)}/**`);
}

async function collectDisabledManifestDirectories(context, directory, exclude, disabledDirectories, depth = 0) {
  if (depth > 4) {
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

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const childPath = path.join(directory, entry.name);
    if (isExcluded(context, childPath, entry.name, exclude)) {
      continue;
    }
    await collectDisabledManifestDirectories(context, childPath, exclude, disabledDirectories, depth + 1);
  }
}

async function summarizeDirectoryChildren(context, rootPath, visibleChildren) {
  const entries = await fsp.readdir(rootPath, { withFileTypes: true });
  return {
    childCount: entries.length,
    directoryCount: entries.filter((entry) => entry.isDirectory()).length,
    fileCount: entries.filter((entry) => entry.isFile()).length,
    visibleCount: visibleChildren.length
  };
}

function isExcluded(context, absolutePath, name, exclude, deps = {}) {
  const relativePath = toWorkspacePath(context, absolutePath);
  const normalizedPath = relativePath.replaceAll("\\", "/");
  const lowerPath = normalizedPath.toLowerCase();
  const lowerName = name.toLowerCase();
  const pathParts = lowerPath.split("/").filter(Boolean);
  return isInsideDisabledPluginDirectory(context, absolutePath)
    || exclude.some((item) => {
    const pattern = item.replaceAll("\\", "/").replace(/^\.\//, "");
    const lowerPattern = pattern.toLowerCase();
    return lowerName === lowerPattern
      || pathParts.includes(lowerPattern)
      || lowerPath === lowerPattern
      || lowerPath.endsWith(`/${lowerPattern}`)
      || globToRegExp(lowerPattern).test(lowerPath)
      || Boolean(deps.ignore && deps.ignore().add([pattern]).ignores(normalizedPath));
  });
}

function isDisabledPluginDirectory(absolutePath) {
  return fs.existsSync(path.join(absolutePath, "PluginManifest.disabled.json"))
    && !fs.existsSync(path.join(absolutePath, "PluginManifest.json"));
}

function isInsideDisabledPluginDirectory(context, absolutePath) {
  let current = absolutePath;
  while (true) {
    const relative = path.relative(context.workspaceRoot, current);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return false;
    }
    if (isDisabledPluginDirectory(current)) {
      return true;
    }
    if (!relative) {
      return false;
    }
    current = path.dirname(current);
  }
}

function globToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`(^|/)${escaped}($|/)`);
}

function buildQueryPlan(query, options = {}) {
  const original = query.trim();
  const baseTerms = extractQueryTerms(original);
  const expandedTerms = expandQueryTerms(baseTerms);
  const compoundTerms = compoundIdentifierTerms(baseTerms);
  const phraseCandidates = [
    original,
    ...expandedTerms,
    ...compoundTerms,
    ...expandedTerms.map((term) => toPascalCase(term)).filter(Boolean),
    ...expandedTerms.map((term) => toCamelCase(term)).filter(Boolean)
  ];
  const ripgrepPatterns = unique(phraseCandidates)
    .filter((item) => item.length >= 2)
    .slice(0, 48);
  return {
    original,
    regex: Boolean(options.regex),
    terms: unique([...expandedTerms, ...compoundTerms]).slice(0, 32),
    ripgrepPatterns: ripgrepPatterns.length > 0 ? ripgrepPatterns : [original]
  };
}

function scanDocuments(documents, queryPlan, limit) {
  const terms = queryPlan.terms.map((term) => term.toLowerCase());
  if (terms.length === 0 || limit <= 0) {
    return [];
  }
  const top = [];
  for (const document of documents) {
    const haystack = `${document.path}\n${document.searchText ?? ""}\n${document.text}`.toLowerCase();
    const tokenScore = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
    if (tokenScore <= 0) {
      continue;
    }
    insertTopResult(top, {
      ...document,
      tokenScore
    }, limit, compareScoredDocuments);
  }
  return top;
}

function insertTopResult(items, item, limit, compare) {
  const index = items.findIndex((current) => compare(item, current) < 0);
  if (index === -1) {
    items.push(item);
  } else {
    items.splice(index, 0, item);
  }
  if (items.length > limit) {
    items.length = limit;
  }
}

function compareScoredDocuments(left, right) {
  return right.tokenScore - left.tokenScore || left.path.localeCompare(right.path);
}

function scoreSymbol(symbol, queryPlan) {
  const haystack = `${symbol.name}\n${symbol.kind}\n${symbol.path}\n${symbol.signature}`.toLowerCase();
  const termScore = queryPlan.terms.reduce((total, term) => total + (haystack.includes(term.toLowerCase()) ? 1 : 0), 0);
  const exactBonus = symbol.name.toLowerCase() === queryPlan.original.toLowerCase() ? 3 : 0;
  return exactBonus + termScore + scorePath(symbol.path, queryPlan.terms);
}

function scoreResultContent(result, queryPlan) {
  const haystack = `${result.path}\n${result.snippet}`.toLowerCase();
  const matchedTerms = queryPlan.terms.filter((term) => haystack.includes(term.toLowerCase()));
  const exactPhraseBonus = haystack.includes(queryPlan.original.toLowerCase()) ? 0.6 : 0;
  return Math.min(1.8, matchedTerms.length * 0.18 + scorePath(result.path, queryPlan.terms) + exactPhraseBonus);
}

function buildSearchText(context, filePath, text) {
  const relativePath = toWorkspacePath(context, filePath);
  const identifierTokens = tokenizeIdentifiers(`${relativePath}\n${text}`);
  return unique([
    relativePath,
    ...splitPathTokens(relativePath),
    ...identifierTokens,
    text
  ]).join("\n");
}

function expandQueryTerms(terms) {
  const expanded = [...terms];
  for (const term of terms) {
    expanded.push(...englishTermVariants(term));
    expanded.push(...splitIdentifier(term));
    expanded.push(...chineseNgrams(term, 2, 4));
  }
  return unique(expanded.map((term) => term.trim()).filter(Boolean));
}

function englishTermVariants(term) {
  if (!/^[a-z][a-z0-9_-]*$/i.test(term)) {
    return [];
  }
  const lower = term.toLowerCase();
  const variants = [];
  if (lower.endsWith("ies") && lower.length > 4) {
    variants.push(`${lower.slice(0, -3)}y`);
  }
  if (lower.endsWith("es") && lower.length > 3) {
    variants.push(lower.slice(0, -2));
  }
  if (lower.endsWith("s") && lower.length > 3) {
    variants.push(lower.slice(0, -1));
  } else {
    variants.push(`${lower}s`);
  }
  if (lower.endsWith("ing") && lower.length > 5) {
    variants.push(lower.slice(0, -3));
  }
  if (lower.endsWith("ed") && lower.length > 4) {
    variants.push(lower.slice(0, -2));
  }
  return variants;
}

function chineseNgrams(value, min, max) {
  const chars = [...value].filter((char) => /\p{Script=Han}/u.test(char));
  if (chars.length < min) {
    return [];
  }
  const grams = [];
  for (let size = min; size <= Math.min(max, chars.length); size += 1) {
    for (let index = 0; index <= chars.length - size; index += 1) {
      grams.push(chars.slice(index, index + size).join(""));
    }
  }
  return grams;
}

function compoundIdentifierTerms(terms) {
  const words = terms
    .filter((term) => /^[a-z][a-z0-9]*$/i.test(term))
    .slice(0, 8);
  const compounds = [];
  for (let index = 0; index < words.length - 1; index += 1) {
    for (let size = 2; size <= Math.min(4, words.length - index); size += 1) {
      const parts = words.slice(index, index + size);
      compounds.push(toCamelFromParts(parts));
      compounds.push(toPascalFromParts(parts));
      compounds.push(parts.join("_"));
      compounds.push(parts.join("-"));
      compounds.push(parts.join(""));
    }
  }
  return unique(compounds.filter((item) => item.length >= 3));
}

function tokenizeIdentifiers(value) {
  const identifiers = value.match(/[\p{L}_$][\p{L}\p{N}_$-]*/gu) ?? [];
  return identifiers
    .flatMap((identifier) => [identifier, ...splitIdentifier(identifier)])
    .filter((item) => item.length >= 2);
}

function splitIdentifier(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9\p{L}\p{N}]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitPathTokens(value) {
  return value
    .split(/[\\/._\-\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function extractQueryTerms(query) {
  const terms = query
    .toLowerCase()
    .match(/[\p{L}\p{N}_\-.]{2,}/gu) ?? [];
  return unique([...terms, ...terms.flatMap((term) => splitIdentifier(term))]).slice(0, 16);
}

function summarizeProject(context, topLevelNames, topLevel) {
  const all = new Set(topLevelNames.map((name) => name.toLowerCase()));
  const markers = ["package.json", "tsconfig.json", "senera.config.json", "README.md"]
    .filter((name) => fs.existsSync(path.join(context.workspaceRoot, name)));
  const sourceRoots = topLevel
    .filter((entry) => /源码|TypeScript|package\.json|插件/.test(entry.purpose ?? ""))
    .map((entry) => entry.path);
  const entryPoints = ["Source", "Frontend", "Plugins", "System", "Scripts"]
    .filter((name) => all.has(name.toLowerCase()));
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
      item: unique([...entryPoints, ...sourceRoots]).slice(0, 12)
    }
  };
}

function summarizePathPurpose(name, children, stat) {
  if (!stat.isDirectory()) {
    return "文件";
  }
  const childNames = children.map((child) => path.basename(child).toLowerCase());
  const notes = [];
  if (childNames.includes("package.json")) {
    notes.push("包含 package.json");
  }
  if (childNames.includes("tsconfig.json")) {
    notes.push("包含 TypeScript 配置");
  }
  if (childNames.includes("pluginmanifest.json")) {
    notes.push("包含插件 manifest");
  }
  if (childNames.includes("src") || childNames.includes("source")) {
    notes.push("包含源码目录");
  }
  if (childNames.includes("test") || childNames.includes("tests")) {
    notes.push("包含测试目录");
  }
  return notes.length > 0 ? notes.join("，") : undefined;
}

function emptyIndexData(context, prepared) {
  return {
    version: IndexVersion,
    workspaceRoot: context.workspaceRoot,
    roots: prepared.roots.map((root) => toWorkspacePath(context, root)),
    exclude: prepared.exclude,
    documents: [],
    symbols: [],
    indexedFiles: 0,
    skippedFiles: 0,
    updatedAt: new Date().toISOString()
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

function toWorkspacePath(context, filePath) {
  return path.relative(context.workspaceRoot, filePath).split(path.sep).join("/");
}

function indexStatePath(context, config) {
  const stateDir = path.isAbsolute(config.state_dir)
    ? config.state_dir
    : path.resolve(context.pluginRoot, config.state_dir);
  return path.join(stateDir, "fast-context-index.json");
}

function spawnCollect(command, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: process.env
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

function numberSnippet(text, startLine, maxLines = 24) {
  return text
    .split(/\r?\n/)
    .slice(0, maxLines)
    .map((line, index) => `${startLine + index}: ${line}`)
    .join("\n");
}

function scorePath(filePath, terms) {
  const lower = filePath.toLowerCase();
  return terms.reduce((score, term) => lower.includes(term.toLowerCase()) ? score + 0.2 : score, 0);
}

function resultKey(result) {
  return `${result.path}:${Math.max(1, result.line - 2)}`;
}

function toPascalCase(value) {
  return toPascalFromParts(splitIdentifier(value));
}

function toCamelCase(value) {
  return toCamelFromParts(splitIdentifier(value));
}

function toPascalFromParts(parts) {
  return parts.map(capitalize).join("");
}

function toCamelFromParts(parts) {
  if (parts.length === 0) {
    return "";
  }
  const [first, ...rest] = parts;
  return `${first.toLowerCase()}${rest.map(capitalize).join("")}`;
}

function capitalize(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "";
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = String(value).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

function trimLineBreak(value) {
  return value.replace(/\r?\n$/, "");
}

function readStringArray(value, fallback) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [...fallback];
}

function readInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function readNonEmptyString(value, fallback) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isNodeErrorCode(error, code) {
  return Boolean(error && typeof error === "object" && error.code === code);
}

module.exports = {
  createContext,
  readConfig,
  readFileSegment,
  searchWorkspace,
  searchHybrid,
  searchIndex,
  searchSymbols,
  refreshIndex,
  getWorkspaceMap
};
