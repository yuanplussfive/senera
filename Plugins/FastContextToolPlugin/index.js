"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const FlexSearch = require("flexsearch");
const { rgPath } = require("@vscode/ripgrep");
const pluginSdk = require("senera/plugin-sdk");
const { Schema: SearchArgumentsSchema } = require("./Schemas/FastContextSearchToolArgumentsSchema.js");
const { Schema: SearchResultSchema } = require("./Schemas/FastContextSearchToolResultSchema.js");
const { Schema: ReadArgumentsSchema } = require("./Schemas/FastContextReadToolArgumentsSchema.js");
const { Schema: ReadResultSchema } = require("./Schemas/FastContextReadToolResultSchema.js");
const { Schema: RefreshArgumentsSchema } = require("./Schemas/FastContextRefreshIndexToolArgumentsSchema.js");
const { Schema: RefreshResultSchema } = require("./Schemas/FastContextRefreshIndexToolResultSchema.js");
const { Schema: WorkspaceMapArgumentsSchema } = require("./Schemas/FastContextWorkspaceMapToolArgumentsSchema.js");
const { Schema: WorkspaceMapResultSchema } = require("./Schemas/FastContextWorkspaceMapToolResultSchema.js");

const PluginRoot = path.resolve(process.env.SENERA_PLUGIN_ROOT ?? process.cwd());
const WorkspaceRoot = findWorkspaceRoot();
const ConfigFileName = "PluginConfig.toml";
const IndexVersion = 2;
const DefaultConfig = {
  roots: [],
  exclude: [".git", ".claude", "Dist", "dist", "build", "coverage", "node_modules", ".senera", ".state", "package-lock.json"],
  include_extensions: [".ts", ".tsx", ".vue", ".js", ".jsx", ".json", ".md", ".toml", ".yaml", ".yml", ".css", ".html"],
  max_file_bytes: 300000,
  max_index_files: 5000,
  default_max_results: 12,
  default_context_lines: 4,
  state_dir: ".state"
};
const ConfigSchema = pluginSdk.z.object({
  fast_context: pluginSdk.z.object({
    roots: pluginSdk.z.array(pluginSdk.z.string().trim().min(1)).default(DefaultConfig.roots),
    exclude: pluginSdk.z.array(pluginSdk.z.string().trim().min(1)).default(DefaultConfig.exclude),
    include_extensions: pluginSdk.z.array(pluginSdk.z.string().trim().min(1)).default(DefaultConfig.include_extensions),
    max_file_bytes: pluginSdk.z.coerce.number().int().min(1000).max(5e6).default(DefaultConfig.max_file_bytes),
    max_index_files: pluginSdk.z.coerce.number().int().min(1).max(5e4).default(DefaultConfig.max_index_files),
    default_max_results: pluginSdk.z.coerce.number().int().min(1).max(50).default(DefaultConfig.default_max_results),
    default_context_lines: pluginSdk.z.coerce.number().int().min(0).max(20).default(DefaultConfig.default_context_lines),
    state_dir: pluginSdk.z.string().trim().min(1).default(DefaultConfig.state_dir)
  }).strict().default(DefaultConfig)
}).strict();

