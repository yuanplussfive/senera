"use strict";

const { focusList, focusSummary } = require("./Focus.js");

function mergeSearchResults(results, maxResults, config) {
  const byKey = new Map();
  for (const result of results) {
    const key = resultKey(result);
    const weighted = {
      ...result,
      score: result.score * weightFor(config, result.source)
    };
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, weighted);
      continue;
    }
    byKey.set(key, {
      ...existing,
      source: "combined",
      score: existing.score + weighted.score,
      matches: {
        item: [...new Set([...existing.matches.item, ...weighted.matches.item])]
      },
      reason: `${existing.reason}; ${weighted.reason}`,
      focus: focusList(existing.focus, weighted.focus),
      focusSummary: focusSummary(focusList(existing.focus, weighted.focus))
    });
  }

  return [...byKey.values()]
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || left.line - right.line)
    .slice(0, maxResults)
    .map((result) => ({
      ...result,
      score: Math.round(result.score * 1000) / 1000
    }));
}

function resultKey(result) {
  return `${result.path}:${result.line}`;
}

function weightFor(config, source) {
  return Number(config.search.weights[source] ?? 1);
}

module.exports = {
  mergeSearchResults
};
