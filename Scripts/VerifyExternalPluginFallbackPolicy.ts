import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

interface PluginManifestForVerification {
  Plugin?: {
    Name?: string;
  };
  Security?: {
    TrustLevel?: string;
  };
  Tools?: Array<{
    Name?: string;
    Handler?: {
      Kind?: string;
    };
    Execution?: {
      Boundary?: string;
      LocalFallback?: string;
    };
  }>;
}

async function main(): Promise<void> {
  const manifestPaths = await fg([
    "Plugins/*/PluginManifest.json",
  ], {
    cwd: process.cwd(),
    absolute: true,
  });
  const checkedTools: string[] = [];

  for (const manifestPath of manifestPaths) {
    const manifest = await readJson<PluginManifestForVerification>(manifestPath);
    if (manifest.Security?.TrustLevel !== "External") {
      continue;
    }

    const pluginName = manifest.Plugin?.Name ?? path.basename(path.dirname(manifestPath));
    for (const tool of manifest.Tools ?? []) {
      if (tool.Handler?.Kind === "HostCapability") {
        continue;
      }
      const label = `${pluginName}.${tool.Name ?? "<unnamed>"}`;
      assert.equal(tool.Execution?.Boundary, "Sandbox", `${label}: 外部进程工具必须优先使用 Sandbox。`);
      assert.equal(
        tool.Execution?.LocalFallback,
        "Allow",
        `${label}: 外部进程工具必须允许本地回退，避免桌面端沙箱不可用时直接禁用。`,
      );
      checkedTools.push(label);
    }
  }

  assert.ok(checkedTools.length > 0, "至少需要一个外部进程工具覆盖沙箱回退策略。");
  console.log(`External plugin fallback policy verified (${checkedTools.length} tools).`);
}

async function readJson<TValue>(filePath: string): Promise<TValue> {
  return JSON.parse(await readFile(filePath, "utf8")) as TValue;
}

await main();