function findWorkspaceRoot() {
  if (process.env.SENERA_WORKSPACE_ROOT) {
    return path.resolve(process.env.SENERA_WORKSPACE_ROOT);
  }
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

void pluginSdk.runToolPluginSuite([
  {
    toolName: "FastContextSearchTool",
    argumentSchema: SearchArgumentsSchema,
    resultSchema: SearchResultSchema,
    async execute(args) {
      return searchFastContext(args);
    }
  },
  {
    toolName: "FastContextReadTool",
    argumentSchema: ReadArgumentsSchema,
    resultSchema: ReadResultSchema,
    async execute(args) {
      return readFastContext(args);
    }
  },
  {
    toolName: "FastContextRefreshIndexTool",
    argumentSchema: RefreshArgumentsSchema,
    resultSchema: RefreshResultSchema,
    async execute(args) {
      return refreshFastContextIndex(args);
    }
  },
  {
    toolName: "FastContextWorkspaceMapTool",
    argumentSchema: WorkspaceMapArgumentsSchema,
    resultSchema: WorkspaceMapResultSchema,
    async execute(args) {
      return getWorkspaceMap(args);
    }
  }
]);

async function searchFastContext(args) {
  const startedAt = Date.now();
  const config = readConfig();
  const configuredRoots = await configuredSearchRoots(config);
  const requestedRoots = args.roots?.item ?? configuredRoots;
  const rootResolution = await resolveExistingRoots(requestedRoots, {
    fallbackRoots: args.roots ? configuredRoots : [],
    exclude: config.exclude
  });
  const roots = rootResolution.roots;
  const includeExtensions = normalizeExtensions(args.includeExtensions?.item ?? config.include_extensions);
  const exclude = [...config.exclude, ...(args.exclude?.item ?? [])];
  const maxResults = args.maxResults ?? config.default_max_results;
  const contextLines = args.contextLines ?? config.default_context_lines;
  const refreshedIndex = Boolean(args.refreshIndex);
  const queryPlan = buildQueryPlan(args.query, {
    regex: args.regex
  });
  const indexData = roots.length === 0
    ? emptyIndexData({ roots, includeExtensions, exclude })
    : refreshedIndex
    ? await buildAndSaveIndex({ config, roots, includeExtensions, exclude })
    : await loadOrBuildIndex({ config, roots, includeExtensions, exclude });
  const ripgrepResults = roots.length === 0 ? [] : await runRipgrepSearchPlan({
    queryPlan,
    roots,
    includeExtensions,
    exclude,
    contextLines,
    regex: args.regex,
    caseSensitive: args.caseSensitive,
    maxResults: maxResults * 4
  });
  const flexSearchResults = searchFlexIndex(indexData, queryPlan, maxResults * 4);
  const merged = mergeResults({
    query: args.query,
    queryPlan,
    ripgrepResults,
    flexSearchResults,
    maxResults,
    contextLines
  });
  return {
    query: args.query,
    workspaceRoot: WorkspaceRoot,
    results: {
      item: merged
    },
    warnings: {
      item: rootResolution.warnings
    },
    availableRoots: {
      item: await listAvailableRoots(config.exclude)
    },
    stats: {
      resultCount: merged.length,
      ripgrepMatchCount: ripgrepResults.length,
      queryPatternCount: queryPlan.ripgrepPatterns.length,
      indexDocumentCount: indexData.documents.length,
      refreshedIndex,
      elapsedMs: Date.now() - startedAt
    }
  };
}

async function readFastContext(args) {
  const config = readConfig();
  const absolutePath = resolveWorkspacePath(args.path);
  await assertReadableTextFile(absolutePath, config);
  const content = await fsp.readFile(absolutePath, "utf8");
  const lines = content.split(/\r?\n/);
  const startLine = args.startLine ?? 1;
  const endLine = args.endLine ?? Math.min(lines.length, startLine + 120);
  const selectedLines = lines.slice(startLine - 1, endLine);
  const numbered = selectedLines.map((line, index) => `${startLine + index}: ${line}`).join("\n");
  const truncated = numbered.length > args.maxChars;
  return {
    path: toWorkspacePath(absolutePath),
    startLine,
    endLine: Math.min(endLine, lines.length),
    totalLines: lines.length,
    content: truncated ? numbered.slice(0, args.maxChars) : numbered,
    truncated
  };
}

async function refreshFastContextIndex(args) {
  const startedAt = Date.now();
  const config = readConfig();
  const configuredRoots = await configuredSearchRoots(config);
  const requestedRoots = args.roots?.item ?? configuredRoots;
  const rootResolution = await resolveExistingRoots(requestedRoots, {
    fallbackRoots: args.roots ? configuredRoots : [],
    exclude: config.exclude
  });
  const roots = rootResolution.roots;
  const indexData = await buildAndSaveIndex({
    config,
    roots,
    includeExtensions: normalizeExtensions(config.include_extensions),
    exclude: config.exclude
  });
  return {
    workspaceRoot: WorkspaceRoot,
    indexedFiles: indexData.indexedFiles,
    indexedDocuments: indexData.documents.length,
    skippedFiles: indexData.skippedFiles,
    stateFile: indexStatePath(config),
    warnings: {
      item: rootResolution.warnings
    },
    availableRoots: {
      item: await listAvailableRoots(config.exclude)
    },
    elapsedMs: Date.now() - startedAt
  };
}

async function getWorkspaceMap(args) {
  const config = readConfig();
  const topLevelNames = await listAvailableRoots(config.exclude);
  const configuredRoots = await configuredSearchRoots(config);
  const indexed = await resolveExistingRoots(configuredRoots, {
    exclude: config.exclude
  });
  const topLevel = [];
  for (const name of topLevelNames) {
    const absolutePath = resolveWorkspacePath(name);
    const stat = await fsp.stat(absolutePath);
    const children = stat.isDirectory()
      ? await listDirectChildren(absolutePath, args.maxChildrenPerRoot, config.exclude)
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
  return {
    workspaceRoot: WorkspaceRoot,
    topLevel: {
      item: topLevel
    },
    indexedRoots: {
      item: indexed.roots.map(toWorkspacePath)
    },
    availableRoots: {
      item: topLevelNames
    },
    includeExtensions: {
      item: normalizeExtensions(config.include_extensions)
    },
    guidance: {
      item: [
        "优先使用 indexedRoots 或 topLevel 中真实存在的路径，不要猜常见目录名。",
        "不确定目录时省略 roots，使用插件配置的默认搜索范围。",
        "需要更大上下文时先用搜索结果 path，再调用读取工具按行读取。",
        "搜索不到时换更短的关键词、标识符片段或路径片段重试。"
      ]
    }
  };
}

function readConfig() {
  const configPath = path.join(PluginRoot, ConfigFileName);
  if (!fs.existsSync(configPath)) {
    return ConfigSchema.parse({ fast_context: DefaultConfig }).fast_context;
  }
  const parsed = pluginSdk.readPluginTomlConfig(ConfigFileName);
  return ConfigSchema.parse(parsed).fast_context;
}

async function configuredSearchRoots(config) {
  if (config.roots.length > 0) {
    return config.roots;
  }
  return listAvailableRoots(config.exclude);
}

async function loadOrBuildIndex(options) {
  const stateFile = indexStatePath(options.config);
  try {
    const raw = await fsp.readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    if (isUsableIndex(parsed, options)) {
      return parsed;
    }
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
  return buildAndSaveIndex(options);
}

async function buildAndSaveIndex(options) {
  const documents = [];
  let indexedFiles = 0;
  let skippedFiles = 0;
  for (const root of options.roots) {
    for await (const filePath of walkFiles(root, options)) {
      if (documents.length >= options.config.max_index_files) {
        skippedFiles += 1;
        continue;
      }
      try {
        const fileDocuments = await fileToDocuments(filePath, options.config);
        if (fileDocuments.length > 0) {
          documents.push(...fileDocuments);
          indexedFiles += 1;
        } else {
          skippedFiles += 1;
        }
      } catch {
        skippedFiles += 1;
      }
    }
  }
  const indexData = {
    version: IndexVersion,
    workspaceRoot: WorkspaceRoot,
    roots: options.roots.map(toWorkspacePath),
    includeExtensions: options.includeExtensions,
    exclude: options.exclude,
    documents,
    indexedFiles,
    skippedFiles,
    updatedAt: new Date().toISOString()
  };
  const stateFile = indexStatePath(options.config);
  await fsp.mkdir(path.dirname(stateFile), { recursive: true });
  await fsp.writeFile(stateFile, JSON.stringify(indexData), "utf8");
  return indexData;
}

function isUsableIndex(value, options) {
  return value
    && value.version === IndexVersion
    && value.workspaceRoot === WorkspaceRoot
    && Array.isArray(value.documents)
    && JSON.stringify(value.roots) === JSON.stringify(options.roots.map(toWorkspacePath))
    && JSON.stringify(value.includeExtensions) === JSON.stringify(options.includeExtensions)
    && JSON.stringify(value.exclude) === JSON.stringify(options.exclude);
}

function searchFlexIndex(indexData, queryPlan, maxResults) {
  if (indexData.documents.length === 0) {
    return [];
  }
  const index = new FlexSearch.Document({
    tokenize: "forward",
    document: {
      id: "id",
      index: ["path", "searchText", "text"],
      store: ["path", "startLine", "endLine", "text"]
    }
  });
  indexData.documents.forEach((document) => {
    index.add(document);
  });
  const seen = new Set();
  const found = [];
  for (const query of queryPlan.flexQueries) {
    for (const group of index.search(query, { enrich: true, limit: maxResults })) {
      for (const item of group.result ?? []) {
        const document = item.doc;
        if (!document || seen.has(document.id)) {
          continue;
        }
        seen.add(document.id);
        found.push({
          ...document,
          matchedQuery: query
        });
        if (found.length >= maxResults) {
          break;
        }
      }
      if (found.length >= maxResults) {
        break;
      }
    }
    if (found.length >= maxResults) {
      break;
    }
  }
  if (found.length < maxResults) {
    const fallbackResults = scanDocuments(indexData.documents, queryPlan, maxResults - found.length);
    for (const document of fallbackResults) {
      if (!document || seen.has(document.id)) {
        continue;
      }
      seen.add(document.id);
      found.push(document);
      if (found.length >= maxResults) {
        break;
      }
    }
  }
  return found.map((result, indexOffset) => ({
    path: result.path,
    startLine: result.startLine,
    endLine: result.endLine,
    line: result.startLine,
    snippet: numberSnippet(result.text, result.startLine, 24),
    score: Math.max(0.1, 1.2 - indexOffset * 0.03),
    source: "flexsearch",
    matches: {
      item: queryPlan.terms
    },
    reason: result.matchedQuery
      ? `FlexSearch full-text index match: ${result.matchedQuery}`
      : "local token scan match"
  }));
}

async function runRipgrepSearchPlan(options) {
  const requestedMaxResults = options.maxResults;
  const collectMaxResults = Math.max(requestedMaxResults * 8, requestedMaxResults);
  if (options.queryPlan.regex) {
    return runRipgrepSearch({
      ...options,
      patterns: [options.queryPlan.original],
      regex: true,
      maxResults: collectMaxResults,
      resultLimit: requestedMaxResults
    });
  }
  return runRipgrepSearch({
    ...options,
    patterns: options.queryPlan.ripgrepPatterns,
    regex: false,
    maxResults: collectMaxResults,
    resultLimit: requestedMaxResults
  });
}

async function runRipgrepSearch(options) {
  const args = [
    "--json",
    "--with-filename",
    "--line-number",
    "--max-count",
    String(options.maxResults),
    "--glob",
    buildIncludeGlob(options.includeExtensions),
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
  const output = await spawnCollect(rgPath, args, WorkspaceRoot, 5000);
  if (output.exitCode !== 0 && output.exitCode !== 1) {
    throw new Error(`ripgrep 搜索失败：${output.stderr || output.stdout}`);
  }
  const matches = parseRipgrepJsonMatches(output.stdout);
  return hydrateRipgrepResults(matches, options.contextLines, options.resultLimit ?? options.maxResults, options.queryPlan);
}

function parseRipgrepJsonMatches(stdout) {
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
    const relativePath = toWorkspacePath(absolutePath);
    results.push({
      path: relativePath,
      absolutePath,
      line: lineNumber,
      text: trimLineBreak(text)
    });
  }
  return results;
}

async function hydrateRipgrepResults(matches, contextLines, maxResults, queryPlan) {
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
    .sort((left, right) => right.score - left.score || scorePath(right.path, queryPlan.terms) - scorePath(left.path, queryPlan.terms) || left.path.localeCompare(right.path) || left.line - right.line)
    .slice(0, maxResults);
}

function mergeResults(options) {
  const byKey = new Map();
  const queryTerms = options.queryPlan.terms;
  for (const result of options.ripgrepResults) {
    const key = resultKey(result);
    byKey.set(key, {
      ...result,
      matches: {
        item: queryTerms
      },
      score: 1.5 + scorePath(result.path, queryTerms),
      source: "ripgrep"
    });
  }
  for (const result of options.flexSearchResults) {
    const key = resultKey(result);
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, {
        ...existing,
        source: "combined",
        score: existing.score + result.score,
        reason: "ripgrep exact match plus FlexSearch full-text match"
      });
    } else {
      byKey.set(key, {
        ...result,
        score: result.score + scorePath(result.path, queryTerms)
      });
    }
  }
  return [...byKey.values()]
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || left.line - right.line)
    .slice(0, options.maxResults)
    .map((item) => ({
      ...item,
      score: Math.round(item.score * 1000) / 1000
  }));
}

