"use strict";

const path = require("node:path");
const fuzzysort = require("fuzzysort");
const { toWorkspacePath } = require("./Context.js");
const { walkPathEntries } = require("./Discovery.js");
const { focusFromIndices, focusList, focusSummary } = require("./Focus.js");

async function searchFuzzyPaths(context, config, prepared, query, options = {}) {
  const maxResults = Math.max(1, options.maxResults ?? prepared.maxResults);
  const collectLimit = Math.max(1, maxResults * config.search.collectMultiplier);
  const candidates = [];
  const stats = {
    scanned: 0,
    matched: 0,
    capped: false
  };

  for await (const entry of walkPathEntries(context, config, prepared.roots, prepared.exclude, {
    includeDirectories: config.pathFuzzy.includeDirectories
  })) {
    if (stats.scanned >= config.pathFuzzy.maxCandidates) {
      stats.capped = true;
      break;
    }
    stats.scanned += 1;

    const candidate = createCandidate(context, entry);
    const match = bestTargetMatch(config, query, candidate);
    if (!match) {
      continue;
    }

    stats.matched += 1;
    candidates.push(toSearchResult(config, query, candidate, match));
  }

  const results = candidates
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, collectLimit)
    .slice(0, maxResults);

  return {
    results,
    stats
  };
}

function createCandidate(context, entry) {
  const workspacePath = toWorkspacePath(context, entry.path);
  return {
    path: workspacePath,
    fileName: path.basename(workspacePath),
    matchType: entry.kind
  };
}

function bestTargetMatch(config, query, candidate) {
  let best;
  for (const target of config.pathFuzzy.targets) {
    const value = targetValue(candidate, target);
    if (!value) {
      continue;
    }
    const result = fuzzysort.single(query, value);
    if (!result || result.score < config.pathFuzzy.threshold) {
      continue;
    }
    const score = result.score * targetWeight(config, target);
    if (!best || score > best.score) {
      best = {
        target,
        value,
        result,
        score
      };
    }
  }
  return best;
}

function targetValue(candidate, target) {
  if (target === "file_name") {
    return candidate.fileName;
  }
  if (target === "path") {
    return candidate.path;
  }
  return undefined;
}

function targetWeight(config, target) {
  return Number(config.pathFuzzy.weights[target] ?? 1);
}

function toSearchResult(config, query, candidate, match) {
  const focus = focusList(focusFromIndices({
    target: match.target,
    query,
    value: match.value,
    indices: match.result.indexes
  }));

  return {
    path: candidate.path,
    startLine: 1,
    endLine: 1,
    line: 1,
    snippet: candidate.path,
    score: match.score,
    source: "path_fuzzy",
    matches: {
      item: ["path_fuzzy", candidate.matchType, match.target]
    },
    reason: config.search.reasons.path_fuzzy,
    focus,
    focusSummary: focusSummary(focus)
  };
}

module.exports = {
  searchFuzzyPaths
};
