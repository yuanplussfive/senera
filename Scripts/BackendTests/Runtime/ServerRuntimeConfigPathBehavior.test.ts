import path from "node:path";
import { expect, test } from "vitest";
import {
  resolveServerConfigSource,
  resolveServerRuntimeConfigPath,
  resolveWorkspaceServerConfigSource,
} from "../../../Apps/ServerRuntimeConfig.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";

test("keeps configuration ownership inside the selected workspace", () => {
  const root = path.join("C:\\tmp", "senera host with spaces", "初始工作区");
  const next = path.join("C:\\tmp", "senera host with spaces", "另一个工作区");
  const nested = resolveServerConfigSource(root, { configPath: "config/profiles/local.json" });

  expect(nested).toEqual({ kind: "json", configPath: path.join(root, "config", "profiles", "local.json") });
  expect(resolveWorkspaceServerConfigSource(next, nested, root)).toEqual({
    kind: "json",
    configPath: path.join(next, "config", "profiles", "local.json"),
  });

  const external = resolveServerConfigSource(root, {
    configPath: path.join("C:\\shared", "senera.config.json"),
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
