import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  defaultPluginConfigToml,
  readLoadedPluginConfig,
} from "../../../Source/AgentSystem/Plugin/AgentPluginConfig.js";
import { AgentPluginScanner } from "../../../Source/AgentSystem/Plugin/AgentPluginScanner.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentSystemConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("plugin config materialization", () => {
  test("copies an example into a user config without activating the example values", () => {
    const pluginRoot = createTemporaryDirectory("senera-plugin-config-example");
    temporaryDirectories.push(pluginRoot);
    const example = '[senera]\nenabled = true\n\n[service]\napi_key = "replace-me"\n';
    fs.writeFileSync(path.join(pluginRoot, "PluginConfig.example.toml"), example, "utf8");

    const first = readLoadedPluginConfig(pluginRoot, emptyAgentConfig(), { materialize: true });
    expect(first.exists).toBe(true);
    expect(first.source).toBe("example");
    expect(first.needsUserConfig).toBe(true);
    expect(first.toml).toBe(example);
    expect(fs.readFileSync(path.join(pluginRoot, "PluginConfig.toml"), "utf8")).toBe(example);

    const unchanged = readLoadedPluginConfig(pluginRoot, emptyAgentConfig(), { materialize: true });
    expect(unchanged.source).toBe("example");
    expect(unchanged.needsUserConfig).toBe(true);

    fs.writeFileSync(path.join(pluginRoot, "PluginConfig.toml"), example.replace("replace-me", "configured"), "utf8");
    const configured = readLoadedPluginConfig(pluginRoot, emptyAgentConfig(), { materialize: true });
    expect(configured.source).toBe("file");
    expect(configured.needsUserConfig).toBe(false);
  });

  test("writes the minimal framework defaults when no example exists", () => {
    const pluginRoot = createTemporaryDirectory("senera-plugin-config-default");
    temporaryDirectories.push(pluginRoot);

    const loaded = readLoadedPluginConfig(pluginRoot, emptyAgentConfig(), { materialize: true });

    expect(loaded.exists).toBe(true);
    expect(loaded.source).toBe("default");
    expect(loaded.needsUserConfig).toBe(false);
    expect(loaded.toml).toBe(defaultPluginConfigToml());
  });

  test("does not write system-style plugin roots unless materialization is requested", () => {
    const pluginRoot = createTemporaryDirectory("senera-plugin-config-readonly");
    temporaryDirectories.push(pluginRoot);
    fs.writeFileSync(path.join(pluginRoot, "PluginConfig.example.toml"), "[senera]\nenabled = true\n", "utf8");

    const loaded = readLoadedPluginConfig(pluginRoot, emptyAgentConfig());

    expect(loaded.exists).toBe(false);
    expect(loaded.source).toBe("example");
    expect(fs.existsSync(path.join(pluginRoot, "PluginConfig.toml"))).toBe(false);
  });

  test("materializes only user plugins during a scanner pass", () => {
    const workspaceRoot = createTemporaryDirectory("senera-plugin-config-scan");
    temporaryDirectories.push(workspaceRoot);
    const userPluginRoot = writeMinimalPlugin(workspaceRoot, "UserPlugins", "UserExample");
    const systemPluginRoot = writeMinimalPlugin(workspaceRoot, "SystemPlugins", "SystemExample");
    const config = {
      ModelProviders: [],
      Defaults: {
        PluginRoots: {
          System: ["./SystemPlugins"],
          User: ["./UserPlugins"],
        },
      },
    } as AgentSystemConfig;

    new AgentPluginScanner(workspaceRoot, config).scan();

    expect(fs.existsSync(path.join(userPluginRoot, "PluginConfig.toml"))).toBe(true);
    expect(fs.existsSync(path.join(systemPluginRoot, "PluginConfig.toml"))).toBe(false);
  });
});

function emptyAgentConfig(): AgentSystemConfig {
  return {
    ModelProviders: [],
    Defaults: {
      PluginRoots: {
        System: [],
        User: [],
      },
    },
  } as AgentSystemConfig;
}

function writeMinimalPlugin(workspaceRoot: string, rootName: string, pluginName: string): string {
  const pluginRoot = path.join(workspaceRoot, rootName, pluginName);
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, "PluginManifest.json"),
    JSON.stringify({
      ManifestVersion: 2,
      Plugin: { Name: pluginName, Version: "1.0.0", Kind: "Tool" },
    }),
    "utf8",
  );
  fs.writeFileSync(path.join(pluginRoot, "PluginConfig.example.toml"), "[senera]\nenabled = true\n", "utf8");
  return pluginRoot;
}
