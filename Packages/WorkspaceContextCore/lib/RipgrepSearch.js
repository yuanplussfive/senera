"use strict";

const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { toWorkspacePath } = require("./Context.js");
const { focusFromByteRanges, focusList, focusSummary } = require("./Focus.js");
const { numberedLines, splitLines, trimTrailingLineBreak } = require("./TextFile.js");

async function runRipgrepSearch(context, config, options) {
  if (!options.rgPath || options.roots.length === 0) {
    return [];
  }

  const collectLimit = Math.max(1, options.maxResults * config.search.collectMultiplier);
  const args = [
    "--json",
    "--with-filename",
    "--line-number",
    "--max-count",
    String(collectLimit),
    ...options.exclude.flatMap((item) => ["--glob", `!${item}`]),
    options.caseSensitive ? "--case-sensitive" : "--ignore-case"
  ];

  if (!options.regex) {
    args.push("--fixed-strings");
  }

  args.push("--regexp", options.query);
  args.push(...options.roots);

  const output = await spawnCollect(options.rgPath, args, context.workspaceRoot, config.ripgrepTimeoutMs);
  if (output.exitCode !== 0 && output.exitCode !== 1) {
    throw new Error(`ripgrep 搜索失败：${output.stderr || output.stdout}`);
  }

  return hydrateRipgrepResults(
    context,
    config,
    parseRipgrepJsonMatches(context, output.stdout),
    options.query,
    options.contextLines,
    options.maxResults
  );
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
    const submatches = Array.isArray(event.data?.submatches) ? event.data.submatches : [];
    if (!absolutePath || !lineNumber) {
      continue;
    }
    results.push({
      path: toWorkspacePath(context, absolutePath),
      absolutePath,
      line: lineNumber,
      text: trimTrailingLineBreak(text),
      submatches: submatches.map((submatch) => ({
        start: submatch.start,
        end: submatch.end
      }))
    });
  }
  return results;
}

async function hydrateRipgrepResults(context, config, matches, query, contextLines, maxResults) {
  const byKey = new Map();
  for (const match of matches) {
    const key = `${match.path}:${match.line}`;
    if (!byKey.has(key)) {
      byKey.set(key, match);
    }
  }

  const hydrated = [];
  for (const match of byKey.values()) {
    const focus = focusList(focusFromByteRanges({
      target: "line_text",
      query,
      value: match.text,
      ranges: match.submatches
    }));
    try {
      const content = await fsp.readFile(match.absolutePath, "utf8");
      const lines = splitLines(content);
      const startLine = Math.max(1, match.line - contextLines);
      const endLine = Math.min(lines.length, match.line + contextLines);
      hydrated.push({
        path: match.path,
        startLine,
        endLine,
        line: match.line,
        snippet: numberedLines(lines, startLine, endLine),
        score: 1,
        source: "ripgrep",
        matches: {
          item: ["ripgrep"]
        },
        reason: config.search.reasons.ripgrep,
        focus,
        focusSummary: focusSummary(focus)
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
          item: ["ripgrep"]
        },
        reason: config.search.reasons.ripgrep,
        focus,
        focusSummary: focusSummary(focus)
      });
    }
  }

  return hydrated
    .sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line)
    .slice(0, maxResults);
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

module.exports = {
  runRipgrepSearch
};
