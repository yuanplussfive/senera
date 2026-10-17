import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  AgentWorkspaceConfigFileName,
  migrateLegacyAgentWorkspaceLayout,
  resolveAgentWorkspaceConfigPath,
  resolveAgentWorkspaceLayout,
} from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";

describe("agent workspace layout", () => {
  test("separates Skills, MCP packages, and database domains under .senera", () => {
    const root = path.resolve("workspace");
    const layout = resolveAgentWorkspaceLayout(root);

    expect(layout.desktopRuntimeRoot).toBe(path.join(root, ".senera", "desktop"));
    expect(layout.configFile).toBe(path.join(root, AgentWorkspaceConfigFileName));
    expect(layout.promptPresetRoot).toBe(path.join(root, "prompts"));
    expect(layout.promptPresetStateFile).toBe(path.join(root, ".senera", "prompt-preset.json"));
    expect(layout.piSessionsRoot).toBe(path.join(root, ".senera", "pi-sessions"));
    expect(layout.logsRoot).toBe(path.join(root, ".senera", "logs"));
    expect(layout.sandboxRuntimeRoot).toBe(path.join(root, ".senera", "sandbox-runtime"));
    expect(layout.skillRoot).toBe(path.join(root, ".senera", "skills"));
    expect(layout.mcpRoot).toBe(path.join(root, ".senera", "mcp"));
    expect(layout.agentRolesRoot).toBe(path.join(root, ".senera", "agents"));
    expect(layout.userPluginsRoot).toBe(path.join(root, ".senera", "user-plugins"));
    expect(layout.projectPluginsRoot).toBe(path.join(root, ".senera", "plugins"));
    expect(layout.userPluginsRoot).not.toBe(layout.projectPluginsRoot);
    expect(layout.databases).toEqual({
      config: path.join(root, ".senera", "data", "config", "config.sqlite"),
      credentials: path.join(root, ".senera", "data", "credentials", "credentials.sqlite"),
      sessions: path.join(root, ".senera", "data", "sessions", "sessions.sqlite"),
      memory: path.join(root, ".senera", "data", "memory", "memory.sqlite"),
      memos: path.join(root, ".senera", "data", "memos", "memos.sqlite"),
      orchestration: path.join(root, ".senera", "data", "orchestration", "orchestration.sqlite"),
      channels: path.join(root, ".senera", "data", "channels", "channels.sqlite"),
      artifactManifestIndex: path.join(root, ".senera", "data", "artifacts", "manifest-index.sqlite"),
      workspaceObserver: path.join(root, ".senera", "data", "workspace-observer", "workspace-observer.sqlite"),
    });
    expect(layout.caches).toEqual({
      toolSearchEmbeddings: path.join(root, ".senera", "data", "tool-search", "embeddings.json"),
      toolObservationSift: path.join(root, ".senera", "data", "tool-observation", "sift"),
      mcpSchemas: path.join(root, ".senera", "data", "mcp", "schemas"),
      workspaceObserverContents: path.join(root, ".senera", "data", "workspace-observer", "contents"),
    });
    expect(layout.configSecretKey).toBe(path.join(root, ".senera", "data", "config", "config-secrets.key"));
    expect(layout.credentialSecretKey).toBe(path.join(root, ".senera", "data", "credentials", "credentials.key"));
  });

  test("resolves relative configuration paths from the workspace and preserves absolute paths", () => {
    const root = path.join(os.tmpdir(), "senera layout with spaces", "项目");
    const external = path.join(os.tmpdir(), "senera-external", "config.json");

    expect(resolveAgentWorkspaceConfigPath(root)).toBe(path.join(root, AgentWorkspaceConfigFileName));
    expect(resolveAgentWorkspaceConfigPath(root, "config/custom.json")).toBe(path.join(root, "config", "custom.json"));
    expect(resolveAgentWorkspaceConfigPath(root, external)).toBe(path.normalize(external));
  });

  test("moves legacy Skills, SQLite companions, and the config key without dual reads", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-layout-"));
    const legacySkill = path.join(root, ".skills", "example", "SKILL.md");
    const stateRoot = path.join(root, ".senera");
    fs.mkdirSync(path.dirname(legacySkill), { recursive: true });
    fs.mkdirSync(stateRoot, { recursive: true });
    fs.writeFileSync(legacySkill, "skill");
    for (const name of ["Config.sqlite", "Config.sqlite-wal", "Memory.sqlite", "senera.db"]) {
      fs.writeFileSync(path.join(stateRoot, name), name);
    }
    fs.writeFileSync(path.join(stateRoot, "config-secrets.key"), "key");

    migrateLegacyAgentWorkspaceLayout(root);

    const layout = resolveAgentWorkspaceLayout(root);
    expect(fs.readFileSync(path.join(layout.skillRoot, "example", "SKILL.md"), "utf8")).toBe("skill");
    expect(fs.readFileSync(layout.databases.config, "utf8")).toBe("Config.sqlite");
    expect(fs.readFileSync(`${layout.databases.config}-wal`, "utf8")).toBe("Config.sqlite-wal");
    expect(fs.readFileSync(layout.databases.sessions, "utf8")).toBe("senera.db");
    expect(fs.readFileSync(layout.databases.memory, "utf8")).toBe("Memory.sqlite");
    expect(fs.readFileSync(layout.configSecretKey, "utf8")).toBe("key");
    expect(fs.existsSync(path.join(root, ".skills"))).toBe(false);
  });

  test("refuses to overwrite a target created before migration", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-layout-conflict-"));
    const layout = resolveAgentWorkspaceLayout(root);
    fs.mkdirSync(path.join(root, ".skills"), { recursive: true });
    fs.mkdirSync(layout.skillRoot, { recursive: true });

    expect(() => migrateLegacyAgentWorkspaceLayout(root)).toThrow(/cannot replace/);
    expect(fs.existsSync(path.join(root, ".skills"))).toBe(true);
  });
});
