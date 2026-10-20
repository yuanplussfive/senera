import { createCipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { AgentMcpCredentialRepository } from "../../../Source/AgentSystem/Credentials/AgentMcpCredentialRepository.js";
import { AgentMcpInputService } from "../../../Source/AgentSystem/Credentials/AgentMcpInputService.js";
import type { AgentMcpInputDefinition } from "../../../Source/AgentSystem/McpPackages/AgentMcpInputDefinition.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { toAgentSecretKey } from "../../../Source/AgentSystem/Security/AgentSecretKeyRing.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("MCP credential vault", () => {
  test("encrypts server-scoped secrets and exposes only source metadata", () => {
    const workspaceRoot = createTemporaryDirectory("senera-mcp-credentials");
    temporaryDirectories.push(workspaceRoot);
    const service = AgentMcpInputService.open(workspaceRoot, { SHARED_TOKEN: "host-value" });
    const token = inputDefinition("SHARED_TOKEN", true);

    service.set("research", token, "vault-secret-that-must-not-appear-on-disk");
    service.set("weather", token, "weather-value");

    expect(service.resolve("research", token.binding)).toEqual({
      value: "vault-secret-that-must-not-appear-on-disk",
      source: "vault",
    });
    expect(service.resolve("weather", token.binding)).toEqual({ value: "weather-value", source: "vault" });
    expect(service.statuses("research", [token])).toEqual([
      expect.objectContaining({ id: "SHARED_TOKEN", required: true, configured: true, stored: true, source: "vault" }),
    ]);
    service.close();

    const layout = resolveAgentWorkspaceLayout(workspaceRoot);
    expect(
      fs
        .readFileSync(layout.databases.credentials)
        .includes(Buffer.from("vault-secret-that-must-not-appear-on-disk", "utf8")),
    ).toBe(false);
    // The host keyring owns the key, so no key material lands in the user's project directory.
    expect(fs.existsSync(layout.credentialSecretKey)).toBe(false);
  });

  test("moves a pre-keyring credential key into the host keyring and reports the move once", () => {
    const workspaceRoot = createTemporaryDirectory("senera-mcp-credential-key-relocation");
    const keysRoot = createTemporaryDirectory("senera-mcp-credential-relocation-keys-root");
    temporaryDirectories.push(workspaceRoot, keysRoot);
    const layout = resolveAgentWorkspaceLayout(workspaceRoot);
    const legacyKey = Buffer.alloc(32, 21);
    const keyId = toAgentSecretKey(legacyKey).id;
    fs.mkdirSync(path.dirname(layout.credentialSecretKey), { recursive: true });
    fs.writeFileSync(layout.credentialSecretKey, `${legacyKey.toString("base64url")}\n`, "utf8");
    const secret = "relocated-credential-key-secret";
    const token = inputDefinition("TOKEN", true);

    const service = AgentMcpInputService.open(workspaceRoot, {}, keysRoot);
    service.set("research", token, "replaced-by-the-older-format");
    writeStoredEnvelope(layout.databases.credentials, sealLegacyEnvelope(legacyKey, "research", "TOKEN", secret));
    expect(service.resolve("research", token.binding)).toEqual({ value: secret, source: "vault" });
    expect(service.relocatedLegacyKeys()).toEqual([{ sourcePath: layout.credentialSecretKey, keyId, relocated: true }]);
    expect(fs.existsSync(layout.credentialSecretKey)).toBe(false);
    expect(readText(path.join(keysRoot, "credentials", `${keyId}.key`)).trim()).toBe(legacyKey.toString("base64url"));
    service.close();

    // The tidy-up is one-time, and the retired key is what lets the next open re-seal with the host key.
    const restarted = AgentMcpInputService.open(workspaceRoot, {}, keysRoot);
    expect(restarted.relocatedLegacyKeys()).toEqual([]);
    expect(restarted.resolve("research", token.binding)).toEqual({ value: secret, source: "vault" });
    restarted.close();
    const hostKey = Buffer.from(readText(path.join(keysRoot, "credentials", "secret.key")).trim(), "base64url");
    expect(readStoredEnvelope(layout.databases.credentials)).toMatch(
      new RegExp(`^senera:secret:v2:${toAgentSecretKey(hostKey).id}\\.`, "u"),
    );

    // A host whose keyring never saw that key still loses this credential alone, and says so.
    const otherHost = AgentMcpInputService.open(workspaceRoot, {}, path.join(keysRoot, "other"));
    expect(otherHost.resolve("research", token.binding)).toBeUndefined();
    expect(otherHost.statuses("research", [token])).toEqual([
      expect.objectContaining({ id: "TOKEN", configured: false, stored: true, source: "unresolved" }),
    ]);
    otherHost.close();
  });

  test("re-seals a pre-keyring credential with the host key when the vault opens", () => {
    const workspaceRoot = createTemporaryDirectory("senera-mcp-credential-rewrap");
    temporaryDirectories.push(workspaceRoot);
    const layout = resolveAgentWorkspaceLayout(workspaceRoot);
    const legacyKey = Buffer.alloc(32, 11);
    const hostKey = Buffer.alloc(32, 12);
    const environment = { SENERA_CREDENTIAL_SECRET_KEY: hostKey.toString("base64url") };
    fs.mkdirSync(path.dirname(layout.credentialSecretKey), { recursive: true });
    fs.writeFileSync(layout.credentialSecretKey, `${legacyKey.toString("base64url")}\n`, "utf8");
    const secret = "pre-keyring-vault-secret";
    const token = inputDefinition("TOKEN", true);

    const writer = AgentMcpInputService.open(workspaceRoot, environment);
    writer.set("research", token, "replaced-by-the-older-format");
    writeStoredEnvelope(layout.databases.credentials, sealLegacyEnvelope(legacyKey, "research", "TOKEN", secret));
    const before = readCredentialState(layout.databases.credentials);
    writer.close();

    const restarted = AgentMcpInputService.open(workspaceRoot, environment);
    expect(restarted.resolve("research", token.binding)).toEqual({ value: secret, source: "vault" });
    const after = readCredentialState(layout.databases.credentials);
    expect(after.envelope).not.toBe(before.envelope);
    expect(after.envelope.startsWith(`senera:secret:v2:${toAgentSecretKey(hostKey).id}.`)).toBe(true);
    // Only the storage representation changed, so nothing downstream is told to refetch.
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.revision).toBe(before.revision);
    restarted.close();

    expect(fs.existsSync(layout.credentialSecretKey)).toBe(false);
    const converged = AgentMcpInputService.open(workspaceRoot, environment);
    expect(converged.resolve("research", token.binding)).toEqual({ value: secret, source: "vault" });
    converged.close();
  });

  test("reports a credential another host sealed as unresolved and leaves its envelope untouched", () => {
    const workspaceRoot = createTemporaryDirectory("senera-mcp-credential-foreign-key");
    temporaryDirectories.push(workspaceRoot);
    const databasePath = resolveAgentWorkspaceLayout(workspaceRoot).databases.credentials;
    const originalHost = new AgentMcpCredentialRepository(databasePath, { workspaceRoot, key: Buffer.alloc(32, 7) });
    originalHost.upsert("research", "TOKEN", "foreign-host-secret");
    originalHost.close();
    const storedEnvelope = readStoredEnvelope(databasePath);

    const service = new AgentMcpInputService(
      new AgentMcpCredentialRepository(databasePath, { workspaceRoot, key: Buffer.alloc(32, 9) }),
      {},
    );
    const token = inputDefinition("TOKEN", true);
    expect(service.resolve("research", token.binding)).toBeUndefined();
    expect(service.statuses("research", [token])).toEqual([
      expect.objectContaining({ id: "TOKEN", configured: false, stored: true, source: "unresolved" }),
    ]);
    service.close();

    // The original host can still open it, so this host must not re-seal or erase what it cannot read.
    expect(readStoredEnvelope(databasePath)).toBe(storedEnvelope);
  });

  test("keeps its master key in the application state root the deployment passes", () => {
    const workspaceRoot = createTemporaryDirectory("senera-mcp-credential-pinned-keys-root");
    const keysRoot = createTemporaryDirectory("senera-mcp-credential-keys-root");
    temporaryDirectories.push(workspaceRoot, keysRoot);
    const layout = resolveAgentWorkspaceLayout(workspaceRoot);
    const keyFilePath = path.join(keysRoot, "credentials", "secret.key");
    const token = inputDefinition("TOKEN", true);

    const service = AgentMcpInputService.open(workspaceRoot, {}, keysRoot);
    service.set("research", token, "pinned-root-secret");
    service.close();

    const pinnedKey = Buffer.from(fs.readFileSync(keyFilePath, "utf8").trim(), "base64url");
    expect(readStoredEnvelope(layout.databases.credentials)).toMatch(
      new RegExp(`^senera:secret:v2:${toAgentSecretKey(pinnedKey).id}\\.`, "u"),
    );
    expect(fs.existsSync(layout.credentialSecretKey)).toBe(false);

    const restarted = AgentMcpInputService.open(workspaceRoot, {}, keysRoot);
    expect(restarted.resolve("research", token.binding)).toEqual({ value: "pinned-root-secret", source: "vault" });
    restarted.close();

    // Pointing the same vault at another key root costs this credential alone, and says so.
    const otherRoot = AgentMcpInputService.open(workspaceRoot, {}, path.join(keysRoot, "other"));
    expect(otherRoot.resolve("research", token.binding)).toBeUndefined();
    expect(otherRoot.statuses("research", [token])).toEqual([
      expect.objectContaining({ id: "TOKEN", configured: false, stored: true, source: "unresolved" }),
    ]);
    otherRoot.close();
    expect(fs.existsSync(path.join(keysRoot, "other", "credentials", "secret.key"))).toBe(false);
  });

  test("uses a host environment value only while no stored credential holds the slot", () => {
    const workspaceRoot = createTemporaryDirectory("senera-mcp-credential-sources");
    temporaryDirectories.push(workspaceRoot);
    const databasePath = resolveAgentWorkspaceLayout(workspaceRoot).databases.credentials;
    const firstHostKey = Buffer.alloc(32, 7).toString("base64url");
    const token = inputDefinition("TOKEN", true, undefined, {
      source: "legacyEnvironment",
      name: "TOKEN",
      inputId: "TOKEN",
    });

    const unset = AgentMcpInputService.open(workspaceRoot, {
      SENERA_CREDENTIAL_SECRET_KEY: firstHostKey,
      TOKEN: "from-host",
    });
    expect(unset.resolve("research", token.binding)).toEqual({ value: "from-host", source: "environment" });
    expect(unset.statuses("research", [token])).toEqual([
      expect.objectContaining({ id: "TOKEN", configured: true, stored: false, source: "environment" }),
    ]);

    unset.set("research", token, "vault-token");
    expect(unset.resolve("research", token.binding)).toEqual({ value: "vault-token", source: "vault" });
    unset.close();

    const otherHost = new AgentMcpInputService(
      new AgentMcpCredentialRepository(databasePath, { workspaceRoot, key: Buffer.alloc(32, 9) }),
      { TOKEN: "from-host" },
    );
    // A credential this host cannot open keeps its slot: the host value must not silently replace it.
    expect(otherHost.resolve("research", token.binding)).toBeUndefined();
    expect(otherHost.statuses("research", [token])).toEqual([
      expect.objectContaining({ id: "TOKEN", configured: false, stored: true, source: "unresolved" }),
    ]);
    expect(otherHost.resolve("weather", token.binding)).toEqual({ value: "from-host", source: "environment" });
    otherHost.close();

    const restored = AgentMcpInputService.open(workspaceRoot, {
      SENERA_CREDENTIAL_SECRET_KEY: firstHostKey,
      TOKEN: "from-host",
    });
    restored.set("research", token, "re-entered-token");
    expect(restored.resolve("research", token.binding)).toEqual({ value: "re-entered-token", source: "vault" });
    expect(restored.statuses("research", [token])).toEqual([
      expect.objectContaining({ id: "TOKEN", configured: true, stored: true, source: "vault" }),
    ]);
    restored.close();
  });

  test("stores ordinary typed inputs separately from encrypted Secrets and revisions", () => {
    const workspaceRoot = createTemporaryDirectory("senera-mcp-typed-inputs");
    temporaryDirectories.push(workspaceRoot);
    const service = AgentMcpInputService.open(workspaceRoot, {});
    const secret = inputDefinition("TOKEN", true);
    const region = inputDefinition("REGION", false, ["cn", "us"]);
    const initial = service.revision();

    service.set("research", secret, "secret-value-not-on-disk");
    const afterSecret = service.revision();
    service.set("research", region, "cn");
    const afterConfig = service.revision();

    expect(afterSecret).not.toBe(initial);
    expect(afterConfig).not.toBe(afterSecret);
    expect(service.resolve("research", secret.binding)).toEqual({ value: "secret-value-not-on-disk", source: "vault" });
    expect(service.resolve("research", region.binding)).toEqual({ value: "cn", source: "configuration" });
    const statuses = service.statuses("research", [secret, region]);
    expect(statuses).toEqual([
      expect.objectContaining({ id: "TOKEN", secret: true, stored: true, source: "vault" }),
      expect.objectContaining({ id: "REGION", secret: false, stored: true, source: "configuration", value: "cn" }),
    ]);
    expect(JSON.stringify(statuses)).not.toContain("secret-value-not-on-disk");
    service.close();

    const database = fs.readFileSync(resolveAgentWorkspaceLayout(workspaceRoot).databases.credentials);
    expect(database.includes(Buffer.from("secret-value-not-on-disk", "utf8"))).toBe(false);
    expect(database.includes(Buffer.from('"cn"', "utf8"))).toBe(true);
  });

  test("keeps identically named MCP inputs isolated per workspace", () => {
    const firstWorkspace = createTemporaryDirectory("senera-mcp-workspace-a");
    const secondWorkspace = createTemporaryDirectory("senera-mcp-workspace-b");
    temporaryDirectories.push(firstWorkspace, secondWorkspace);
    const first = AgentMcpInputService.open(firstWorkspace, {});
    const second = AgentMcpInputService.open(secondWorkspace, {});
    const definition = inputDefinition("TOKEN", true);

    first.set("shared-server", definition, "workspace-a-secret");

    expect(first.resolve("shared-server", definition.binding)).toEqual({
      value: "workspace-a-secret",
      source: "vault",
    });
    expect(second.resolve("shared-server", definition.binding)).toBeUndefined();
    expect(resolveAgentWorkspaceLayout(firstWorkspace).databases.credentials).not.toBe(
      resolveAgentWorkspaceLayout(secondWorkspace).databases.credentials,
    );

    first.close();
    second.close();
  });

  test("validates a batch before atomically committing Secret and ordinary inputs", () => {
    const workspaceRoot = createTemporaryDirectory("senera-mcp-input-batch");
    temporaryDirectories.push(workspaceRoot);
    const service = AgentMcpInputService.open(workspaceRoot, {});
    const secret = inputDefinition("TOKEN", true);
    const region = inputDefinition("REGION", false, ["cn", "us"]);
    const initialRevision = service.revision();

    expect(() =>
      service.update("research", [secret, region], {
        values: { TOKEN: "must-rollback", REGION: "invalid-region" },
      }),
    ).toThrow(/one of the declared choices/u);
    expect(service.revision()).toBe(initialRevision);
    expect(service.resolve("research", secret.binding)).toBeUndefined();
    expect(service.resolve("research", region.binding)).toBeUndefined();

    service.update("research", [secret, region], {
      values: { TOKEN: "committed-secret", REGION: "cn" },
    });
    expect(service.resolve("research", secret.binding)).toEqual({ value: "committed-secret", source: "vault" });
    expect(service.resolve("research", region.binding)).toEqual({ value: "cn", source: "configuration" });

    service.update("research", [secret, region], { values: {}, deletes: ["TOKEN", "REGION"] });
    expect(service.resolve("research", secret.binding)).toBeUndefined();
    expect(service.resolve("research", region.binding)).toBeUndefined();
    service.close();
  });
});

