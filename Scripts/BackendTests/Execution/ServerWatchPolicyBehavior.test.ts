import path from "node:path";
import { describe, expect, it } from "vitest";
import { DevServerWatchedEntries, isDevServerWatchPathIgnored } from "../../../Apps/ServerWatchPolicy.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";

describe("development server watch policy", () => {
  it("watches executable project inputs without treating configuration data as source code", () => {
    expect(DevServerWatchedEntries).toEqual(
      expect.arrayContaining(["Apps", "Source", "System", "Packages", "Build", "package.json"]),
    );
    expect(DevServerWatchedEntries).not.toContain("senera.config.json");
    expect(DevServerWatchedEntries).not.toContain("senera.config.example.json");
  });

  it("leaves MCP packages outside the source watcher", () => {
    const workspaceRoot = path.resolve("workspace");
    expect(
      DevServerWatchedEntries.some((entry) =>
        path.resolve(workspaceRoot, entry).startsWith(path.join(workspaceRoot, "McpServers")),
      ),
    ).toBe(false);
  });

  it("lets runtime revisions hot-reload system Skills without restarting the server", () => {
    const workspaceRoot = path.resolve("workspace");

    expect(
      isDevServerWatchPathIgnored(workspaceRoot, path.join(workspaceRoot, "System", "Skills", "review", "SKILL.md")),
    ).toBe(true);
    expect(isDevServerWatchPathIgnored(workspaceRoot, path.join(workspaceRoot, "System", "Tools", "Tool.json"))).toBe(
      false,
    );
  });

  it("ignores runtime output directories at any depth", () => {
    const workspaceRoot = path.resolve("workspace");

    expect(
      isDevServerWatchPathIgnored(workspaceRoot, resolveAgentWorkspaceLayout(workspaceRoot).databases.config),
    ).toBe(true);
    expect(isDevServerWatchPathIgnored(workspaceRoot, path.join(workspaceRoot, "Source", "dist", "Agent.js"))).toBe(
      true,
    );
    expect(isDevServerWatchPathIgnored(workspaceRoot, path.join(workspaceRoot, "Source", "Agent.ts"))).toBe(false);
  });
});
