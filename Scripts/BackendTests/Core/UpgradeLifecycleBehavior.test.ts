import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { probeSeneraReadiness } from "../../../Apps/ServerRuntime.js";
import { AgentConfigService } from "../../../Source/AgentSystem/Config/AgentConfigService.js";
import { AgentConfigDatabaseContract } from "../../../Source/AgentSystem/Config/AgentConfigSqlSchema.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentUpgradeSession, rollbackAgentUpgrade } from "../../../Source/AgentSystem/Upgrade/AgentUpgradeSession.js";
import { AgentToolSearchLearningStoreContract } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemorySqlSchema.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("upgrade lifecycle", () => {
  test("backs up, validates, dry-runs, migrates, starts, and records health in order", () => {
    const workspaceRoot = temporaryWorkspace();
    const databasePath = path.join(workspaceRoot, "Config.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(AgentConfigDatabaseContract.migrations[0].sql);
    legacy
      .prepare("INSERT INTO config_revisions (revision, config_json, source, created_at) VALUES (?, ?, ?, ?)")
      .run(1, '{"Server":{"Port":8787}}', "seed", "2026-07-26T00:00:00.000Z");
    legacy.close();

    const session = upgradeSession(workspaceRoot, "sqlite-upgrade");
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath,
      contract: AgentConfigDatabaseContract,
      upgradeSession: session,
    });
    expect(kernel.connection.prepare("SELECT revision FROM config_revisions").all()).toEqual([{ revision: 1 }]);
    kernel.close();
    session.markStarting();
    session.markHealthy();

    const manifest = session.journal.readManifest("sqlite-upgrade");
    expect(manifest).toMatchObject({
      schemaVersion: 3,
      status: "healthy",
      target: { appVersion: "2.0.0", imageReference: "registry.example/senera@sha256:digest" },
      participants: [
        {
          id: "agent-config",
          kind: "sqlite",
          sourceVersion: 1,
          targetVersion: AgentConfigDatabaseContract.migrations.length,
          phase: "migrated",
        },
      ],
    });
    expect(manifest.events.map(({ phase }) => phase)).toEqual([
      "upgrade.started",
      "backup.created",
      "backup.validated",
      "migration.dry_run_passed",
      "migration.applied",
      "startup.started",
      "startup.health_passed",
    ]);
    expect(session.journal.readRuntimeMarker()).toMatchObject({
      schemaVersion: 3,
      appVersion: "2.0.0",
    });

    const backup = new Database(
      path.join(session.journal.operationRoot(manifest.upgradeId), manifest.participants[0]!.backupPath),
      { readonly: true },
    );
    expect(backup.prepare("SELECT revision FROM config_revisions").all()).toEqual([{ revision: 1 }]);
    expect(hasTable(backup, "__senera_schema_migrations")).toBe(false);
    backup.close();
  });

  test("backs up a legacy config before persisting its validated dry-run", () => {
    const workspaceRoot = temporaryWorkspace();
    const configPath = path.join(workspaceRoot, "senera.config.json");
    const legacy = currentConfig({
      ConfigVersion: 4,
      ConfigStore: { Enabled: false },
      SandboxRuntime: { Images: ["registry.example/runtime@sha256:digest"] },
    });
    const original = `${JSON.stringify(legacy, null, 2)}\n`;
    fs.writeFileSync(configPath, original, "utf8");
    const session = upgradeSession(workspaceRoot, "config-upgrade");

    const service = new AgentConfigService({
      workspaceRoot,
      source: { kind: "json", configPath },
      upgradeSession: session,
    });
    service.close();
    session.markStarting();
    session.markHealthy();

    const persisted = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
    expect(persisted.ConfigVersion).toBe(CurrentAgentConfigVersion);
    expect(persisted.SandboxRuntime).toEqual({
      Provisioning: { Kind: "Oci", Images: ["registry.example/runtime@sha256:digest"] },
    });
    const manifest = session.journal.readManifest("config-upgrade");
    expect(manifest.participants[0]).toMatchObject({ id: "agent-config-json", phase: "migrated" });
    expect(manifest.events.map(({ phase }) => phase)).toEqual([
      "upgrade.started",
      "backup.created",
      "backup.validated",
      "migration.dry_run_passed",
      "migration.applied",
      "startup.started",
      "startup.health_passed",
    ]);
    expect(
      fs.readFileSync(
        path.join(session.journal.operationRoot("config-upgrade"), "backups", "agent-config-json.json"),
        "utf8",
      ),
    ).toBe(original);
  });

  test("automatically restores backups and retains failed state when startup fails", () => {
    const workspaceRoot = temporaryWorkspace();
    const configPath = path.join(workspaceRoot, "config.json");
    fs.writeFileSync(configPath, "old-config\n", "utf8");
    const session = upgradeSession(workspaceRoot, "failed-upgrade");
    session.backupFileMigration({
      id: "agent-config-json",
      sourcePath: configPath,
      sourceVersion: 2,
      targetVersion: 3,
    });
    session.markFileMigrationDryRunPassed("agent-config-json");
    fs.writeFileSync(configPath, "new-config\n", "utf8");
    session.markFileMigrationApplied("agent-config-json");
    session.markStarting();

    session.failAndRollback(new Error("readiness probe failed"));

    expect(fs.readFileSync(configPath, "utf8")).toBe("old-config\n");
    const manifest = session.journal.readManifest("failed-upgrade");
    expect(manifest).toMatchObject({
      status: "rolled_back",
      failure: "readiness probe failed",
      participants: [{ phase: "restored" }],
    });
    expect(readRetainedFiles(session.journal.operationRoot("failed-upgrade"))).toContain("new-config\n");
  });

  test("restores a replaced derived database when a later startup phase fails", () => {
    const workspaceRoot = temporaryWorkspace();
    const databasePath = path.join(workspaceRoot, "ToolSearch.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(AgentToolSearchLearningStoreContract.legacySnapshots[0]!.snapshot);
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    legacy
      .prepare(
        "INSERT INTO tool_search_episodes (query, query_tokens, planner_tags, candidates, chosen_tools, outcome, calls, final_score, final_outcome, project_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("retained query", "[]", "[]", "[]", "[]", "success", "[]", 1, "{}", "project", 1);
    legacy.close();
    const session = upgradeSession(workspaceRoot, "derived-upgrade");

    const rebuilt = new AgentSqliteDatabaseKernel({
      databasePath,
      contract: AgentToolSearchLearningStoreContract,
      upgradeSession: session,
    });
    expect(rebuilt.connection.prepare("SELECT COUNT(*) AS count FROM tool_search_episodes").get()).toEqual({
      count: 0,
    });
    rebuilt.close();
    session.failAndRollback(new Error("startup failed after rebuild"));

    const restored = new Database(databasePath, { readonly: true });
    expect(restored.prepare("SELECT query FROM tool_search_episodes").all()).toEqual([{ query: "retained query" }]);
    expect(hasTable(restored, "__senera_schema_migrations")).toBe(false);
    expect(hasTable(restored, "schema_migrations")).toBe(true);
    restored.close();
    expect(session.journal.readManifest("derived-upgrade")).toMatchObject({
      status: "rolled_back",
      participants: [{ id: AgentToolSearchLearningStoreContract.id, dataClass: "derived", phase: "restored" }],
    });
  });

  test("supports an explicit manual rollback without deleting the replaced data", () => {
    const workspaceRoot = temporaryWorkspace();
    const dataPath = path.join(workspaceRoot, "data.json");
    fs.writeFileSync(dataPath, "version-2\n", "utf8");
    const session = upgradeSession(workspaceRoot, "manual-upgrade");
    session.backupFileMigration({ id: "agent-data", sourcePath: dataPath, sourceVersion: 2, targetVersion: 3 });
    session.markFileMigrationDryRunPassed("agent-data");
    fs.writeFileSync(dataPath, "version-3\n", "utf8");
    session.markFileMigrationApplied("agent-data");
    session.markStarting();
    session.markHealthy();

    const rolledBack = rollbackAgentUpgrade({ workspaceRoot, upgradeId: "manual-upgrade" });
    expect(rolledBack.status).toBe("rolled_back");
    expect(fs.readFileSync(dataPath, "utf8")).toBe("version-2\n");
    expect(readRetainedFiles(session.journal.operationRoot("manual-upgrade"))).toContain("version-3\n");
    expect(() => rollbackAgentUpgrade({ workspaceRoot, upgradeId: "manual-upgrade" })).toThrow(
      /cannot be rolled back manually/,
    );
  });

  test("recovers an interrupted in-progress migration on the next startup", () => {
    const workspaceRoot = temporaryWorkspace();
    const dataPath = path.join(workspaceRoot, "interrupted.json");
    fs.writeFileSync(dataPath, "before-interruption\n", "utf8");
    const interrupted = upgradeSession(workspaceRoot, "interrupted-upgrade");
    interrupted.backupFileMigration({ id: "agent-data", sourcePath: dataPath, sourceVersion: 2, targetVersion: 3 });
    interrupted.markFileMigrationDryRunPassed("agent-data");
    fs.writeFileSync(dataPath, "partially-migrated\n", "utf8");
    interrupted.markFileMigrationApplied("agent-data");
    interrupted.close();

    const restarted = upgradeSession(workspaceRoot, "next-upgrade");
    const recovered = restarted.recoverInterruptedUpgrade();

    expect(recovered).toMatchObject({ upgradeId: "interrupted-upgrade", status: "rolled_back" });
    expect(fs.readFileSync(dataPath, "utf8")).toBe("before-interruption\n");
    expect(readRetainedFiles(restarted.journal.operationRoot("interrupted-upgrade"))).toContain("partially-migrated\n");
    restarted.close();
  });

  test("requires the HTTP readiness endpoint to pass before an upgrade is healthy", async () => {
    const ready = await startHealthFixture(200);
    const unavailable = await startHealthFixture(503);
    try {
      await expect(probeSeneraReadiness(ready.url)).resolves.toBeUndefined();
      await expect(probeSeneraReadiness(unavailable.url)).rejects.toThrow("HTTP 503");
    } finally {
      await Promise.all([ready.close(), unavailable.close()]);
    }
  });
});

function upgradeSession(workspaceRoot: string, operationId: string): AgentUpgradeSession {
  return new AgentUpgradeSession({
    workspaceRoot,
    appVersion: "2.0.0",
    imageReference: "registry.example/senera@sha256:digest",
    operationId: () => operationId,
    now: () => new Date("2026-07-26T00:00:00.000Z"),
  });
}

function currentConfig(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    ...overrides,
    ModelProviderEndpoints: [{ Id: "endpoint", BaseUrl: "https://example.invalid/v1", ApiKey: "test" }],
    ModelProviders: [{ Id: "model", ProviderId: "endpoint", Endpoint: "ChatCompletions", Model: "test-model" }],
  };
}

function temporaryWorkspace(): string {
  const directory = createTemporaryDirectory("senera-upgrade");
  temporaryDirectories.push(directory);
  return directory;
}

function hasTable(database: Database.Database, tableName: string): boolean {
  return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function readRetainedFiles(operationRoot: string): string[] {
  const failedRoot = path.join(operationRoot, "failed-state");
  if (!fs.existsSync(failedRoot)) return [];
  return fs
    .readdirSync(failedRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"));
}

async function startHealthFixture(status: number): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_request, response) => {
    response.writeHead(status).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Health fixture did not bind a TCP port.");
  return {
    url: `http://127.0.0.1:${address.port}/health/ready`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
