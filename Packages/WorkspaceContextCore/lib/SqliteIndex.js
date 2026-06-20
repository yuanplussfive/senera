"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const Database = require("better-sqlite3");
const { analyzeFile } = require("./Analyzer.js");
const { resolvePluginPath, toWorkspacePath } = require("./Context.js");
const { walkFiles } = require("./Discovery.js");
const { compileFtsQuery, likePattern } = require("./FtsQuery.js");
const { focusList, focusSummary } = require("./Focus.js");
const { readTextFile, splitLines } = require("./TextFile.js");

const SchemaVersion = "workspace-context-sqlite-v1";

async function refreshWorkspaceIndex(context, config, prepared, options = {}) {
  const startedAt = Date.now();
  const index = await openWorkspaceIndex(context, config);
  const signature = indexSignature(context, config, prepared);
  const force = Boolean(options.force) || readMeta(index.db, "signature") !== signature;

  if (force) {
    clearIndex(index.db);
  }

  let indexedFiles = 0;
  let unchangedFiles = 0;
  let skippedFiles = 0;
  let discoveredFiles = 0;
  let capped = false;
  const seenPaths = new Set();

  for await (const filePath of walkFiles(context, config, prepared.roots, prepared.exclude)) {
    if (discoveredFiles >= config.max_index_files) {
      skippedFiles += 1;
      capped = true;
      continue;
    }
    discoveredFiles += 1;

    const relativePath = toWorkspacePath(context, filePath);
    seenPaths.add(relativePath);

    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      skippedFiles += 1;
      continue;
    }

    if (stat.size > config.maxFileBytes) {
      skippedFiles += 1;
      continue;
    }

    const existing = index.statements.fileByPath.get(relativePath);
    if (!force && existing && sameFileStat(existing, stat)) {
      unchangedFiles += 1;
      continue;
    }

    try {
      const loaded = await readTextFile(context, config, filePath, stat);
      const analyzed = analyzeFile(context, config, filePath, loaded.text);
      indexFile(index.db, {
        path: relativePath,
        absolutePath: filePath,
        size: loaded.size,
        mtimeMs: loaded.mtimeMs,
        hash: loaded.hash,
        encoding: loaded.encoding,
        language: analyzed.language,
        analyzer: analyzed.analyzer,
        lineCount: splitLines(loaded.text).length,
        chunks: analyzed.chunks,
        symbols: analyzed.symbols
      });
      indexedFiles += 1;
    } catch {
      skippedFiles += 1;
    }
  }

  if (!capped) {
    removeMissingFiles(index.db, seenPaths);
  }

  writeMeta(index.db, "signature", signature);
  writeMeta(index.db, "updatedAt", new Date().toISOString());

  const counts = readCounts(index.db);
  return {
    workspaceRoot: context.workspaceRoot,
    indexedFiles: counts.files,
    indexedDocuments: counts.chunks,
    indexedSymbols: counts.symbols,
    changedFiles: indexedFiles,
    unchangedFiles,
    skippedFiles,
    stateFile: index.path,
    warnings: {
      item: prepared.warnings
    },
    availableRoots: {
      item: []
    },
    elapsedMs: Date.now() - startedAt
  };
}

async function ensureWorkspaceIndex(context, config, prepared) {
  const index = await openWorkspaceIndex(context, config);
  const signature = indexSignature(context, config, prepared);
  const counts = readCounts(index.db);
  if (readMeta(index.db, "signature") !== signature || counts.files === 0) {
    await refreshWorkspaceIndex(context, config, prepared, { force: true });
  }
}

async function searchIndexedDocuments(context, config, prepared, query, options = {}) {
  await ensureWorkspaceIndex(context, config, prepared);
  const index = await openWorkspaceIndex(context, config);
  const ftsQuery = compileFtsQuery(query, config);
  const collectLimit = Math.max(1, options.maxResults * config.search.collectMultiplier);
  const results = [];

  if (ftsQuery && config.search.engines.includes("sqlite_fts")) {
    results.push(...runChunkFtsSearch(index.db, config, ftsQuery, collectLimit));
  }
  if (config.search.engines.includes("sqlite_trigram")) {
    results.push(...runChunkTrigramSearch(index.db, config, query, collectLimit));
  }
  if (config.search.engines.includes("path")) {
    results.push(...runPathSearch(index.db, config, query, collectLimit));
  }

  return {
    results: mergeResults(results, options.maxResults, config),
    stats: readCounts(index.db),
    stateFile: index.path
  };
}

