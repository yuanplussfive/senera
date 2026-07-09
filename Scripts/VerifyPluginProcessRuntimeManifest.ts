import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

interface PluginManifestForVerification {
  Plugin?: {
    Name?: string;
    Entry?: {
      Kind?: string;
      Command?: string;
      Args?: string[];
      Cwd?: string;
    };
  };
  Runtime?: {
    Kind?: string;
    NodeVersion?: string;
    PackageManager?: string;
    Script?: string;
    SandboxProfile?: string;
  };
  Tools?: Array<{
    Name?: string;
    Execution?: {
      Boundary?: string;
      Network?: string;
      Workspace?: string;
      LocalFallback?: string;
    };
  }>;
  Sandbox?: unknown;
}

interface PackageJsonForVerification {
  scripts?: Record<string, string>;
}

async function main(): Promise<void> {
  const manifestPaths = await fg([
    "System/Plugins/*/PluginManifest.json",
    "Plugins/*/PluginManifest.json",
  ], {
    cwd: process.cwd(),
    absolute: true,
  });

  const processPluginPaths: string[] = [];
  for (const manifestPath of manifestPaths) {
    const manifest = await readJson<PluginManifestForVerification>(manifestPath);
    const entry = manifest.Plugin?.Entry;
    if (!entry) continue;

    processPluginPaths.push(manifestPath);
    const pluginName = manifest.Plugin?.Name ?? path.basename(path.dirname(manifestPath));
    const runtime = manifest.Runtime;

    assert.equal(entry.Kind, "Process", `${pluginName}: Entry.Kind 必须为 Process。`);
    assert.equal(entry.Command, "npm", `${pluginName}: 进程入口必须统一使用 npm。`);
    assert.equal(runtime?.Kind, "Node", `${pluginName}: Runtime.Kind 必须声明为 Node。`);
    assert.equal(runtime?.PackageManager, "npm", `${pluginName}: Runtime.PackageManager 必须声明为 npm。`);
    assert.ok(runtime?.NodeVersion, `${pluginName}: Runtime.NodeVersion 必须声明。`);
    assert.ok(runtime?.SandboxProfile, `${pluginName}: Runtime.SandboxProfile 必须声明。`);
    assert.ok(runtime?.Script, `${pluginName}: Runtime.Script 必须声明。`);
    assert.deepEqual(entry.Args, ["run", runtime.Script], `${pluginName}: Entry.Args 必须匹配 Runtime.Script。`);
    assert.ok(manifest.Sandbox, `${pluginName}: Sandbox 必须声明。`);
    assertProcessToolsDeclareExecution(pluginName, manifest.Tools ?? []);

    const packageJson = await readJson<PackageJsonForVerification>(
      path.join(path.dirname(manifestPath), "package.json"),
    );
    assert.equal(
      typeof packageJson.scripts?.[runtime.Script],
      "string",
      `${pluginName}: package.json scripts.${runtime.Script} 必须存在。`,
    );
  }

  assert.ok(processPluginPaths.length > 0, "至少需要保留一个进程插件来验证进程运行时契约。");
  console.log("Plugin process runtime manifest verification passed.");
}

function assertProcessToolsDeclareExecution(
  pluginName: string,
  tools: readonly NonNullable<PluginManifestForVerification["Tools"]>[number][],
): void {
  assert.ok(tools.length > 0, `${pluginName}: 进程插件必须声明至少一个工具。`);
  for (const tool of tools) {
    const label = `${pluginName}.${tool.Name ?? "<unnamed>"}`;
    assert.match(
      tool.Execution?.Boundary ?? "",
      /^(Local|Sandbox|SandboxPreferred)$/,
      `${label}: Tool.Execution.Boundary 必须声明执行边界。`,
    );
    assert.match(
      tool.Execution?.Network ?? "",
      /^(Allow|Deny)$/,
      `${label}: Tool.Execution.Network 必须显式声明。`,
    );
    assert.match(
      tool.Execution?.Workspace ?? "",
      /^(ReadOnly|ReadWrite)$/,
      `${label}: Tool.Execution.Workspace 必须显式声明。`,
    );
    assert.match(
      tool.Execution?.LocalFallback ?? "",
      /^(Allow|Deny)$/,
      `${label}: Tool.Execution.LocalFallback 必须显式声明。`,
    );
  }
}

async function readJson<TValue>(filePath: string): Promise<TValue> {
  return JSON.parse(await readFile(filePath, "utf8")) as TValue;
}

await main();
