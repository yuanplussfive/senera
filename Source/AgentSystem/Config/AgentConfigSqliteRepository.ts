import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";

const SchemaVersion = "agent-config-sqlite-v1";

export interface AgentConfigRevisionRecord {
  revision: number;
  config: AgentSystemConfig;
  source: "seed" | "json_import" | "ui_update" | "api_update";
  createdAt: string;
}

export interface AgentConfigWriteInput {
  config: AgentSystemConfig;
  source: AgentConfigRevisionRecord["source"];
  createdAt?: string;
}

interface ConfigRevisionRow {
  revision: number;
  config_json: string;
  source: AgentConfigRevisionRecord["source"];
  created_at: string;
}

export class AgentConfigSqliteRepository {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    configureConfigDatabase(this.db);
    installConfigSchema(this.db);
  }

  latestRevision(): AgentConfigRevisionRecord | undefined {
    const row = this.db.prepare([
      "SELECT revision, config_json, source, created_at",
      "FROM config_revisions",
      "ORDER BY revision DESC",
      "LIMIT 1",
    ].join(" ")).get() as ConfigRevisionRow | undefined;
    return row ? rowToRevision(row) : undefined;
  }

  appendRevision(input: AgentConfigWriteInput): AgentConfigRevisionRecord {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const insert = this.db.transaction(() => {
      const nextRevision = this.nextRevision();
      this.db.prepare([
        "INSERT INTO config_revisions",
        "(revision, config_json, source, created_at)",
        "VALUES (@revision, @config_json, @source, @created_at)",
      ].join(" ")).run({
        revision: nextRevision,
        config_json: JSON.stringify(input.config),
        source: input.source,
        created_at: createdAt,
      });
      return nextRevision;
    });

    const revision = insert();
    return {
      revision,
      config: input.config,
      source: input.source,
      createdAt,
    };
  }

  close(): void {
    try {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      this.db.close();
    }
  }

  private nextRevision(): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM config_revisions")
      .get() as { revision: number };
    return row.revision;
  }
}

function configureConfigDatabase(db: Database.Database): void {
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
}

function installConfigSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config_revisions (
      revision INTEGER PRIMARY KEY,
      config_json TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  db.prepare([
    "INSERT INTO config_metadata (key, value)",
    "VALUES ('schema_version', @schemaVersion)",
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ].join(" ")).run({ schemaVersion: SchemaVersion });
}

function rowToRevision(row: ConfigRevisionRow): AgentConfigRevisionRecord {
  return {
    revision: row.revision,
    config: JSON.parse(row.config_json) as AgentSystemConfig,
    source: row.source,
    createdAt: row.created_at,
  };
}
