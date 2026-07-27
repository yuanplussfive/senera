import path from "node:path";
import { describe, expect, it } from "vitest";
import { DevServerWatchedEntries, isDevServerWatchPathIgnored } from "../../../Apps/ServerWatchPolicy.js";

describe("development server watch policy", () => {
  it("watches executable project inputs without treating configuration data as source code", () => {
    expect(DevServerWatchedEntries).toEqual(
      expect.arrayContaining(["Apps", "Source", "System", "Plugins", "Packages", "Build", "package.json"]),
    );
    expect(DevServerWatchedEntries).not.toContain("senera.config.json");
    expect(DevServerWatchedEntries).not.toContain("senera.config.example.json");
  });

  it("ignores runtime output directories at any depth", () => {
    const workspaceRoot = path.resolve("workspace");

    expect(isDevServerWatchPathIgnored(workspaceRoot, path.join(workspaceRoot, ".senera", "Config.sqlite"))).toBe(true);
    expect(isDevServerWatchPathIgnored(workspaceRoot, path.join(workspaceRoot, "Source", "dist", "Agent.js"))).toBe(
      true,
    );
    expect(isDevServerWatchPathIgnored(workspaceRoot, path.join(workspaceRoot, "Source", "Agent.ts"))).toBe(false);
  });
});
