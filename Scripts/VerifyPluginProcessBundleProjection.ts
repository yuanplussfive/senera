import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSeneraProcessRootfsBundle } from "../Source/AgentSystem/Execution/SeneraProcessRootfsBundle.js";

async function main(): Promise<void> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "senera-plugin-bundle-verify-"));
  try {
    const pluginRoot = path.join(tempRoot, "Plugins", "VerifyPlugin");
    const packageRoot = path.join(tempRoot, "Packages", "ToolPluginSdk");
    mkdirSync(path.join(pluginRoot, "node_modules", "leaked"), { recursive: true });
    mkdirSync(path.join(pluginRoot, ".state"), { recursive: true });
    mkdirSync(packageRoot, { recursive: true });
    await writeFile(path.join(pluginRoot, "package.json"), JSON.stringify({
      name: "@senera/plugin-verify",
      dependencies: {
        "@senera/tool-plugin-sdk": "file:../../Packages/ToolPluginSdk",
      },
    }));
    await writeFile(path.join(pluginRoot, "index.js"), "module.exports = true;\n");
    await writeFile(path.join(pluginRoot, "node_modules", "leaked", "index.js"), "leak\n");
    await writeFile(path.join(pluginRoot, ".state", "index.json"), "{}\n");
    await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
      name: "@senera/tool-plugin-sdk",
    }));
    await writeFile(path.join(packageRoot, "index.js"), "exports.ok = true;\n");

    const bundle = await createSeneraProcessRootfsBundle({
      workspaceRoot: tempRoot,
      packageRoot: pluginRoot,
    });
    try {
      assert.equal(existsSync(path.join(bundle.rootPath, "Plugins", "VerifyPlugin", "index.js")), true);
      assert.equal(existsSync(path.join(bundle.rootPath, "Plugins", "VerifyPlugin", "node_modules")), false);
      assert.equal(existsSync(path.join(bundle.rootPath, "Plugins", "VerifyPlugin", ".state")), false);
      assert.equal(
        existsSync(path.join(bundle.rootPath, "node_modules", "@senera", "tool-plugin-sdk", "index.js")),
        true,
      );
      assert.equal(
        await readFile(path.join(bundle.rootPath, "Packages", "ToolPluginSdk", "index.js"), "utf8"),
        "exports.ok = true;\n",
      );
    } finally {
      bundle.cleanup();
    }
    assert.equal(existsSync(bundle.rootPath), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log("Plugin process bundle projection verification passed.");
}

await main();
