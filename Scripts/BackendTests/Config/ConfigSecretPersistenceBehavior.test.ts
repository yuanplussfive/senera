import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { AgentConfigService } from "../../../Source/AgentSystem/Config/AgentConfigService.js";
import { AgentConfigSecretCodec } from "../../../Source/AgentSystem/Config/AgentConfigSecretProtection.js";
import { AgentConfigSqliteRepository } from "../../../Source/AgentSystem/Config/AgentConfigSqliteRepository.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];
const sqliteAvailable = canOpenNativeSqlite();

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("configuration secret persistence", () => {
  it("rejects encrypted provider credentials when the protection key does not match", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-authentication");
    temporaryDirectories.push(workspaceRoot);
    const protectedConfig = testCodec(workspaceRoot).protectConfig(configWithSecret("authenticated-secret"));
    const wrongCodec = new AgentConfigSecretCodec({ workspaceRoot, key: Buffer.alloc(32, 9) });

    expect(() => wrongCodec.revealConfig(protectedConfig)).toThrow(/Unable to decrypt API key for provider custom/);
  });

  it("does not create a replacement key when an encrypted config has lost its original key", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-missing-key");
    temporaryDirectories.push(workspaceRoot);
    const protectedConfig = testCodec(workspaceRoot).protectConfig(configWithSecret("unrecoverable-secret"));
    const codecWithoutKey = new AgentConfigSecretCodec({ workspaceRoot, environment: {} });

    expect(() => codecWithoutKey.revealConfig(protectedConfig)).toThrow(/Configuration secret key is missing/);
    expect(fs.existsSync(codecWithoutKey.keyPath)).toBe(false);
  });

  it("encrypts plaintext JSON configs and migration backups while keeping snapshots usable", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-json");
    temporaryDirectories.push(workspaceRoot);
    const configPath = path.join(workspaceRoot, "senera.config.json");
    const secret = "json-provider-secret";
    fs.writeFileSync(configPath, `${JSON.stringify(configWithSecret(secret, false), null, 2)}\n`, "utf8");
    const codec = testCodec(workspaceRoot);

    const service = new AgentConfigService({
      workspaceRoot,
      source: { kind: "json", configPath },
      secretCodec: codec,
    });
    expect(service.snapshot().value.ModelProviderEndpoints?.[0]?.ApiKey).toBe(secret);
    service.close();

    expect(readText(configPath)).not.toContain(secret);
    expect(readText(configPath)).toContain("senera:secret:v1:");
    const backupPath = `${configPath}.v0.bak`;
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(readText(backupPath)).not.toContain(secret);
    expect(readText(backupPath)).toContain("senera:secret:v1:");

    const reloaded = new AgentConfigService({
      workspaceRoot,
      source: { kind: "json", configPath },
      secretCodec: codec,
    });
    expect(reloaded.snapshot().value.ModelProviderEndpoints?.[0]?.ApiKey).toBe(secret);
    reloaded.close();
  });

  it.skipIf(!sqliteAvailable)("rewrites every legacy SQLite revision and removes plaintext from database pages", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-sqlite");
    temporaryDirectories.push(workspaceRoot);
    const databasePath = path.join(workspaceRoot, ".senera", "Config.sqlite");
    const codec = testCodec(workspaceRoot);
    const secrets = ["sqlite-legacy-secret-one", "sqlite-legacy-secret-two"];

    const seeded = new AgentConfigSqliteRepository(databasePath, { secretCodec: codec });
    seeded.appendRevision({ config: configWithSecret(secrets[0]), source: "seed" });
    seeded.appendRevision({ config: configWithSecret(secrets[1]), source: "ui_update" });
    seeded.close();

    const legacyDatabase = new Database(databasePath);
    const update = legacyDatabase.prepare("UPDATE config_revisions SET config_json = ? WHERE revision = ?");
    update.run(JSON.stringify(configWithSecret(secrets[0])), 1);
    update.run(JSON.stringify(configWithSecret(secrets[1])), 2);
    legacyDatabase.close();

    const migrated = new AgentConfigSqliteRepository(databasePath, { secretCodec: codec });
    expect(migrated.latestRevision()?.config.ModelProviderEndpoints?.[0]?.ApiKey).toBe(secrets[1]);
    migrated.close();

    const inspected = new Database(databasePath, { readonly: true });
    const rows = inspected.prepare("SELECT config_json FROM config_revisions ORDER BY revision").all() as Array<{
      config_json: string;
    }>;
    inspected.close();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.config_json).toContain("senera:secret:v1:");
      for (const secret of secrets) expect(row.config_json).not.toContain(secret);
    }

    const databaseBytes = fs.readFileSync(databasePath);
    for (const secret of secrets) {
      expect(databaseBytes.includes(Buffer.from(secret, "utf8"))).toBe(false);
    }
  });
});

function testCodec(workspaceRoot: string): AgentConfigSecretCodec {
  return new AgentConfigSecretCodec({ workspaceRoot, key: Buffer.alloc(32, 7) });
}

function configWithSecret(secret: string, currentVersion = true): AgentSystemConfig {
  return {
    ...(currentVersion ? { ConfigVersion: CurrentAgentConfigVersion } : {}),
    ConfigStore: { Enabled: false },
    ModelProviderEndpoints: [
      {
        Id: "custom",
        BaseUrl: "https://custom.example.test/v1",
        ApiKey: secret,
      },
    ],
    ModelProviders: [
      {
        Id: "custom/chat",
        ProviderId: "custom",
        Endpoint: "Responses",
        Model: "chat",
      },
    ],
    DefaultModelProviderId: "custom/chat",
  };
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function canOpenNativeSqlite(): boolean {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch {
    return false;
  }
}
