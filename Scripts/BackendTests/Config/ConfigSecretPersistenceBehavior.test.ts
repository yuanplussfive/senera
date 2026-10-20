import { createCipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { AgentConfigService } from "../../../Source/AgentSystem/Config/AgentConfigService.js";
import { AgentConfigSecretCodec } from "../../../Source/AgentSystem/Config/AgentConfigSecretProtection.js";
import { AgentConfigSqliteRepository } from "../../../Source/AgentSystem/Config/AgentConfigSqliteRepository.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { resolveAgentApplicationPaths } from "../../../Source/AgentSystem/Core/AgentApplicationPaths.js";
import { AgentUpgradeSession } from "../../../Source/AgentSystem/Upgrade/AgentUpgradeSession.js";
import { createAgentSecretDomain } from "../../../Source/AgentSystem/Security/AgentSecretDomains.js";
import { toAgentSecretKey } from "../../../Source/AgentSystem/Security/AgentSecretKeyRing.js";
import { createSeneraWorkspaceConfigService } from "../../../Apps/ServerWorkspaceRuntime.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];
const sqliteAvailable = canOpenNativeSqlite();
const ActiveKey = Buffer.alloc(32, 7);
const OtherHostKey = Buffer.alloc(32, 9);

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("configuration secret persistence", () => {
  it("encrypts extension configuration secrets without changing neighboring values", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-extension-secret");
    temporaryDirectories.push(workspaceRoot);
    const codec = testCodec(workspaceRoot);
    const config: AgentSystemConfig = {
      ModelProviders: [],
      Extensions: {
        "web-tools": {
          Enabled: true,
          Configuration: {
            search: {
              exaApiKey: "exa-extension-secret",
              codexApiKey: "codex-extension-secret",
              endpoint: "https://mcp.exa.ai/mcp",
            },
          },
        },
      },
    };

    const protectedConfig = codec.protectConfig(config);
    const protectedSearch = protectedConfig.Extensions?.["web-tools"]?.Configuration?.search as Record<string, unknown>;
    expect(protectedSearch.exaApiKey).toMatch(/^senera:secret:v2:/u);
    expect(protectedSearch.codexApiKey).toMatch(/^senera:secret:v2:/u);
    expect(protectedSearch.endpoint).toBe("https://mcp.exa.ai/mcp");
    expect(config.Extensions?.["web-tools"]?.Configuration?.search).toMatchObject({
      exaApiKey: "exa-extension-secret",
    });

    const revealed = codec.revealConfig(protectedConfig);
    expect(revealed).toMatchObject({
      protectedSecretsFound: true,
      plaintextSecretsFound: false,
      secretsNeedRewrap: false,
    });
    expect(revealed.value).toEqual(config);
  });

  it("opens envelopes sealed by a workspace key from before the keyring and asks for a re-seal", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-legacy-envelope");
    temporaryDirectories.push(workspaceRoot);
    const legacyKey = Buffer.alloc(32, 11);
    writeLegacyKey(workspaceRoot, legacyKey);
    const secret = "legacy-workspace-secret";
    const protectedConfig = configWithSealedSecret(
      sealLegacyEnvelope(legacyKey, `senera/config/ModelProviderEndpoints/custom/ApiKey`, secret),
    );

    const revealed = testCodec(workspaceRoot).revealConfig(protectedConfig);
    expect(revealed.value.ModelProviderEndpoints?.[0]?.ApiKey).toBe(secret);
    expect(revealed.secretsNeedRewrap).toBe(true);
  });

  it("opens an envelope sealed with the flat key file from before the nested data layout", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-flat-legacy-key");
    temporaryDirectories.push(workspaceRoot);
    const legacyKey = Buffer.alloc(32, 13);
    const keyPath = resolveAgentWorkspaceLayout(workspaceRoot).legacyConfigSecretKey;
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, `${legacyKey.toString("base64url")}\n`, "utf8");

    const revealed = testCodec(workspaceRoot).revealConfig(
      configWithSealedSecret(
        sealLegacyEnvelope(legacyKey, `senera/config/ModelProviderEndpoints/custom/ApiKey`, "flat-legacy-secret"),
      ),
    );
    expect(revealed.value.ModelProviderEndpoints?.[0]?.ApiKey).toBe("flat-legacy-secret");
  });

  it("opens a secret written while another workspace was open on this host", () => {
    const firstWorkspace = createTemporaryDirectory("senera-config-secret-host-key-workspace-a");
    const secondWorkspace = createTemporaryDirectory("senera-config-secret-host-key-workspace-b");
    temporaryDirectories.push(firstWorkspace, secondWorkspace);

    const protectedConfig = new AgentConfigSecretCodec({
      workspaceRoot: firstWorkspace,
      environment: {},
    }).protectConfig(configWithSecret("host-global-secret"));
    const revealed = new AgentConfigSecretCodec({
      workspaceRoot: secondWorkspace,
      environment: {},
    }).revealConfig(protectedConfig);

    expect(revealed.value.ModelProviderEndpoints?.[0]?.ApiKey).toBe("host-global-secret");
    expect(revealed.secretsNeedRewrap).toBe(false);
  });

  it("seals with the key root the deployment resolved instead of the environment default", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-pinned-keys-root");
    const applicationRoot = createTemporaryDirectory("senera-config-secret-application-root");
    temporaryDirectories.push(workspaceRoot, applicationRoot);
    const applicationPaths = resolveAgentApplicationPaths(applicationRoot);
    const configPath = path.join(workspaceRoot, "senera.config.json");
    const secret = "pinned-root-provider-secret";
    fs.writeFileSync(configPath, `${JSON.stringify(configWithSecret(secret), null, 2)}\n`, "utf8");
    const openWithApplicationPaths = (paths: ReturnType<typeof resolveAgentApplicationPaths>): AgentConfigService =>
      createSeneraWorkspaceConfigService({
        workspaceRoot,
        configSource: { kind: "json", configPath },
        upgradeSession: new AgentUpgradeSession({ workspaceRoot, appVersion: "test" }),
        applicationPaths: paths,
      });

    openWithApplicationPaths(applicationPaths).close();

    const pinnedKey = Buffer.from(
      fs.readFileSync(path.join(applicationPaths.secretKeysRoot, "config", "secret.key"), "utf8").trim(),
      "base64url",
    );
    expect(readText(configPath)).toContain(`senera:secret:v2:${toAgentSecretKey(pinnedKey).id}.`);
    // No key may land in the user's project directory, and none may be read from the developer's host root.
    expect(fs.existsSync(resolveAgentWorkspaceLayout(workspaceRoot).configSecretKey)).toBe(false);

    const reopened = openWithApplicationPaths(applicationPaths);
    expect(reopened.snapshot().value.ModelProviderEndpoints?.[0]?.ApiKey).toBe(secret);
    expect(unresolvedProviderIds(reopened.snapshot())).toEqual([]);
    reopened.close();

    const otherApplicationRoot = createTemporaryDirectory("senera-config-secret-other-application-root");
    temporaryDirectories.push(otherApplicationRoot);
    const movedRoot = openWithApplicationPaths(resolveAgentApplicationPaths(otherApplicationRoot));
    expect(movedRoot.snapshot().value.ModelProviderEndpoints?.[0]?.ApiKey).toMatch(/^senera:secret:v2:/u);
    expect(unresolvedProviderIds(movedRoot.snapshot())).toEqual(["custom"]);
    movedRoot.close();
  });

  it("moves a pre-keyring workspace key into the host keyring and reports it once", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-key-relocation");
    const applicationRoot = createTemporaryDirectory("senera-config-secret-relocation-application-root");
    temporaryDirectories.push(workspaceRoot, applicationRoot);
    const applicationPaths = resolveAgentApplicationPaths(applicationRoot);
    const legacyKey = Buffer.alloc(32, 17);
    const keyId = toAgentSecretKey(legacyKey).id;
    writeLegacyKey(workspaceRoot, legacyKey);
    const secret = "relocated-workspace-key-secret";
    const configPath = path.join(workspaceRoot, "senera.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        configWithSealedSecret(
          sealLegacyEnvelope(legacyKey, `senera/config/ModelProviderEndpoints/custom/ApiKey`, secret),
        ),
        null,
        2,
      )}\n`,
      "utf8",
    );
    const open = (): AgentConfigService =>
      createSeneraWorkspaceConfigService({
        workspaceRoot,
        configSource: { kind: "json", configPath },
        upgradeSession: new AgentUpgradeSession({ workspaceRoot, appVersion: "test" }),
        applicationPaths,
      });

    const service = open();
    expect(service.snapshot().value.ModelProviderEndpoints?.[0]?.ApiKey).toBe(secret);
    expect(relocationDiagnostics(service.snapshot())).toEqual([
      { sourcePath: resolveAgentWorkspaceLayout(workspaceRoot).configSecretKey, keyId, relocated: true },
    ]);
    // The key left the directory the user may commit, and it is still a candidate this host can open with.
    expect(fs.existsSync(resolveAgentWorkspaceLayout(workspaceRoot).configSecretKey)).toBe(false);
    expect(readText(path.join(applicationPaths.secretKeysRoot, "config", `${keyId}.key`)).trim()).toBe(
      legacyKey.toString("base64url"),
    );
    service.close();

    const reopened = open();
    expect(reopened.snapshot().value.ModelProviderEndpoints?.[0]?.ApiKey).toBe(secret);
    expect(relocationDiagnostics(reopened.snapshot())).toEqual([]);
    reopened.close();
  });

  it("keeps secrets readable when a legacy key file cannot move and keeps reporting the failure", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-key-relocation-stuck");
    const applicationRoot = createTemporaryDirectory("senera-config-secret-stuck-application-root");
    temporaryDirectories.push(workspaceRoot, applicationRoot);
    const applicationPaths = resolveAgentApplicationPaths(applicationRoot);
    const legacyKey = Buffer.alloc(32, 19);
    const keyId = toAgentSecretKey(legacyKey).id;
    writeLegacyKey(workspaceRoot, legacyKey);
    // Something already owns the path the retired key would need, so the move cannot complete.
    fs.mkdirSync(path.join(applicationPaths.secretKeysRoot, "config", `${keyId}.key`), { recursive: true });
    const secret = "unmovable-workspace-key-secret";
    const configPath = path.join(workspaceRoot, "senera.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        configWithSealedSecret(
          sealLegacyEnvelope(legacyKey, `senera/config/ModelProviderEndpoints/custom/ApiKey`, secret),
        ),
      )}\n`,
      "utf8",
    );

    const service = createSeneraWorkspaceConfigService({
      workspaceRoot,
      configSource: { kind: "json", configPath },
      upgradeSession: new AgentUpgradeSession({ workspaceRoot, appVersion: "test" }),
      applicationPaths,
    });
    const snapshot = service.snapshot();
    service.close();

    expect(snapshot.value.ModelProviderEndpoints?.[0]?.ApiKey).toBe(secret);
    expect(fs.existsSync(resolveAgentWorkspaceLayout(workspaceRoot).configSecretKey)).toBe(true);
    const [relocation] = relocationDiagnostics(snapshot);
    expect(relocation).toMatchObject({ keyId, relocated: false });
    expect(relocation?.failure).toBeTruthy();
  });

  it("keeps a provider credential readable after the provider id changes", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-renamed-provider");
    temporaryDirectories.push(workspaceRoot);
    const protectedConfig = testCodec(workspaceRoot).protectConfig(configWithSecret("rename-safe-secret"));
    const renamed = {
      ...protectedConfig,
      ModelProviderEndpoints: [{ ...protectedConfig.ModelProviderEndpoints![0]!, Id: "renamed" }],
    } as AgentSystemConfig;

    expect(testCodec(workspaceRoot).revealConfig(renamed).value).toEqual({
      ...renamed,
      ModelProviderEndpoints: [{ ...renamed.ModelProviderEndpoints![0]!, ApiKey: "rename-safe-secret" }],
    });
  });

  it("keeps a secret another host sealed exactly as stored and reports it", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-authentication");
    temporaryDirectories.push(workspaceRoot);
    const protectedConfig = testCodec(workspaceRoot).protectConfig(configWithSecret("authenticated-secret"));
    const otherHostCodec = new AgentConfigSecretCodec({ workspaceRoot, key: OtherHostKey });

    const revealed = otherHostCodec.revealConfig(protectedConfig);
    expect(revealed.value).toEqual(protectedConfig);
    expect(revealed.unresolvedSecrets).toEqual([
      { kind: "provider_api_key", providerId: "custom", reason: "unknown_key" },
    ]);
    expect(otherHostCodec.revealConfig({ ...protectedConfig, ModelProviderEndpoints: [] }).unresolvedSecrets).toEqual(
      [],
    );
  });

  it("loads a config whose secret cannot be opened and reports it as a diagnostic", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-unreadable-json");
    temporaryDirectories.push(workspaceRoot);
    const configPath = path.join(workspaceRoot, "senera.config.json");
    const protectedConfig = testCodec(workspaceRoot).protectConfig(configWithSecret("unreadable-provider-secret"));
    fs.writeFileSync(configPath, `${JSON.stringify(protectedConfig, null, 2)}\n`, "utf8");

    const service = new AgentConfigService({
      workspaceRoot,
      source: { kind: "json", configPath },
      secretCodec: new AgentConfigSecretCodec({ workspaceRoot, key: OtherHostKey }),
    });
    const snapshot = service.snapshot();
    service.close();

    expect(snapshot.value.ModelProviderEndpoints?.[0]?.ApiKey).toMatch(/^senera:secret:v2:/u);
    expect(
      snapshot.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === "config.secretUnresolved" &&
          (diagnostic.details as { providerId?: string }).providerId === "custom",
      ),
    ).toHaveLength(1);
    expect(readText(configPath)).toMatch(/"ApiKey": "senera:secret:v2:/u);
  });

  it("reports unresolved secrets for the snapshot that holds them", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-residue");
    temporaryDirectories.push(workspaceRoot);
    const configPath = path.join(workspaceRoot, "senera.config.json");
    const hostCodec = new AgentConfigSecretCodec({ workspaceRoot, key: OtherHostKey });
    const readable = configWithStrandedProviders();
    const hostSealed = hostCodec.protectConfig(readable);
    const foreignSealed = testCodec(workspaceRoot).protectConfig(readable);
    const stored: AgentSystemConfig = {
      ...hostSealed,
      ModelProviderEndpoints: hostSealed.ModelProviderEndpoints!.map((endpoint) =>
        endpoint.Id === "keeper"
          ? endpoint
          : foreignSealed.ModelProviderEndpoints!.find((item) => item.Id === endpoint.Id)!,
      ),
    };
    fs.writeFileSync(configPath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
    const strandedApiKey = foreignSealed.ModelProviderEndpoints![0]!.ApiKey!;

    const service = new AgentConfigService({
      workspaceRoot,
      source: { kind: "json", configPath },
      secretCodec: hostCodec,
    });
    expect(unresolvedProviderIds(service.snapshot())).toEqual(["custom", "other"]);

    const snapshot = service.deleteProviderEndpoint({
      commandId: "remove-unreadable-provider",
      providerId: "custom",
      cascadeModels: true,
    });
    service.close();

    expect(unresolvedProviderIds(snapshot)).toEqual(["other"]);
    expect(readText(configPath)).not.toContain(strandedApiKey);
  });

  it("reveals nothing and creates no key when this host has never held one", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-missing-key");
    temporaryDirectories.push(workspaceRoot);
    const legacyKey = Buffer.alloc(32, 11);
    const protectedConfig = configWithSealedSecret(
      sealLegacyEnvelope(legacyKey, `senera/config/ModelProviderEndpoints/custom/ApiKey`, "unrecoverable-secret"),
    );
    const keyRing = createAgentSecretDomain("config", {
      environment: {},
      keysRoot: path.join(workspaceRoot, "keys"),
    }).keyRing;
    const codecWithoutKey = new AgentConfigSecretCodec({
      environment: {},
      keysRoot: path.join(workspaceRoot, "keys"),
    });

    const revealed = codecWithoutKey.revealConfig(protectedConfig);
    expect(revealed.value).toEqual(protectedConfig);
    expect(revealed.unresolvedSecrets).toEqual([
      { kind: "provider_api_key", providerId: "custom", reason: "missing_key" },
    ]);
    expect(fs.existsSync(keyRing.keyFilePath)).toBe(false);
  });

  it("rejects an envelope whose ciphertext was altered", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-tampered");
    temporaryDirectories.push(workspaceRoot);
    const codec = testCodec(workspaceRoot);
    const endpoint = codec.protectConfig(configWithSecret("tampered-secret")).ModelProviderEndpoints![0]!;
    const tampered = configWithSealedSecret(
      `${endpoint.ApiKey!.slice(0, -1)}${endpoint.ApiKey!.endsWith("A") ? "B" : "A"}`,
    );

    const revealed = codec.revealConfig(tampered);
    expect(revealed.value).toEqual(tampered);
    expect(revealed.unresolvedSecrets).toEqual([
      { kind: "provider_api_key", providerId: "custom", reason: "authentication_failed" },
    ]);
  });

  it("refuses to read a scheme-prefixed value it cannot parse as a typed key", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-malformed-envelope");
    temporaryDirectories.push(workspaceRoot);
    const codec = testCodec(workspaceRoot);

    for (const envelope of ["senera:secret:v2:", "senera:secret:v9:not-an-envelope"]) {
      const stored = configWithSealedSecret(envelope);
      const revealed = codec.revealConfig(stored);
      expect(revealed.value).toEqual(stored);
      // Counting it as plaintext would make the loader seal this ciphertext as if the user typed it.
      expect(revealed.plaintextSecretsFound).toBe(false);
      expect(revealed.unresolvedSecrets).toEqual([
        { kind: "provider_api_key", providerId: "custom", reason: "unsupported_format" },
      ]);
      expect(codec.protectConfig(stored)).toEqual(stored);
    }
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
    expect(readText(configPath)).toContain("senera:secret:v2:");
    const backupPath = `${configPath}.v0.bak`;
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(readText(backupPath)).not.toContain(secret);
    expect(readText(backupPath)).toContain("senera:secret:v2:");

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
    const databasePath = resolveAgentWorkspaceLayout(workspaceRoot).databases.config;
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
      expect(row.config_json).toContain("senera:secret:v2:");
      for (const secret of secrets) expect(row.config_json).not.toContain(secret);
    }

    const databaseBytes = fs.readFileSync(databasePath);
    for (const secret of secrets) {
      expect(databaseBytes.includes(Buffer.from(secret, "utf8"))).toBe(false);
    }
  });

  it.skipIf(!sqliteAvailable)("re-seals a legacy revision secret with the host key when the store opens", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-sqlite-rewrap");
    temporaryDirectories.push(workspaceRoot);
    const databasePath = resolveAgentWorkspaceLayout(workspaceRoot).databases.config;
    const legacyKey = Buffer.alloc(32, 11);
    writeLegacyKey(workspaceRoot, legacyKey);
    const codec = testCodec(workspaceRoot);
    const secret = "sqlite-legacy-rewrap-secret";
    const legacyConfig = configWithSealedSecret(
      sealLegacyEnvelope(legacyKey, `senera/config/ModelProviderEndpoints/custom/ApiKey`, secret),
    );

    const seeded = new AgentConfigSqliteRepository(databasePath, { secretCodec: codec });
    const seededRevision = seeded.appendRevision({ config: configWithSecret(secret), source: "seed" }).revision;
    seeded.close();
    const legacyDatabase = new Database(databasePath);
    legacyDatabase
      .prepare("UPDATE config_revisions SET config_json = ? WHERE revision = ?")
      .run(JSON.stringify(legacyConfig), seededRevision);
    legacyDatabase.close();

    const converged = new AgentConfigSqliteRepository(databasePath, { secretCodec: testCodec(workspaceRoot) });
    expect(converged.latestRevision()?.revision).toBe(seededRevision);
    expect(converged.latestRevision()?.config.ModelProviderEndpoints?.[0]?.ApiKey).toBe(secret);
    converged.close();

    expect(readRevisionConfig(databasePath)).toContain(`senera:secret:v2:${toAgentSecretKey(ActiveKey).id}.`);

    // Opening the store moved the legacy key into the keyring, so the workspace copy is already gone and
    // the revision still opens from host key material alone.
    expect(fs.existsSync(resolveAgentWorkspaceLayout(workspaceRoot).configSecretKey)).toBe(false);
    const independent = new AgentConfigSqliteRepository(databasePath, { secretCodec: testCodec(workspaceRoot) });
    expect(independent.latestRevision()?.config.ModelProviderEndpoints?.[0]?.ApiKey).toBe(secret);
    independent.close();
  });

  it.skipIf(!sqliteAvailable)("reports a stranded revision secret only while that revision holds it", () => {
    const workspaceRoot = createTemporaryDirectory("senera-config-secret-sqlite-residue");
    temporaryDirectories.push(workspaceRoot);
    const databasePath = resolveAgentWorkspaceLayout(workspaceRoot).databases.config;
    const stranded = testCodec(workspaceRoot).protectConfig(configWithSecret("sqlite-residue-secret"));
    const repository = new AgentConfigSqliteRepository(databasePath, {
      secretCodec: new AgentConfigSecretCodec({ workspaceRoot, key: OtherHostKey }),
    });

    expect(repository.appendRevision({ config: stranded, source: "seed" }).unresolvedSecrets).toEqual([
      { kind: "provider_api_key", providerId: "custom", reason: "unknown_key" },
    ]);

    const dropped = repository.executeCommand(
      {
        commandId: "drop-stranded-provider",
        operationKind: "config.update",
        payloadHash: "sqlite-residue",
        source: "ui_update",
      },
      () => ({ ...stranded, ModelProviderEndpoints: [], ModelProviders: [], DefaultModelProviderId: undefined }),
    );
    expect(dropped.revision.unresolvedSecrets).toEqual([]);
    repository.close();
  });
});