function scoreResultContent(result, queryPlan) {
  const haystack = `${result.path}\n${result.snippet}`.toLowerCase();
  const matchedTerms = queryPlan.terms.filter((term) => haystack.includes(term.toLowerCase()));
  const exactPhraseBonus = haystack.includes(queryPlan.original.toLowerCase()) ? 0.6 : 0;
  return Math.min(1.8, matchedTerms.length * 0.18 + scorePath(result.path, queryPlan.terms) + exactPhraseBonus);
}

async function* walkFiles(root, options) {
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    const relativePath = toWorkspacePath(filePath);
    if (shouldExclude(relativePath, entry.name, options.exclude)) {
      continue;
    }
    if (entry.isDirectory()) {
      yield* walkFiles(filePath, options);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!options.includeExtensions.includes(path.extname(entry.name).toLowerCase())) {
      continue;
    }
    yield filePath;
  }
}

async function fileToDocuments(filePath, config) {
  await assertReadableTextFile(filePath, config);
  const content = await fsp.readFile(filePath, "utf8");
  if (content.includes("\0")) {
    return [];
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
      id: `${toWorkspacePath(filePath)}:${start + 1}`,
      path: toWorkspacePath(filePath),
      startLine: start + 1,
      endLine: Math.min(lines.length, start + selected.length),
      text,
      searchText: buildSearchText(filePath, text)
    });
  }
  return documents;
}

