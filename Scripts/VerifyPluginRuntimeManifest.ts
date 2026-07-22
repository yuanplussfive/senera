import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { inspectPluginToolRuntimeContract } from "../Source/AgentSystem/Types/PluginToolRuntimeContract.js";

interface PluginManifestForVerification {
  ManifestVersion?: number;
  Plugin?: { Name?: string; Entry?: unknown };
  Runtime?: unknown;
  McpServers?: Array<{ Id?: string; Transport?: string; Command?: string }>;
  Tools?: Array<{
    Name?: string;
    Loading?: string;
    Handler?: { Kind?: string; Capability?: string; Server?: string; Tool?: string };
    Runtime?: { Lifecycle?: string; ProtocolVersion?: number };
    Execution?: { Targets?: string[]; Network?: string; Workspace?: string };
  }>;
}

async function main(): Promise<void> {
  const manifestPaths = await fg(["System/Plugins/*/PluginManifest.json", "Plugins/*/PluginManifest.json"], {
    cwd: process.cwd(),
    absolute: true,
  });
  assert.ok(manifestPaths.length > 0, "至少需要一个插件清单。");

  for (const manifestPath of manifestPaths) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PluginManifestForVerification;
    const pluginName = manifest.Plugin?.Name ?? path.basename(path.dirname(manifestPath));
    assert.equal(manifest.ManifestVersion, 2, `${pluginName}: ManifestVersion 必须为 2。`);
    assert.equal(manifest.Plugin?.Entry, undefined, `${pluginName}: 不得继续声明私有进程入口。`);
    assert.equal(manifest.Runtime, undefined, `${pluginName}: 不得继续声明私有进程运行时。`);
    const serverIds = new Set((manifest.McpServers ?? []).map((server) => server.Id));
    for (const server of manifest.McpServers ?? []) {
      assert.equal(server.Transport, "stdio", `${pluginName}.${server.Id}: MCP transport 必须显式声明。`);
      assert.ok(server.Command, `${pluginName}.${server.Id}: MCP command 必须声明。`);
    }
    for (const tool of manifest.Tools ?? []) {
      const label = `${pluginName}.${tool.Name ?? "<unnamed>"}`;
      assert.match(tool.Loading ?? "", /^(Bootstrap|Dynamic)$/, `${label}: Loading 必须显式声明。`);
      assert.match(tool.Handler?.Kind ?? "", /^(HostCapability|McpTool)$/, `${label}: Handler 必须显式声明。`);
      assert.match(
        tool.Runtime?.Lifecycle ?? "",
        /^(Immediate|OneShot|Persistent|RemoteJob)$/,
        `${label}: Runtime.Lifecycle 必须显式声明。`,
      );
      assert.deepEqual(
        inspectPluginToolRuntimeContract({
          handlerKind: tool.Handler?.Kind ?? "",
          lifecycle: tool.Runtime?.Lifecycle ?? "",
          protocolVersion: tool.Runtime?.ProtocolVersion,
        }),
        [],
        `${label}: Handler 与 Runtime 合同不兼容。`,
      );
      assert.ok(
        Array.isArray(tool.Execution?.Targets) && tool.Execution.Targets.length > 0,
        `${label}: Targets 必须非空。`,
      );
      assert.ok(
        tool.Execution?.Targets?.every((target) => target === "Local" || target === "Sandbox"),
        `${label}: Targets 包含不支持的执行目标。`,
      );
      assert.equal(
        new Set(tool.Execution?.Targets).size,
        tool.Execution?.Targets?.length,
        `${label}: Targets 不得重复。`,
      );
      assert.match(tool.Execution?.Network ?? "", /^(Allow|Deny)$/, `${label}: Network 缺失。`);
      assert.match(tool.Execution?.Workspace ?? "", /^(ReadOnly|ReadWrite)$/, `${label}: Workspace 缺失。`);
      if (tool.Handler?.Kind === "HostCapability") {
        assert.ok(tool.Handler.Capability, `${label}: HostCapability 名称缺失。`);
      } else if (tool.Handler?.Kind === "McpTool") {
        assert.ok(serverIds.has(tool.Handler.Server), `${label}: MCP server 未声明：${tool.Handler.Server}`);
        assert.ok(tool.Handler.Tool, `${label}: MCP tool 名称缺失。`);
      }
    }
  }

  console.log("Plugin runtime manifest verification passed.");
}

await main();
