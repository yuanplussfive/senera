import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveAgentApplicationPaths } from "../../../Source/AgentSystem/Core/AgentApplicationPaths.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { migrateAgentWorkspaceState } from "../../../Source/AgentSystem/WorkspaceResources/AgentWorkspaceStateMigration.js";
import {
  readAgentWorkspaceStateMigrationInventory,
  removeAgentWorkspaceStateMigrationBackup,
} from "../../../Source/AgentSystem/WorkspaceResources/AgentWorkspaceStateMigrationMaintenance.js";
import {
  resolveSeneraHostedWorkspaceRuntime,
  resolveSeneraInitialWorkspaceRuntime,
} from "../../../Apps/ServerWorkspaceRuntime.js";

describe("workspace-owned state migration", () => {
  test("uses workspace-local state while retaining an explicit legacy layout", () => {
    const applicationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-application-paths-"));
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-workspace-paths-"));
    const paths = resolveAgentApplicationPaths(applicationRoot);

    expect(paths.workspaceLayout(workspaceRoot, "workspace-id").stateRoot).toBe(path.join(workspaceRoot, ".senera"));
    expect(paths.workspaceLayout(workspaceRoot, "workspace-id").userPluginsRoot).toBe(
      path.join(workspaceRoot, ".senera", "user-plugins"),
    );
    expect(paths.workspaceLayout(workspaceRoot, "workspace-id").projectPluginsRoot).toBe(
      path.join(workspaceRoot, ".senera", "plugins"),
    );
    expect(paths.workspaceLayout(workspaceRoot, "workspace-id").userPluginsRoot).not.toBe(
      paths.workspaceLayout(workspaceRoot, "workspace-id").projectPluginsRoot,
    );
    const otherWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-workspace-paths-other-"));
    expect(paths.workspaceLayout(otherWorkspaceRoot, "other-workspace-id").userPluginsRoot).not.toBe(
      paths.workspaceLayout(workspaceRoot, "workspace-id").userPluginsRoot,
    );
    expect(paths.legacyWorkspaceLayout(workspaceRoot, "workspace-id").stateRoot).toBe(
      path.join(applicationRoot, ".senera", "workspaces", "workspace-id"),
    );
    expect(paths.legacyWorkspaceLayout(workspaceRoot, "workspace-id").userPluginsRoot).toBe(
      path.join(applicationRoot, ".senera", "workspaces", "workspace-id", "plugins"),
    );
  });

  test("imports legacy host state while preserving workspace-owned data", () => {
    const applicationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-迁移 application-"));
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-迁移 workspace-"));
    const paths = resolveAgentApplicationPaths(applicationRoot);
    const source = paths.legacyWorkspaceLayout(workspaceRoot, "workspace-id");
    const target = paths.workspaceLayout(workspaceRoot, "workspace-id");
    const applicationLayout = resolveAgentWorkspaceLayout(applicationRoot);
    const legacyConfigPath = path.join(applicationRoot, "senera.config.json");
    const targetConfigPath = path.join(workspaceRoot, "senera.config.json");

    fs.mkdirSync(path.dirname(source.databases.sessions), { recursive: true });
    fs.writeFileSync(source.databases.sessions, "legacy-session");
    fs.mkdirSync(path.dirname(source.piSessionsRoot), { recursive: true });
    fs.mkdirSync(source.piSessionsRoot, { recursive: true });
    fs.writeFileSync(path.join(source.piSessionsRoot, "session.json"), "legacy-pi");
    fs.mkdirSync(source.userPluginsRoot, { recursive: true });
    fs.writeFileSync(path.join(source.userPluginsRoot, "legacy-plugin.txt"), "legacy-user-plugin");
    fs.writeFileSync(legacyConfigPath, '{"config":"legacy"}\n');
    fs.writeFileSync(targetConfigPath, '{"config":"workspace"}\n');
    fs.mkdirSync(path.dirname(applicationLayout.configSecretKey), { recursive: true });
    fs.writeFileSync(applicationLayout.configSecretKey, "legacy-host-config-key");
    fs.mkdirSync(path.dirname(target.databases.sessions), { recursive: true });
    fs.writeFileSync(target.databases.sessions, "workspace-session");

    const result = migrateAgentWorkspaceState({
      workspaceRoot,
      workspaceId: "workspace-id",
      source,
      target,
      legacyConfigPath,
      targetConfigPath,
      additionalEntries: [{ source: applicationLayout.configSecretKey, target: target.configSecretKey }],
    });

    expect(result.status).toBe("migrated");
    if (result.status !== "migrated") throw new Error("migration did not run");
    expect(fs.readFileSync(target.databases.sessions, "utf8")).toBe("workspace-session");
    expect(fs.readFileSync(path.join(target.piSessionsRoot, "session.json"), "utf8")).toBe("legacy-pi");
    expect(fs.readFileSync(targetConfigPath, "utf8")).toContain("workspace");
    expect(fs.readFileSync(target.configSecretKey, "utf8")).toBe("legacy-host-config-key");
    expect(fs.readFileSync(path.join(target.userPluginsRoot, "legacy-plugin.txt"), "utf8")).toBe("legacy-user-plugin");
    expect(fs.existsSync(path.join(target.projectPluginsRoot, "legacy-plugin.txt"))).toBe(false);
    expect(
      JSON.parse(fs.readFileSync(path.join(target.stateRoot, "migrations", "host-state.json"), "utf8")).version,
    ).toBe(3);
    expect(fs.readFileSync(source.databases.sessions, "utf8")).toBe("legacy-session");
    expect(result.backupRoot).toBeUndefined();

    const repeated = migrateAgentWorkspaceState({
      workspaceRoot,
      workspaceId: "workspace-id",
      source,
      target,
      legacyConfigPath,
      targetConfigPath,
      additionalEntries: [{ source: applicationLayout.configSecretKey, target: target.configSecretKey }],
    });
    expect(repeated.status).toBe("already-complete");
  });

  test("skips an additional entry that already targets its own source", () => {
    const applicationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-self-entry-application-"));
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-self-entry-workspace-"));
    const paths = resolveAgentApplicationPaths(applicationRoot);
    const source = paths.legacyWorkspaceLayout(workspaceRoot, "workspace-id");
    const target = paths.workspaceLayout(workspaceRoot, "workspace-id");
    fs.mkdirSync(path.dirname(target.configSecretKey), { recursive: true });
    fs.writeFileSync(target.configSecretKey, "workspace-config-key");

    const result = migrateAgentWorkspaceState({
      workspaceRoot,
      workspaceId: "workspace-id",
      source,
      target,
      additionalEntries: [{ source: target.configSecretKey, target: target.configSecretKey }],
    });

    expect(result.status).toBe("not-needed");
    expect(fs.existsSync(path.join(target.stateRoot, "migrations"))).toBe(false);
    expect(fs.readFileSync(target.configSecretKey, "utf8")).toBe("workspace-config-key");
  });
  test("imports the former application-level plugin directory into the initial workspace only", () => {
    const applicationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-shared-plugin-application-"));
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-shared-plugin-workspace-"));
    const laterWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-shared-plugin-later-workspace-"));
    const paths = resolveAgentApplicationPaths(applicationRoot);
    const configPath = path.join(workspaceRoot, "senera.config.json");
    fs.mkdirSync(paths.legacySharedUserPluginsRoot, { recursive: true });
    fs.writeFileSync(path.join(paths.legacySharedUserPluginsRoot, "shared-plugin.txt"), "shared-user-plugin");
    fs.writeFileSync(configPath, "{}\n");

    const preparation = resolveSeneraInitialWorkspaceRuntime({
      paths,
      workspaceRoot,
      workspaceId: "workspace-id",
      resourcesRoot: applicationRoot,
      options: { configSource: { kind: "json", configPath } },
    });

    expect(preparation.workspaceLayout.userPluginsRoot).toBe(path.join(workspaceRoot, ".senera", "user-plugins"));
    expect(fs.readFileSync(path.join(preparation.workspaceLayout.userPluginsRoot, "shared-plugin.txt"), "utf8")).toBe(
      "shared-user-plugin",
    );
    expect(fs.readFileSync(path.join(paths.legacySharedUserPluginsRoot, "shared-plugin.txt"), "utf8")).toBe(
      "shared-user-plugin",
    );

    fs.writeFileSync(path.join(laterWorkspaceRoot, "senera.config.json"), "{}\n");
    resolveSeneraHostedWorkspaceRuntime({
      paths,
      workspaceRoot: laterWorkspaceRoot,
      workspaceId: "later-workspace-id",
      resourcesRoot: applicationRoot,
      configSource: { kind: "json", configPath: path.join(laterWorkspaceRoot, "senera.config.json") },
      migrateLegacyState: true,
    });
    expect(fs.existsSync(path.join(laterWorkspaceRoot, ".senera", "user-plugins", "shared-plugin.txt"))).toBe(false);
  });

  test("does not create a migration backup for a new workspace without legacy state", () => {
    const applicationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-application-empty-"));
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-workspace-empty-"));
    const paths = resolveAgentApplicationPaths(applicationRoot);
    const result = migrateAgentWorkspaceState({
      workspaceRoot,
      workspaceId: "workspace-id",
      source: paths.legacyWorkspaceLayout(workspaceRoot, "workspace-id"),
      target: paths.workspaceLayout(workspaceRoot, "workspace-id"),
    });

    expect(result.status).toBe("not-needed");
    expect(fs.existsSync(path.join(workspaceRoot, ".senera", "migrations"))).toBe(false);
  });

  test("fails loudly on a corrupt migration marker instead of repeating the import", () => {
    const applicationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-application-corrupt-"));
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-workspace-corrupt-"));
    const paths = resolveAgentApplicationPaths(applicationRoot);
    const source = paths.legacyWorkspaceLayout(workspaceRoot, "workspace-id");
    const target = paths.workspaceLayout(workspaceRoot, "workspace-id");
    fs.mkdirSync(path.dirname(source.databases.sessions), { recursive: true });
    fs.writeFileSync(source.databases.sessions, "legacy-session");
    fs.mkdirSync(path.join(target.stateRoot, "migrations"), { recursive: true });
    fs.writeFileSync(path.join(target.stateRoot, "migrations", "host-state.json"), "{ broken", "utf8");

    expect(() => migrateAgentWorkspaceState({ workspaceRoot, workspaceId: "workspace-id", source, target })).toThrow(
      /migration marker is invalid/,
    );
    expect(fs.readFileSync(source.databases.sessions, "utf8")).toBe("legacy-session");
  });

  test("exposes an auditable backup inventory and removes only a selected backup", async () => {
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-migration-maintenance-"));
    const migrationRoot = path.join(stateRoot, "migrations");
    const backupRoot = path.join(migrationRoot, "host-state", "2026-10-16T00-00-00-000Z-backup");
    const secondBackupRoot = path.join(migrationRoot, "host-state", "2026-10-16T00-00-01-000Z-backup");
    fs.mkdirSync(path.join(backupRoot, "data"), { recursive: true });
    fs.mkdirSync(path.join(secondBackupRoot, "data"), { recursive: true });
    fs.writeFileSync(path.join(backupRoot, "data", "state.db"), "old-state");
    fs.writeFileSync(path.join(secondBackupRoot, "data", "state.db"), "old-state-2");
    fs.writeFileSync(
      path.join(migrationRoot, "host-state.json"),
      JSON.stringify({
        version: 1,
        workspaceId: "workspace-id",
        sourceStateRoot: "C:/legacy",
        targetStateRoot: stateRoot,
        completedAt: new Date().toISOString(),
        backups: [path.join(backupRoot, "data"), path.join(secondBackupRoot, "data")],
      }),
    );

    const inventory = await readAgentWorkspaceStateMigrationInventory(stateRoot);
    expect(inventory.markerStatus).toBe("valid");
    expect(inventory.backups).toHaveLength(2);
    expect(inventory.backups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: path.basename(backupRoot), referencedByMarker: true }),
        expect.objectContaining({ id: path.basename(secondBackupRoot), referencedByMarker: true }),
      ]),
    );
    expect(inventory.backups.every((backup) => backup.bytes > 0)).toBe(true);

    await Promise.all([
      removeAgentWorkspaceStateMigrationBackup({ stateRoot, backupId: path.basename(backupRoot) }),
      removeAgentWorkspaceStateMigrationBackup({ stateRoot, backupId: path.basename(secondBackupRoot) }),
    ]);
    const remaining = await readAgentWorkspaceStateMigrationInventory(stateRoot);
    expect(remaining.backups).toEqual([]);
    expect(fs.existsSync(backupRoot)).toBe(false);
    expect(fs.existsSync(secondBackupRoot)).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(migrationRoot, "host-state.json"), "utf8")).backups).toEqual([]);
  });
});