async function searchIndexedSymbols(context, config, prepared, query, options = {}) {
  await ensureWorkspaceIndex(context, config, prepared);
  const index = await openWorkspaceIndex(context, config);
  const ftsQuery = compileFtsQuery(query, config);
  const collectLimit = Math.max(1, options.maxResults * config.search.collectMultiplier);
  const allowedKinds = new Set(options.kinds ?? []);
  const results = [];

  if (ftsQuery) {
    results.push(...runSymbolFtsSearch(index.db, config, ftsQuery, collectLimit));
  }
  results.push(...runSymbolLikeSearch(index.db, config, query, collectLimit));

  const symbols = mergeSymbols(results, options.maxResults, config)
    .filter((symbol) => allowedKinds.size === 0 || allowedKinds.has(symbol.kind));

  return {
    symbols,
    stats: readCounts(index.db),
    stateFile: index.path
  };
}

async function openWorkspaceIndex(context, config) {
  const stateDir = resolvePluginPath(context, config.state_dir);
  await fsp.mkdir(stateDir, { recursive: true });
  const databasePath = path.join(stateDir, config.index.database);
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  ensureSchema(db, config);
  return {
    db,
    path: databasePath,
    statements: {
      fileByPath: db.prepare("SELECT path, size, mtimeMs FROM files WHERE path = ?")
    }
  };
}

