import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentPluginScanner } from "../../../Source/AgentSystem/Plugin/AgentPluginScanner.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentSystemConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("plugin source revision", () => {
  test("changes when a plugin config is edited externally even when its size is unchanged", () => {
    const workspaceRoot = createTemporaryDirectory("senera-plugin-source-revision");
    temporaryDirectories.push(workspaceRoot);
    const pluginRoot = path.join(workspaceRoot, "Plugins", "Example");
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, "PluginManifest.json"), '{"Plugin":{"Name":"Example"}}', "utf8");
    const configPath = path.join(pluginRoot, "PluginConfig.toml");
    fs.writeFileSync(configPath, "enabled = true \n", "utf8");
    const config = {
      ModelProviders: [],
      Defaults: {
        PluginRoots: { System: [], User: ["./Plugins"] },
      },
    } satisfies AgentSystemConfig;

    const before = AgentPluginScanner.sourceRevision(workspaceRoot, config);
    fs.writeFileSync(configPath, "enabled = false\n", "utf8");
    const after = AgentPluginScanner.sourceRevision(workspaceRoot, config);

    expect(Buffer.byteLength("enabled = true \n")).toBe(Buffer.byteLength("enabled = false\n"));
    expect(after).not.toBe(before);
  });

  test("includes manifest-declared runtime dependencies in the source revision", () => {
    const workspaceRoot = createTemporaryDirectory("senera-plugin-dependency-revision");
    temporaryDirectories.push(workspaceRoot);
    const pluginRoot = path.join(workspaceRoot, "Plugins", "Example");
    fs.mkdirSync(path.join(pluginRoot, "docs"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "Source", "Plugins", "Example"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, "PluginManifest.json"),
      JSON.stringify({
        Plugin: { Name: "Example", Version: "1", Kind: "Tool" },
        Tools: [
          {
            Name: "ExampleTool",
            DescriptionFile: "./docs/Tool.md",
            SignatureFile: "./ToolSignature.ts",
            ArtifactPolicyFile: "./ArtifactPolicy.json",
          },
        ],
        Skills: [{ Name: "ExampleSkill", DescriptionFile: "./docs/Skill.md" }],
        Templates: [{ Name: "ExampleTemplate", Path: "./templates/example.md" }],
        McpServers: [
          {
            Id: "example",
            Transport: "stdio",
            Command: "node",
            Args: ["${runtimeModule:Source/Plugins/Example/index.js}"],
          },
        ],
      }),
      "utf8",
    );
    for (const file of [
      "docs/Tool.md",
      "docs/Skill.md",
      "ToolSignature.ts",
      "ArtifactPolicy.json",
      "templates/example.md",
    ]) {
      const filePath = path.join(pluginRoot, file);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file, "utf8");
    }
    const runtimePath = path.join(workspaceRoot, "Source", "Plugins", "Example", "index.ts");
    const helperPath = path.join(workspaceRoot, "Source", "Plugins", "Example", "helper.ts");
    fs.writeFileSync(runtimePath, 'import { helper } from "./helper.js"; export const version = 1 + helper;', "utf8");
    fs.writeFileSync(helperPath, "export const helper = 1;", "utf8");
    const config = {
      ModelProviders: [],
      Defaults: {
        PluginRoots: { System: [], User: ["./Plugins"] },
      },
    } satisfies AgentSystemConfig;

    const before = AgentPluginScanner.sourceRevision(workspaceRoot, config);
    fs.writeFileSync(path.join(pluginRoot, "ToolSignature.ts"), "changed signature", "utf8");
    const afterSignature = AgentPluginScanner.sourceRevision(workspaceRoot, config);
    fs.writeFileSync(runtimePath, 'import { helper } from "./helper.js"; export const version = 2 + helper;', "utf8");
    const afterRuntime = AgentPluginScanner.sourceRevision(workspaceRoot, config);
    fs.writeFileSync(helperPath, "export const helper = 2;", "utf8");
    const afterHelper = AgentPluginScanner.sourceRevision(workspaceRoot, config);

    expect(afterSignature).not.toBe(before);
    expect(afterRuntime).not.toBe(afterSignature);
    expect(afterHelper).not.toBe(afterRuntime);
  });
});
