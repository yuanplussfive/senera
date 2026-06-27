"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const fuzzysort = require("fuzzysort");
const {
  resolveExistingWorkspacePath,
  resolveWorkspacePath,
  toWorkspacePath
} = require("./Context.js");
const { listAvailableRoots, prepareSearch } = require("./Discovery.js");
const { runLlmScoutPlanner } = require("./ScoutLlmPlanner.js");
const { numberedLines, readTextFile, splitLines } = require("./TextFile.js");

const QuerySourceReaders = {
  question: (_config, inputs) => [inputs.question],
  hints: (_config, inputs) => inputs.hints,
  question_terms: (config, inputs) => deriveTokenQueries(inputs.question, config.scout.tokenizer),
  marker_files: (_config, inputs) => inputs.markerFiles
};

const MarkerPathTargetReaders = {
  basename: (workspacePath) => path.basename(workspacePath),
  path: (workspacePath) => workspacePath
};

async function scoutWorkspace(context, config, args, deps) {
  assertScoutConfig(config);
  const startedAt = Date.now();
  const prepared = await prepareSearch(context, config, {
    roots: args.roots,
    exclude: args.exclude,
    maxResults: args.maxResults ?? config.scout.maxResultsPerQuery,
    contextLines: args.contextLines ?? config.scout.contextLines
  });
  const queryPlan = buildScoutQueryPlan(config, args);
  const markerCandidates = config.scout.bootstrapMarkers
    ? await collectMarkerCandidates(context, config, prepared, queryPlan)
    : [];
  const searchRuns = [];
  const searchResults = [];
  let refreshedIndex = false;

  for (const query of queryPlan.item) {
    const run = await deps.searchHybrid(context, config, {
      query,
      roots: args.roots,
      exclude: args.exclude,
      maxResults: args.maxResults ?? config.scout.maxResultsPerQuery,
      contextLines: args.contextLines ?? config.scout.contextLines,
      regex: false,
      caseSensitive: false,
      refreshIndex: Boolean(args.refreshIndex ?? config.scout.refreshIndex) && !refreshedIndex
    }, deps);
    refreshedIndex = refreshedIndex || run.stats.refreshedIndex;
    searchRuns.push(projectScoutSearchRun(run));
    searchResults.push(...run.results.item);
  }

  const directCandidates = [
    ...markerCandidates,
    ...searchResults.map(searchResultToScoutCandidate)
  ];
  const referencedCandidates = config.scout.referenceProfile.enabled
    ? await collectReferencedPathCandidates(context, config, prepared, directCandidates)
    : [];
  const baseCandidates = [
    ...directCandidates,
    ...referencedCandidates
  ];
  const planningMode = args.planningMode ?? config.scout.llmPlanner.mode;
  if (planningMode === "llm" && !config.scout.llmPlanner.enabled) {
    throw new Error("FastContextScoutTool 的 llm 模式未启用。");
  }
  const llmPlanner = planningMode === "llm"
    ? await runLlmScoutPlanner({
      context,
      config,
      prepared,
      args,
      deps,
      queryPlan,
      directCandidates: baseCandidates
    })
    : undefined;
  const rankedFiles = rankScoutFiles([
    ...baseCandidates,
    ...(llmPlanner?.candidates ?? [])
  ], args.maxFiles ?? config.scout.maxFiles);
  const files = [];
  for (const candidate of rankedFiles) {
    const file = await readScoutFile(context, config, candidate, args);
    if (file) {
      files.push(file);
    }
  }

  return {
    question: args.question,
    workspaceRoot: context.workspaceRoot,
    queryPlan,
    files: {
      item: files
    },
    searchRuns: {
      item: searchRuns
    },
    warnings: {
      item: [
        ...prepared.warnings,
        ...searchRuns.flatMap((run) => run.warnings.item)
      ]
    },
    availableRoots: {
      item: await listAvailableRoots(context, { exclude: config.exclude })
    },
    diagnostics: {
      markerCandidates: markerCandidates.length,
      referencedCandidates: referencedCandidates.length,
      searchedQueries: queryPlan.item.length,
      searchedMatches: searchResults.length,
      selectedFiles: files.length,
      refreshedIndex,
      elapsedMs: Date.now() - startedAt,
      ...(llmPlanner ? { llmPlanner: llmPlanner.diagnostics } : {})
    }
  };
}