function ensureSchema(db, config) {
  const current = readMeta(db, "schemaVersion");
  const tokenizerSignature = JSON.stringify(config.index);
  const currentTokenizerSignature = readMeta(db, "tokenizerSignature");
  if (current && (current !== SchemaVersion || currentTokenizerSignature !== tokenizerSignature)) {
    dropSchema(db);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      absolutePath TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtimeMs REAL NOT NULL,
      hash TEXT NOT NULL,
      encoding TEXT NOT NULL,
      language TEXT NOT NULL,
      analyzer TEXT NOT NULL,
      lineCount INTEGER NOT NULL,
      indexedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      startLine INTEGER NOT NULL,
      endLine INTEGER NOT NULL,
      text TEXT NOT NULL,
      analyzer TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS symbols (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      line INTEGER NOT NULL,
      startLine INTEGER NOT NULL,
      endLine INTEGER NOT NULL,
      signature TEXT NOT NULL,
      exported INTEGER NOT NULL,
      imports TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chunks_path_idx ON chunks(path);
    CREATE INDEX IF NOT EXISTS symbols_path_idx ON symbols(path);
    CREATE INDEX IF NOT EXISTS symbols_name_idx ON symbols(name);
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
      chunkId UNINDEXED,
      path,
      text,
      analyzer UNINDEXED,
      tokenize='${escapeSqlLiteral(config.index.tokenizer)}'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_trigram USING fts5(
      chunkId UNINDEXED,
      path,
      text,
      analyzer UNINDEXED,
      tokenize='${escapeSqlLiteral(config.index.trigramTokenizer)}'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS symbol_fts USING fts5(
      symbolId UNINDEXED,
      name,
      kind,
      path,
      signature,
      tokenize='${escapeSqlLiteral(config.index.tokenizer)}'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS path_fts USING fts5(
      path UNINDEXED,
      value,
      tokenize='${escapeSqlLiteral(config.index.trigramTokenizer)}'
    );
  `);

  writeMeta(db, "schemaVersion", SchemaVersion);
  writeMeta(db, "tokenizerSignature", tokenizerSignature);
}

function dropSchema(db) {
  db.exec(`
    DROP TABLE IF EXISTS chunk_fts;
    DROP TABLE IF EXISTS chunk_trigram;
    DROP TABLE IF EXISTS symbol_fts;
    DROP TABLE IF EXISTS path_fts;
    DROP TABLE IF EXISTS files;
    DROP TABLE IF EXISTS chunks;
    DROP TABLE IF EXISTS symbols;
    DROP TABLE IF EXISTS meta;
  `);
}

function clearIndex(db) {
  db.exec(`
    DELETE FROM chunk_fts;
    DELETE FROM chunk_trigram;
    DELETE FROM symbol_fts;
    DELETE FROM path_fts;
    DELETE FROM files;
    DELETE FROM chunks;
    DELETE FROM symbols;
  `);
}

const indexFile = transaction((db, file) => {
  deleteFile(db, file.path);
  db.prepare(`
    INSERT INTO files(path, absolutePath, size, mtimeMs, hash, encoding, language, analyzer, lineCount, indexedAt)
    VALUES(@path, @absolutePath, @size, @mtimeMs, @hash, @encoding, @language, @analyzer, @lineCount, @indexedAt)
  `).run({
    ...file,
    indexedAt: new Date().toISOString()
  });

  const insertChunk = db.prepare(`
    INSERT INTO chunks(id, path, startLine, endLine, text, analyzer)
    VALUES(@id, @path, @startLine, @endLine, @text, @analyzer)
  `);
  const insertChunkFts = db.prepare("INSERT INTO chunk_fts(chunkId, path, text, analyzer) VALUES(?, ?, ?, ?)");
  const insertChunkTrigram = db.prepare("INSERT INTO chunk_trigram(chunkId, path, text, analyzer) VALUES(?, ?, ?, ?)");
  for (const chunk of file.chunks) {
    insertChunk.run(chunk);
    insertChunkFts.run(chunk.id, chunk.path, chunk.text, chunk.analyzer);
    insertChunkTrigram.run(chunk.id, chunk.path, chunk.text, chunk.analyzer);
  }

  const insertSymbol = db.prepare(`
    INSERT INTO symbols(id, name, kind, path, line, startLine, endLine, signature, exported, imports)
    VALUES(@id, @name, @kind, @path, @line, @startLine, @endLine, @signature, @exported, @imports)
  `);
  const insertSymbolFts = db.prepare("INSERT INTO symbol_fts(symbolId, name, kind, path, signature) VALUES(?, ?, ?, ?, ?)");
  for (const symbol of file.symbols) {
    insertSymbol.run({
      ...symbol,
      exported: symbol.exported ? 1 : 0,
      imports: JSON.stringify(symbol.imports)
    });
    insertSymbolFts.run(symbol.id, symbol.name, symbol.kind, symbol.path, symbol.signature);
  }

  db.prepare("INSERT INTO path_fts(path, value) VALUES(?, ?)").run(file.path, file.path);
});

function deleteFile(db, filePath) {
  db.prepare("DELETE FROM chunk_fts WHERE chunkId IN (SELECT id FROM chunks WHERE path = ?)").run(filePath);
  db.prepare("DELETE FROM chunk_trigram WHERE chunkId IN (SELECT id FROM chunks WHERE path = ?)").run(filePath);
  db.prepare("DELETE FROM symbol_fts WHERE symbolId IN (SELECT id FROM symbols WHERE path = ?)").run(filePath);
  db.prepare("DELETE FROM path_fts WHERE path = ?").run(filePath);
  db.prepare("DELETE FROM chunks WHERE path = ?").run(filePath);
  db.prepare("DELETE FROM symbols WHERE path = ?").run(filePath);
  db.prepare("DELETE FROM files WHERE path = ?").run(filePath);
}

function removeMissingFiles(db, seenPaths) {
  const rows = db.prepare("SELECT path FROM files").all();
  const remove = db.transaction((paths) => {
    for (const filePath of paths) {
      deleteFile(db, filePath);
    }
  });
  remove(rows.map((row) => row.path).filter((filePath) => !seenPaths.has(filePath)));
}

function runChunkFtsSearch(db, config, ftsQuery, limit) {
  return db.prepare(`
    SELECT c.id, c.path, c.startLine, c.endLine, c.text, c.analyzer, bm25(chunk_fts) AS rank
    FROM chunk_fts
    JOIN chunks c ON c.id = chunk_fts.chunkId
    WHERE chunk_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(ftsQuery, limit).map((row) => chunkResult(row, "sqlite_fts", scoreFromRank(row.rank, config, "sqlite_fts"), config.search.reasons.sqlite_fts, config));
}

function runChunkTrigramSearch(db, config, query, limit) {
  const pattern = likePattern(query);
  return db.prepare(`
    SELECT c.id, c.path, c.startLine, c.endLine, c.text, c.analyzer
    FROM chunk_trigram
    JOIN chunks c ON c.id = chunk_trigram.chunkId
    WHERE chunk_trigram.text LIKE ? ESCAPE '\\' OR chunk_trigram.path LIKE ? ESCAPE '\\'
    LIMIT ?
  `).all(pattern, pattern, limit).map((row) => chunkResult(row, "sqlite_trigram", weightFor(config, "sqlite_trigram"), config.search.reasons.sqlite_trigram, config));
}

function runPathSearch(db, config, query, limit) {
  const pattern = likePattern(query);
  return db.prepare(`
    SELECT f.path, f.lineCount
    FROM path_fts
    JOIN files f ON f.path = path_fts.path
    WHERE path_fts.value LIKE ? ESCAPE '\\'
    LIMIT ?
  `).all(pattern, limit).map((row) => ({
    path: row.path,
    startLine: 1,
    endLine: Math.min(row.lineCount, config.search.snippetMaxLines),
    line: 1,
    snippet: row.path,
    score: weightFor(config, "path"),
    source: "path",
    matches: {
      item: ["path"]
    },
    reason: config.search.reasons.path
  }));
}

function runSymbolFtsSearch(db, config, ftsQuery, limit) {
  return db.prepare(`
    SELECT s.*, bm25(symbol_fts) AS rank
    FROM symbol_fts
    JOIN symbols s ON s.id = symbol_fts.symbolId
    WHERE symbol_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(ftsQuery, limit).map((row) => symbolResult(row, "symbol", scoreFromRank(row.rank, config, "symbol"), config.search.reasons.symbol));
}

function runSymbolLikeSearch(db, config, query, limit) {
  const pattern = likePattern(query);
  return db.prepare(`
    SELECT s.*
    FROM symbols s
    WHERE s.name LIKE ? ESCAPE '\\' OR s.path LIKE ? ESCAPE '\\'
    LIMIT ?
  `).all(pattern, pattern, limit).map((row) => symbolResult(row, "symbol", weightFor(config, "symbol"), config.search.reasons.symbol));
}

function chunkResult(row, source, score, reason, config) {
  return {
    path: row.path,
    startLine: row.startLine,
    endLine: row.endLine,
    line: row.startLine,
    snippet: numberSnippet(row.text, row.startLine, config.search.snippetMaxLines),
    score,
    source,
    matches: {
      item: [source]
    },
    reason
  };
}

function symbolResult(row, source, score, reason) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    path: row.path,
    line: row.line,
    startLine: row.startLine,
    endLine: row.endLine,
    signature: row.signature,
    exported: Boolean(row.exported),
    imports: parseImports(row.imports),
    score,
    source,
    reason
  };
}

function mergeResults(results, maxResults, config) {
  const byKey = new Map();
  for (const result of results) {
    const key = `${result.path}:${result.line}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, result);
      continue;
    }
    byKey.set(key, {
      ...existing,
      source: "combined",
      score: existing.score + result.score,
      matches: {
        item: [...new Set([...existing.matches.item, ...result.matches.item])]
      },
      reason: `${existing.reason}; ${result.reason}`,
      focus: focusList(existing.focus, result.focus),
      focusSummary: focusSummary(focusList(existing.focus, result.focus))
    });
  }
  return [...byKey.values()]
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || left.line - right.line)
    .slice(0, maxResults)
    .map((result) => ({
      ...result,
      score: roundScore(result.score)
    }));
}

function mergeSymbols(symbols, maxResults, config) {
  const byId = new Map();
  for (const symbol of symbols) {
    const existing = byId.get(symbol.id);
    byId.set(symbol.id, existing
      ? {
        ...existing,
        score: existing.score + symbol.score,
        reason: `${existing.reason}; ${symbol.reason}`
      }
      : symbol);
  }
  return [...byId.values()]
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || left.line - right.line)
    .slice(0, maxResults)
    .map((symbol) => ({
      id: symbol.id,
      name: symbol.name,
      kind: symbol.kind,
      path: symbol.path,
      line: symbol.line,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      signature: symbol.signature,
      exported: symbol.exported,
      imports: symbol.imports,
      score: roundScore(symbol.score)
    }));
}

