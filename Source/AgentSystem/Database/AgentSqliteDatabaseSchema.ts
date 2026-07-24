import type Database from "better-sqlite3";

export const AgentSqliteContractMetadataTable = "__senera_database_contract";
export const AgentSqliteMigrationLedgerTable = "__senera_schema_migrations";

const ControlTableNames = new Set([AgentSqliteContractMetadataTable, AgentSqliteMigrationLedgerTable]);

interface SchemaObjectRow {
  readonly type: "index" | "table" | "trigger" | "view";
  readonly name: string;
  readonly sql: string;
}

/** Produces the stable, data-free schema fingerprint stored in contract snapshots. */
export function snapshotAgentSqliteSchema(database: Database.Database): string {
  const rows = database
    .prepare<[], SchemaObjectRow>(
      `
      SELECT type, name, sql
      FROM sqlite_master
      WHERE type IN ('table', 'index', 'trigger', 'view')
        AND name NOT LIKE 'sqlite_%'
        AND sql IS NOT NULL
      ORDER BY
        CASE type
          WHEN 'table' THEN 1
          WHEN 'view' THEN 2
          WHEN 'trigger' THEN 3
          WHEN 'index' THEN 4
          ELSE 5
        END,
        name
    `,
    )
    .all()
    .filter((row) => !ControlTableNames.has(row.name));

  return rows.map(({ type, name, sql }) => `-- ${type}: ${name}\n${canonicalizeSql(sql)};\n`).join("\n");
}

export function isAgentSqliteSchemaEmpty(database: Database.Database): boolean {
  return snapshotAgentSqliteSchema(database).length === 0;
}

/**
 * sqlite_master retains the original whitespace of a DDL statement. Contract
 * matching must instead use its lexical form, otherwise an equivalent schema
 * created by a previous runtime would be rejected merely for formatting.
 */
function canonicalizeSql(sql: string): string {
  const tokens: string[] = [];
  let index = 0;
  while (index < sql.length) {
    const character = sql[index];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "-" && sql[index + 1] === "-") {
      index = skipLineComment(sql, index + 2);
      continue;
    }
    if (character === "/" && sql[index + 1] === "*") {
      index = skipBlockComment(sql, index + 2);
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      const quoted = readQuotedToken(sql, index, character);
      tokens.push(quoted.token);
      index = quoted.nextIndex;
      continue;
    }
    if (character === "[") {
      const closing = sql.indexOf("]", index + 1);
      if (closing < 0) throw new Error("SQLite schema contains an unterminated bracket identifier.");
      tokens.push(sql.slice(index, closing + 1));
      index = closing + 1;
      continue;
    }
    if (/[A-Za-z_]/u.test(character)) {
      const nextIndex = readWhile(sql, index + 1, /[A-Za-z0-9_$]/u);
      tokens.push(sql.slice(index, nextIndex).toLowerCase());
      index = nextIndex;
      continue;
    }
    if (/[0-9]/u.test(character)) {
      const nextIndex = readWhile(sql, index + 1, /[0-9A-Za-z_.+-]/u);
      tokens.push(sql.slice(index, nextIndex));
      index = nextIndex;
      continue;
    }
    const operator = ["->>", "||", "<<", ">>", "<=", ">=", "<>", "!=", "==", "->"].find((candidate) =>
      sql.startsWith(candidate, index),
    );
    tokens.push(operator ?? character);
    index += operator?.length ?? 1;
  }
  return tokens.join(" ");
}

function readQuotedToken(sql: string, start: number, quote: string): { token: string; nextIndex: number } {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] !== quote) {
      index += 1;
      continue;
    }
    if (sql[index + 1] === quote) {
      index += 2;
      continue;
    }
    return { token: sql.slice(start, index + 1), nextIndex: index + 1 };
  }
  throw new Error("SQLite schema contains an unterminated quoted token.");
}

function readWhile(sql: string, start: number, matcher: RegExp): number {
  let index = start;
  while (index < sql.length && matcher.test(sql[index])) index += 1;
  return index;
}

function skipLineComment(sql: string, start: number): number {
  const newline = sql.indexOf("\n", start);
  return newline < 0 ? sql.length : newline + 1;
}

function skipBlockComment(sql: string, start: number): number {
  const closing = sql.indexOf("*/", start);
  if (closing < 0) throw new Error("SQLite schema contains an unterminated block comment.");
  return closing + 2;
}
