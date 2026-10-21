import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { AgentConfigSecretCodec } from "../../../Source/AgentSystem/Config/AgentConfigSecretProtection.js";
import { resolveAgentApplicationPaths } from "../../../Source/AgentSystem/Core/AgentApplicationPaths.js";
import {
  resolveServerConfigSource,
  resolveServerRuntimeConfigPath,
  resolveWorkspaceServerConfigSource,
} from "../../../Apps/ServerRuntimeConfig.js";
import { resolveSeneraInitialWorkspaceRuntime } from "../../../Apps/ServerWorkspaceRuntime.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

test("keeps configuration ownership inside the selected workspace", () => {
  const root = path.resolve("test-workspaces", "senera host with spaces", "初始工作区");
  const next = path.resolve("test-workspaces", "senera host with spaces", "另一个工作区");
  const nested = resolveServerConfigSource(root, { configPath: "config/profiles/local.json" });

  expect(nested).toEqual({ kind: "json", configPath: path.join(root, "config", "profiles", "local.json") });
  expect(resolveWorkspaceServerConfigSource(next, nested, root)).toEqual({
    kind: "json",
    configPath: path.join(next, "config", "profiles", "local.json"),
  });

  const external = resolveServerConfigSource(root, {
    configPath: path.join(path.dirname(root), "shared", "senera.config.json"),
  });
  expect(resolveWorkspaceServerConfigSource(next, external, root)).toEqual({
    kind: "json",
    configPath: path.join(next, "senera.config.json"),
  });

  const sqlite = resolveWorkspaceServerConfigSource(
    next,
    {
      kind: "sqlite",
      databasePath: path.join(root, ".senera", "data", "config", "config.sqlite"),
      seedConfig: { ModelProviders: [] },
    },
    root,
  );
  expect(sqlite).toEqual({
    kind: "sqlite",
    databasePath: resolveAgentWorkspaceLayout(next).databases.config,
    label: resolveAgentWorkspaceLayout(next).databases.config,
    seedConfig: { ModelProviders: [] },
  });
  expect(resolveServerRuntimeConfigPath(next, sqlite)).toBe(resolveAgentWorkspaceLayout(next).databases.config);
});

test("migrates a legacy JSON secret key from a custom config directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-config-secret-migration-"));
  temporaryDirectories.push(root);
  const applicationStateRoot = path.join(root, "application-state");
  const workspaceRoot = path.join(root, "workspace");
  const configDirectory = path.join(root, "external-config");
  const configPath = path.join(configDirectory, "runtime.json");
  fs.mkdirSync(applicationStateRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(configDirectory, { recursive: true });

  const config = {
    ModelProviderEndpoints: [{ Id: "custom", BaseUrl: "https://example.test", ApiKey: "legacy-secret" }],
  };
  const legacyCodec = new AgentConfigSecretCodec({ workspaceRoot: configDirectory });
  fs.writeFileSync(configPath, JSON.stringify(legacyCodec.protectPayload(config)));

  resolveSeneraInitialWorkspaceRuntime({
    paths: resolveAgentApplicationPaths(applicationStateRoot),
    workspaceRoot,
    workspaceId: "workspace",
    resourcesRoot: root,
    options: { configPath },
  });

  const currentCodec = new AgentConfigSecretCodec({ workspaceRoot });
  const protectedConfig = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  expect(currentCodec.revealPayload(protectedConfig).value).toEqual(config);
});
