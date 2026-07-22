import { describe, expect, test } from "vitest";
import { AgentPluginRegistry } from "../../../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import { PluginManifestSchema } from "../../../Source/AgentSystem/Schemas/PluginManifestSchema.js";
import type { LoadedPlugin } from "../../../Source/AgentSystem/Types/PluginRuntimeTypes.js";

describe("plugin discovery source behavior", () => {
  test("merges matching source ids contributed by multiple plugins", () => {
    const registry = new AgentPluginRegistry();
    registry.registerPlugin(plugin("WorkspaceReaderPlugin"));
    registry.registerPlugin(plugin("WorkspaceWriterPlugin"));

    expect(registry.listDiscoverySources()).toEqual([
      {
        id: "workspace",
        title: "Workspace",
        description: "Files and source code in the current workspace.",
        pluginNames: ["WorkspaceReaderPlugin", "WorkspaceWriterPlugin"],
      },
    ]);
  });

  test("rejects conflicting metadata for the same source id", () => {
    const registry = new AgentPluginRegistry();
    registry.registerPlugin(plugin("WorkspaceReaderPlugin"));

    expect(() => registry.registerPlugin(plugin("ConflictingPlugin", "Project Files"))).toThrowError(
      /Discovery source workspace has conflicting metadata/u,
    );
  });

  test("rejects duplicate declarations and undeclared tool source references", () => {
    const manifest = {
      ManifestVersion: 2,
      Contracts: { File: "./ToolContracts.json" },
      Plugin: { Name: "FixturePlugin", Version: "1.0.0", Kind: "Tool" },
      Discovery: {
        Sources: [
          {
            Id: "workspace",
            Title: "Workspace",
            Description: "Files and source code in the current workspace.",
          },
        ],
      },
      Tools: [
        {
          Name: "FixtureTool",
          Handler: { Kind: "HostCapability", Capability: "fixture" },
          Execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
          Runtime: { Lifecycle: "Immediate", ProtocolVersion: 2 },
          Search: { SourceIds: ["web"] },
        },
      ],
    };

    expect(PluginManifestSchema.safeParse(manifest).success).toBe(false);
    expect(
      PluginManifestSchema.safeParse({
        ...manifest,
        Tools: [],
        Discovery: {
          Sources: [manifest.Discovery.Sources[0], manifest.Discovery.Sources[0]],
        },
      }).success,
    ).toBe(false);
  });
});

function plugin(name: string, sourceTitle = "Workspace"): LoadedPlugin {
  return {
    rootPath: "",
    rootKind: "System",
    manifestPath: "",
    config: {
      fileName: "PluginConfig.toml",
      path: "",
      exists: false,
      source: "default",
      templateExists: false,
      needsUserConfig: false,
      toml: "",
      sections: [],
      runtime: { enabled: true, tools: {} },
      diagnostics: [],
    },
    manifest: {
      ManifestVersion: 2,
      Plugin: {
        Name: name,
        Version: "1.0.0",
        Kind: "Tool",
      },
      Discovery: {
        Sources: [
          {
            Id: "workspace",
            Title: sourceTitle,
            Description: "Files and source code in the current workspace.",
          },
        ],
      },
    },
  };
}