function testCodec(workspaceRoot: string): AgentConfigSecretCodec {
  return new AgentConfigSecretCodec({ workspaceRoot, key: ActiveKey });
}

/** Reproduces the key file layout releases before the keyring wrote into each workspace. */
function writeLegacyKey(workspaceRoot: string, key: Buffer): void {
  const keyPath = resolveAgentWorkspaceLayout(workspaceRoot).configSecretKey;
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, `${key.toString("base64url")}\n`, "utf8");
}

/** Reproduces the pre-keyring envelope: no key id and authenticated data bound to the provider id. */
function sealLegacyEnvelope(key: Buffer, context: string, value: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `senera:secret:v1:${[nonce, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".")}`;
}

/** The same provider config with a credential that is already encrypted, as an older release stored it. */
function configWithSealedSecret(envelope: string): AgentSystemConfig {
  const config = configWithSecret("placeholder");
  return { ...config, ModelProviderEndpoints: [{ ...config.ModelProviderEndpoints![0]!, ApiKey: envelope }] };
}

/** Which providers this snapshot reports as undecryptable, in configuration order. */
function unresolvedProviderIds(snapshot: { diagnostics: readonly { code?: string; details?: unknown }[] }): string[] {
  return snapshot.diagnostics
    .filter((diagnostic) => diagnostic.code === "config.secretUnresolved")
    .map((diagnostic) => (diagnostic.details as { providerId: string }).providerId);
}