function readCounts(db) {
  return {
    files: db.prepare("SELECT COUNT(*) AS value FROM files").get().value,
    chunks: db.prepare("SELECT COUNT(*) AS value FROM chunks").get().value,
    symbols: db.prepare("SELECT COUNT(*) AS value FROM symbols").get().value
  };
}

function readMeta(db, key) {
  try {
    return db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value;
  } catch {
    return undefined;
  }
}

function writeMeta(db, key, value) {
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)").run(key, String(value));
}

function indexSignature(context, config, prepared) {
  return JSON.stringify({
    schema: SchemaVersion,
    workspaceRoot: context.workspaceRoot,
    roots: prepared.roots.map((root) => toWorkspacePath(context, root)),
    exclude: prepared.exclude,
    maxFileMb: config.maxFileMb,
    chunking: config.chunking,
    analyzers: config.analyzers,
    index: config.index
  });
}

function sameFileStat(row, stat) {
  return Number(row.size) === Number(stat.size)
    && Math.round(Number(row.mtimeMs)) === Math.round(Number(stat.mtimeMs));
}

function transaction(fn) {
  return (db, ...args) => db.transaction(() => fn(db, ...args))();
}

function scoreFromRank(rank, config, engine) {
  return weightFor(config, engine) + 1 / (1 + Math.abs(Number(rank)));
}

function weightFor(config, engine) {
  return Number(config.search.weights[engine] ?? 1);
}

function roundScore(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function numberSnippet(text, startLine, maxLines) {
  return String(text)
    .split(/\r?\n/)
    .slice(0, maxLines)
    .map((line, index) => `${startLine + index}: ${line}`)
    .join("\n");
}

function parseImports(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && Array.isArray(parsed.item)
      ? parsed
      : { item: [] };
  } catch {
    return { item: [] };
  }
}

function escapeSqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

module.exports = {
  refreshWorkspaceIndex,
  searchIndexedDocuments,
  searchIndexedSymbols,
  openWorkspaceIndex,
  readCounts
};