/** Reproduces the pre-keyring credential envelope: one key per workspace, authenticated data bound to the name. */
function sealLegacyEnvelope(key: Buffer, serverId: string, name: string, value: string): string {
  const context = `senera/mcp/${encodeURIComponent(serverId)}/environment/${encodeURIComponent(name)}`;
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `senera:secret:v1:${[nonce, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".")}`;
}

function writeStoredEnvelope(databasePath: string, envelope: string): void {
  const database = new Database(databasePath);
  try {
    database.prepare("UPDATE mcp_credentials SET value_envelope = ?").run(envelope);
  } finally {
    database.close();
  }
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function readStoredEnvelope(databasePath: string): string {
  const database = new Database(databasePath, { readonly: true });
  try {
    const row = database.prepare("SELECT value_envelope FROM mcp_credentials").get() as { value_envelope: string };
    return row.value_envelope;
  } finally {
    database.close();
  }
}

function readCredentialState(databasePath: string): {
  envelope: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
} {
  const database = new Database(databasePath, { readonly: true });
  try {
    const row = database
      .prepare("SELECT value_envelope, created_at, updated_at FROM mcp_credentials WHERE server_id = ? AND name = ?")
      .get("research", "TOKEN") as { value_envelope: string; created_at: string; updated_at: string };
    const state = database.prepare("SELECT revision FROM mcp_credential_state WHERE singleton = 1").get() as {
      revision: number;
    };
    return {
      envelope: row.value_envelope,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: state.revision,
    };
  } finally {
    database.close();
  }
}

function inputDefinition(
  id: string,
  secret: boolean,
  choices?: readonly string[],
  binding: AgentMcpInputDefinition["binding"] = { source: secret ? "secret" : "config", inputId: id },
): AgentMcpInputDefinition {
  return {
    id,
    title: id,
    type: "string",
    required: true,
    secret,
    multiple: false,
    ...(choices ? { choices: [...choices] } : {}),
    binding,
    provenance: "mcpb",
  };
}