function assertScoutConfig(config) {
  if (!config.scout) {
    throw new Error("FastContextScoutTool 需要在插件配置中声明 fast_context.scout。");
  }
}

function buildScoutQueryPlan(config, args) {
  const inputs = {
    question: args.question,
    hints: args.hints?.item ?? [],
    markerFiles: config.scout.bootstrapMarkers ? config.map.markerFiles : []
  };
  const source = config.scout.querySources.flatMap((sourceName) => querySourceValues(config, inputs, sourceName));
  return {
    item: unique(source
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))
      .slice(0, args.maxQueries ?? config.scout.maxQueries)
  };
}

function querySourceValues(config, inputs, sourceName) {
  return QuerySourceReaders[sourceName]?.(config, inputs) ?? [];
}

function deriveTokenQueries(question, tokenizer) {
  return unique(splitBySeparators(String(question), tokenizer.separators)
    .map((value) => value.trim())
    .filter((value) => value.length >= tokenizer.minLength)
    .slice(0, tokenizer.maxTerms));
}

function splitBySeparators(value, separators) {
  if (value.length === 0) {
    return [];
  }
  const tokens = [];
  let token = "";
  for (const char of value) {
    if (separators.includes(char)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    token += char;
  }
  if (token) {
    tokens.push(token);
  }
  return tokens;
}

async function collectMarkerCandidates(context, config, prepared, queryPlan) {
  const candidates = [];
  const roots = new Set(prepared.roots.map((root) => toWorkspacePath(context, root)));
  for (const marker of config.map.markerFiles) {
    const markerPath = resolveWorkspacePath(context, marker);
    let stat;
    try {
      stat = await fsp.stat(markerPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) {
      continue;
    }
    const workspacePath = toWorkspacePath(context, markerPath);
    if (!isWithinPreparedRoots(workspacePath, roots)) {
      continue;
    }
    const profile = combineMarkerProfiles(
      profileMarkerPath(config, workspacePath, queryPlan.item),
      await profileMarkerFile(context, config, markerPath, queryPlan.item)
    );
    candidates.push({
      path: workspacePath,
      score: config.scout.markerProfile.baseScore + profile.score,
      startLine: profile.startLine,
      endLine: profile.endLine,
      line: profile.line,
      reasons: [config.scout.markerProfile.sourceReason, ...profile.reasons],
      snippets: [workspacePath, ...profile.snippets],
      focus: profile.focus || marker
    });
  }
  return candidates;
}

async function collectReferencedPathCandidates(context, config, prepared, sourceCandidates) {
  const profile = config.scout.referenceProfile;
  const roots = new Set(prepared.roots.map((root) => toWorkspacePath(context, root)));
  const candidates = new Map();
  for (const source of sourceCandidates) {
    const textItems = unique(source.snippets ?? []).slice(0, profile.maxSourceSnippets);
    for (const text of textItems) {
      for (const token of extractReferenceTokens(text, profile)) {
        const resolved = await resolveReferenceToken(context, token);
        if (!resolved || !isWithinPreparedRoots(resolved.path, roots) || resolved.path === source.path) {
          continue;
        }
        const existing = candidates.get(resolved.path);
        const sourceRef = `${source.path}: ${token}`;
        const candidate = {
          path: resolved.path,
          score: profile.score,
          startLine: 1,
          endLine: 1,
          line: 1,
          reasons: [profile.reason],
          snippets: [sourceRef],
          focus: token,
          referenceSources: [source.path],
          referenceTokens: [token]
        };
        if (!existing) {
          candidates.set(resolved.path, candidate);
          continue;
        }
        if (!existing.referenceSources.includes(source.path)) {
          existing.score = Math.min(profile.maxScorePerPath, existing.score + candidate.score);
          existing.referenceSources.push(source.path);
        }
        existing.snippets = unique([...existing.snippets, ...candidate.snippets]);
        existing.referenceTokens = unique([...existing.referenceTokens, token].filter(Boolean));
        existing.focus = existing.referenceTokens.join(", ");
      }
    }
  }
  return [...candidates.values()]
    .map(({ referenceSources: _referenceSources, referenceTokens: _referenceTokens, ...candidate }) => candidate)
    .slice(0, profile.maxReferences);
}

function extractReferenceTokens(value, profile) {
  return unique(splitBySeparators(String(value), profile.delimiters)
    .map((token) => trimTokenCharacters(token, profile.trimCharacters))
    .filter((token) => token.length >= profile.minLength));
}

function trimTokenCharacters(value, characters) {
  let start = 0;
  let end = value.length;
  while (start < end && characters.includes(value[start])) {
    start += 1;
  }
  while (end > start && characters.includes(value[end - 1])) {
    end -= 1;
  }
  return value.slice(start, end);
}

async function resolveReferenceToken(context, token) {
  let absolutePath;
  try {
    absolutePath = await resolveExistingWorkspacePath(context, token, fsp);
  } catch {
    return undefined;
  }
  if (!absolutePath) {
    return undefined;
  }
  let stat;
  try {
    stat = await fsp.stat(absolutePath);
  } catch {
    return undefined;
  }
  if (!stat.isFile()) {
    return undefined;
  }
  return {
    path: toWorkspacePath(context, absolutePath)
  };
}

function profileMarkerPath(config, workspacePath, queries) {
  const profile = config.scout.markerProfile;
  const targets = markerPathTargets(profile.pathTargets, workspacePath);
  const matches = [];
  for (const query of queries) {
    for (const target of targets) {
      const result = fuzzysort.single(query, target.value);
      if (!result || result.score < profile.pathMatchThreshold) {
        continue;
      }
      matches.push({
        query,
        target: target.name,
        value: target.value,
        score: result.score * target.weight
      });
    }
  }

  if (matches.length === 0) {
    return emptyMarkerProfile();
  }

  const bestByQuery = new Map();
  for (const match of matches) {
    const existing = bestByQuery.get(match.query);
    if (!existing || match.score > existing.score) {
      bestByQuery.set(match.query, match);
    }
  }
  const bestMatches = [...bestByQuery.values()];
  const best = bestMatches.sort((left, right) => right.score - left.score)[0];
  return {
    score: bestMatches.reduce((sum, match) => sum + match.score, 0) * profile.pathMatchWeight,
    startLine: 1,
    endLine: 1,
    line: 1,
    reasons: [
      `${profile.pathReason} (${bestMatches.length} queries)`
    ],
    snippets: bestMatches
      .slice(0, profile.maxSnippets)
      .map((match) => `${match.target}: ${match.value}`),
    focus: best?.query ?? ""
  };
}

function markerPathTargets(targets, workspacePath) {
  return targets
    .map((target) => ({
      name: target.name,
      value: markerPathTargetValue(target.selector, workspacePath),
      weight: target.weight
    }))
    .filter((target) => target.value);
}

function markerPathTargetValue(selector, workspacePath) {
  return MarkerPathTargetReaders[selector]?.(workspacePath) ?? "";
}

function combineMarkerProfiles(...profiles) {
  const present = profiles.filter(Boolean);
  if (present.length === 0) {
    return emptyMarkerProfile();
  }
  return {
    score: present.reduce((sum, profile) => sum + profile.score, 0),
    startLine: Math.min(...present.map((profile) => profile.startLine)),
    endLine: Math.max(...present.map((profile) => profile.endLine)),
    line: present.find((profile) => profile.line > 1)?.line ?? 1,
    reasons: unique(present.flatMap((profile) => profile.reasons)),
    snippets: unique(present.flatMap((profile) => profile.snippets)),
    focus: present.map((profile) => profile.focus).filter(Boolean).join(", ")
  };
}

async function profileMarkerFile(context, config, absolutePath, queries) {
  let loaded;
  try {
    loaded = await readTextFile(context, config, absolutePath);
  } catch {
    return emptyMarkerProfile();
  }

  const lines = splitLines(loaded.text);
  const matches = collectLineMatches(lines, queries, config.scout.tokenizer);
  if (matches.length === 0) {
    return {
      ...emptyMarkerProfile(),
      endLine: Math.min(lines.length, config.scout.readLineWindow)
    };
  }

  const first = matches[0];
  const last = matches[matches.length - 1];
  const distinctTerms = unique(matches.flatMap((match) => match.matched));
  const profile = config.scout.markerProfile;
  return {
    score: distinctTerms.length * profile.distinctTermWeight + matches.length * profile.lineMatchWeight,
    startLine: Math.max(1, first.line - config.scout.contextLines),
    endLine: Math.min(lines.length, last.line + config.scout.contextLines),
    line: first.line,
    reasons: [
      `${profile.contentReason} (${distinctTerms.length} terms, ${matches.length} lines)`
    ],
    snippets: matches.slice(0, profile.maxSnippets).map((match) => `${match.line}: ${match.text}`),
    focus: distinctTerms.join(", ")
  };
}

function emptyMarkerProfile() {
  return {
    score: 0,
    startLine: 1,
    endLine: 1,
    line: 1,
    reasons: [],
    snippets: [],
    focus: ""
  };
}

function collectLineMatches(lines, queries, tokenizer) {
  const normalizedQueries = unique(queries
    .map((query) => String(query).trim())
    .filter((query) => query.length >= tokenizer.minLength));
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matched = normalizedQueries.filter((query) => containsText(line, query, tokenizer.caseSensitive));
    if (matched.length === 0) {
      continue;
    }
    matches.push({
      line: index + 1,
      text: line.trim(),
      matched
    });
  }
  return matches;
}

function containsText(value, query, caseSensitive) {
  if (caseSensitive) {
    return value.includes(query);
  }
  return value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function isWithinPreparedRoots(workspacePath, roots) {
  return roots.has(".") || [...roots].some((root) => workspacePath === root || workspacePath.startsWith(`${root}/`));
}

function searchResultToScoutCandidate(result) {
  return {
    path: result.path,
    score: result.score,
    startLine: result.startLine,
    endLine: result.endLine,
    line: result.line,
    reasons: [result.reason],
    snippets: [result.snippet],
    focus: result.focusSummary ?? ""
  };
}

function rankScoutFiles(candidates, maxFiles) {
  const byPath = new Map();
  for (const candidate of candidates) {
    const existing = byPath.get(candidate.path);
    if (!existing) {
      byPath.set(candidate.path, {
        ...candidate,
        reasons: [...candidate.reasons],
        snippets: [...candidate.snippets],
        minLine: candidate.startLine,
        maxLine: candidate.endLine
      });
      continue;
    }
    existing.score += candidate.score;
    existing.reasons = unique([...existing.reasons, ...candidate.reasons]);
    existing.snippets = unique([...existing.snippets, ...candidate.snippets]);
    existing.minLine = Math.min(existing.minLine, candidate.startLine);
    existing.maxLine = Math.max(existing.maxLine, candidate.endLine);
    existing.focus = existing.focus || candidate.focus;
  }

  return [...byPath.values()]
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, maxFiles);
}

async function readScoutFile(context, config, candidate, args) {
  const absolutePath = await resolveExistingWorkspacePath(context, candidate.path, fsp);
  if (!absolutePath) {
    return null;
  }
  let stat;
  try {
    stat = await fsp.stat(absolutePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) {
    return null;
  }

  let loaded;
  try {
    loaded = await readTextFile(context, config, absolutePath, stat);
  } catch {
    return null;
  }
  const lines = splitLines(loaded.text);
  const window = args.readLineWindow ?? config.scout.readLineWindow;
  const center = Math.max(1, candidate.line || candidate.minLine || 1);
  const startLine = Math.max(1, Math.min(candidate.minLine ?? center, center - Math.floor(window / 2)));
  const endLine = Math.min(lines.length, Math.max(candidate.maxLine ?? center, startLine + window - 1));
  return {
    path: candidate.path,
    startLine,
    endLine,
    totalLines: lines.length,
    score: Math.round(candidate.score * 1000) / 1000,
    reason: candidate.reasons.join("; "),
    focus: candidate.focus,
    snippets: {
      item: candidate.snippets
    },
    content: numberedLines(lines, startLine, endLine),
    truncated: endLine < lines.length
  };
}

function projectScoutSearchRun(run) {
  return {
    query: run.query,
    resultCount: run.stats.resultCount,
    engines: run.stats.engines,
    warnings: run.warnings
  };
}

function unique(values) {
  return [...new Set(values)];
}

module.exports = {
  scoutWorkspace
};
