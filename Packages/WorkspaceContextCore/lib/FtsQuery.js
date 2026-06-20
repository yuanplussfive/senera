"use strict";

function compileFtsQuery(text, config) {
  const terms = segmentTerms(text);
  if (terms.length === 0) {
    return undefined;
  }
  return terms.map(quoteFtsTerm).join(` ${config.search.termOperator} `);
}

function segmentTerms(text) {
  const value = String(text).trim();
  if (!value) {
    return [];
  }

  if (typeof Intl.Segmenter !== "function") {
    throw new Error("当前 Node.js 运行环境不支持 Intl.Segmenter，无法构建 FTS 查询。");
  }

  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  const terms = [];
  for (const segment of segmenter.segment(value)) {
    if (segment.isWordLike && String(segment.segment).trim()) {
      terms.push(String(segment.segment).trim());
    }
  }
  return unique(terms);
}

function quoteFtsTerm(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function likePattern(value) {
  return `%${String(value).replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = String(value).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(String(value));
    }
  }
  return result;
}

module.exports = {
  compileFtsQuery,
  likePattern,
  segmentTerms
};