async function assertReadableTextFile(filePath, config) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`不是文件：${toWorkspacePath(filePath)}`);
  }
  if (stat.size > config.max_file_bytes) {
    throw new Error(`文件超过 max_file_bytes 限制：${toWorkspacePath(filePath)}`);
  }
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
  const flexQueries = unique([
    original,
    baseTerms.join(" "),
    expandedTerms.join(" "),
    ...compoundTerms,
    ...baseTerms,
    ...expandedTerms
  ])
    .filter((item) => item.length >= 2)
    .slice(0, 32);
  return {
    original,
    regex: Boolean(options.regex),
    terms: unique([...expandedTerms, ...compoundTerms]).slice(0, 32),
    ripgrepPatterns: ripgrepPatterns.length > 0 ? ripgrepPatterns : [original],
    flexQueries: flexQueries.length > 0 ? flexQueries : [original]
  };
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

function buildSearchText(filePath, text) {
  const relativePath = toWorkspacePath(filePath);
  const identifierTokens = tokenizeIdentifiers(`${relativePath}\n${text}`);
  return unique([
    relativePath,
    ...splitPathTokens(relativePath),
    ...identifierTokens,
    text
  ]).join("\n");
}

function tokenizeIdentifiers(value) {
  const identifiers = value.match(/[\p{L}_$][\p{L}\p{N}_$-]*/gu) ?? [];
  const tokens = [];
  for (const identifier of identifiers) {
    tokens.push(identifier);
    tokens.push(...splitIdentifier(identifier));
  }
  return tokens.filter((item) => item.length >= 2);
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

function scanDocuments(documents, queryPlan, limit) {
  if (limit <= 0) {
    return [];
  }
  const terms = queryPlan.terms.map((term) => term.toLowerCase());
  if (terms.length === 0) {
    return [];
  }
  return documents
    .map((document) => {
      const haystack = `${document.path}\n${document.searchText ?? ""}\n${document.text}`.toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term.toLowerCase()) ? 1 : 0), 0);
      return score > 0
        ? {
          ...document,
          tokenScore: score
        }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.tokenScore - left.tokenScore || left.path.localeCompare(right.path))
    .slice(0, limit);
}

