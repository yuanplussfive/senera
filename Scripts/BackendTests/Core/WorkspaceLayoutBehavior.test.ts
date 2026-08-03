import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  migrateLegacyAgentWorkspaceLayout,
  resolveAgentWorkspaceLayout,
} from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";

describe("agent workspace layout", () => {
  test("separates Skills, MCP packages, and database domains under .senera", () => {
    const root = path.resolve("workspace");
    const layout = resolveAgentWorkspaceLayout(root);

    expect(layout.skillRoot).toBe(path.join(root, ".senera", "skills"));
    expect(layout.mcpRoot).toBe(path.join(root, ".senera", "mcp"));
    expect(layout.databases).toEqual({
      config: path.join(root, ".senera", "data", "config", "config.sqlite"),
      credentials: path.join(root, ".senera", "data", "credentials", "credentials.sqlite"),
      sessions: path.join(root, ".senera", "data", "sessions", "sessions.sqlite"),
      memory: path.join(root, ".senera", "data", "memory", "memory.sqlite"),
      toolSearch: path.join(root, ".senera", "data", "tool-search", "tool-search.sqlite"),
    });
    expect(layout.configSecretKey).toBe(path.join(root, ".senera", "data", "config", "config-secrets.key"));
    expect(layout.credentialSecretKey).toBe(path.join(root, ".senera", "data", "credentials", "credentials.key"));
  });

  test("moves legacy Skills, SQLite companions, and the config key without dual reads", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-layout-"));
    const legacySkill = path.join(root, ".skills", "example", "SKILL.md");
    const stateRoot = path.join(root, ".senera");
    fs.mkdirSync(path.dirname(legacySkill), { recursive: true });
    fs.mkdirSync(stateRoot, { recursive: true });
    fs.writeFileSync(legacySkill, "skill");
    for (const name of [
      "Config.sqlite",
      "Config.sqlite-wal",
      "Memory.sqlite",
      "senera.db",
      "ToolSearchLearning.sqlite",
      "ToolSearch.sqlite",
      "ToolSearch.sqlite-shm",
    ]) {
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
    expect(fs.readFileSync(layout.databases.toolSearch, "utf8")).toBe("ToolSearchLearning.sqlite");
    expect(
      fs.readFileSync(path.join(path.dirname(layout.databases.toolSearch), "legacy", "ToolSearch.sqlite"), "utf8"),
    ).toBe("ToolSearch.sqlite");
    expect(
      fs.readFileSync(path.join(path.dirname(layout.databases.toolSearch), "legacy", "ToolSearch.sqlite-shm"), "utf8"),
    ).toBe("ToolSearch.sqlite-shm");
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