/** Key files this host found outside the keyring, and whether each one left where it was. */
function relocationDiagnostics(snapshot: {
  diagnostics: readonly { code?: string; details?: unknown }[];
}): { sourcePath: string; keyId: string; relocated: boolean; failure?: string }[] {
  return snapshot.diagnostics
    .filter((diagnostic) => diagnostic.code === "config.secretKeyRelocated")
    .map(
      (diagnostic) => diagnostic.details as { sourcePath: string; keyId: string; relocated: boolean; failure?: string },
    );
}

/** Two providers whose keys another host holds plus a readable one that owns the default model. */
function configWithStrandedProviders(): AgentSystemConfig {
  const config = configWithSecret("stranded-secret");
  return {
    ...config,
    ModelProviderEndpoints: [
      ...config.ModelProviderEndpoints!,
      { Id: "other", BaseUrl: "https://other.example.test/v1", ApiKey: "other-secret" },
      { Id: "keeper", BaseUrl: "https://keeper.example.test/v1", ApiKey: "keeper-secret" },
    ],
    ModelProviders: [
      ...config.ModelProviders!,
      { Id: "keeper/chat", ProviderId: "keeper", Endpoint: "Responses", Model: "chat" },
    ],
    DefaultModelProviderId: "keeper/chat",
  };
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

/** The bytes the store kept for its newest revision, read straight from the database file. */
function readRevisionConfig(databasePath: string): string {
  const database = new Database(databasePath, { readonly: true });
  try {
    const row = database.prepare("SELECT config_json FROM config_revisions ORDER BY revision DESC LIMIT 1").get() as {
      config_json: string;
    };
    return row.config_json;
  } finally {
    database.close();
  }
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