async function resolveExistingRoots(roots, options = {}) {
  const resolvedRoots = [];
  const warnings = [];
  const seen = new Set();
  for (const root of roots) {
    let absolutePath;
    try {
      absolutePath = await resolveExistingWorkspacePath(root);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (!absolutePath) {
      warnings.push(`工作区不存在 root：${root}。可用顶层 roots：${(await listAvailableRoots(options.exclude)).join(", ")}`);
      continue;
    }
    const key = toWorkspacePath(absolutePath).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    resolvedRoots.push(absolutePath);
  }
  if (resolvedRoots.length > 0 || !options.fallbackRoots?.length) {
    return {
      roots: resolvedRoots,
      warnings
    };
  }
  const fallback = await resolveExistingRoots(options.fallbackRoots, {
    exclude: options.exclude
  });
  return {
    roots: fallback.roots,
    warnings: [
      ...warnings,
      `请求的 roots 都不可用，已回退到插件默认 roots：${fallback.roots.map(toWorkspacePath).join(", ")}`,
      ...fallback.warnings
    ]
  };
}

async function resolveExistingWorkspacePath(value) {
  const resolved = resolveWorkspacePath(value);
  const relative = path.relative(WorkspaceRoot, resolved);
  if (!relative) {
    return WorkspaceRoot;
  }
  let current = WorkspaceRoot;
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

function emptyIndexData(options) {
  return {
    version: IndexVersion,
    workspaceRoot: WorkspaceRoot,
    roots: options.roots.map(toWorkspacePath),
    includeExtensions: options.includeExtensions,
    exclude: options.exclude,
    documents: [],
    indexedFiles: 0,
    skippedFiles: 0,
    updatedAt: new Date().toISOString()
  };
}

async function listAvailableRoots(exclude = DefaultConfig.exclude) {
  const entries = await fsp.readdir(WorkspaceRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !shouldExclude(name, name, exclude))
    .sort((left, right) => left.localeCompare(right));
}

async function listDirectChildren(rootPath, maxChildren, exclude) {
  if (maxChildren <= 0) {
    return [];
  }
  const entries = await fsp.readdir(rootPath, { withFileTypes: true });
  return entries
    .filter((entry) => !shouldExclude(toWorkspacePath(path.join(rootPath, entry.name)), entry.name, exclude))
    .sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name))
    .slice(0, maxChildren)
    .map((entry) => toWorkspacePath(path.join(rootPath, entry.name)));
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
  if (notes.length > 0) {
    return notes.join("，");
  }
  const directoryCount = childNames.filter((childName) => !path.extname(childName)).length;
  return directoryCount > 0
    ? `包含 ${directoryCount} 个直接子目录`
    : undefined;
}

function resolveWorkspacePath(value) {
  const resolved = path.resolve(WorkspaceRoot, value);
  const relative = path.relative(WorkspaceRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`路径超出工作区：${value}`);
  }
  return resolved;
}

function toWorkspacePath(filePath) {
  return path.relative(WorkspaceRoot, filePath).split(path.sep).join("/");
}

function normalizeExtensions(extensions) {
  return extensions.map((item) => item.startsWith(".") ? item.toLowerCase() : `.${item.toLowerCase()}`);
}

function shouldExclude(relativePath, name, exclude) {
  const normalizedPath = relativePath.split(path.sep).join("/").toLowerCase();
  const pathParts = normalizedPath.split("/").filter(Boolean);
  const normalizedName = name.toLowerCase();
  return exclude.some((item) => {
    const normalized = item.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
    const normalizedParts = normalized.split("/").filter(Boolean);
    return normalizedName === normalized
      || pathParts.includes(normalized)
      || normalizedPath === normalized
      || normalizedPath.endsWith(`/${normalized}`)
      || normalizedParts.length > 1 && normalizedPath.includes(normalizedParts.join("/"));
  });
}

function buildIncludeGlob(extensions) {
  return extensions.length === 1
    ? `*${extensions[0]}`
    : `*.{${extensions.map((item) => item.slice(1)).join(",")}}`;
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
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);
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

function indexStatePath(config) {
  const stateDir = path.isAbsolute(config.state_dir)
    ? config.state_dir
    : path.resolve(PluginRoot, config.state_dir);
  return path.join(stateDir, "fast-context-index.json");
}

function numberSnippet(text, startLine, maxLines = 24) {
  return text.split(/\r?\n/).slice(0, maxLines).map((line, index) => `${startLine + index}: ${line}`).join("\n");
}

function scorePath(filePath, terms) {
  const lower = filePath.toLowerCase();
  return terms.reduce((score, term) => lower.includes(term.toLowerCase()) ? score + 0.2 : score, 0);
}

function extractQueryTerms(query) {
  const terms = query
    .toLowerCase()
    .match(/[\p{L}\p{N}_\-.]{2,}/gu) ?? [];
  const splitTerms = terms.flatMap((term) => splitIdentifier(term));
  return unique([...terms, ...splitTerms]).slice(0, 16);
}

function resultKey(result) {
  return `${result.path}:${Math.max(1, result.line - 2)}`;
}

function toPascalCase(value) {
  const parts = splitIdentifier(value);
  if (parts.length === 0) {
    return "";
  }
  return toPascalFromParts(parts);
}

function toCamelCase(value) {
  const parts = splitIdentifier(value);
  return toCamelFromParts(parts);
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
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function trimLineBreak(value) {
  return value.replace(/\r?\n$/, "");
}

function isNodeErrorCode(error, code) {
  return Boolean(error && typeof error === "object" && error.code === code);
}
