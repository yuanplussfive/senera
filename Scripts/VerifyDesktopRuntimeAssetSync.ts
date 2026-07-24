import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { syncRuntimeDirectory } from "../Apps/RuntimeAssetSync.js";
import { createDesktopMicrosandboxRuntimeAccess } from "../Apps/Desktop/DesktopMicrosandboxModuleLoader.js";

const projectRoot = process.cwd();
const rootPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
  build?: {
    extraResources?: Array<{ from?: string; to?: string }>;
    asarUnpack?: string[];
  };
};
const desktopPack = fs.readFileSync(path.join(projectRoot, "Apps", "Desktop", "PackageDesktop.ts"), "utf8");
const desktopRuntime = fs.readFileSync(path.join(projectRoot, "Apps", "Desktop", "DesktopRuntime.ts"), "utf8");
const tempRoot = path.join(process.cwd(), ".senera", "tmp", "verify-desktop-runtime-sync");
fs.mkdirSync(tempRoot, { recursive: true });
const workspaceRoot = fs.mkdtempSync(path.join(tempRoot, "run-"));

try {
  assert.ok(
    !rootPackage.build?.extraResources?.some((resource) => resource.to === "SandboxSeed"),
    "Desktop packages must not ship a copied Microsandbox seed.",
  );
  assert.ok(
    !desktopPack.includes("sandbox.seed"),
    "Desktop packaging must delegate Microsandbox runtime provisioning to the application runtime.",
  );
  assert.ok(
    desktopRuntime.includes("SandboxRuntime"),
    "Desktop runtime must keep Microsandbox state inside application-managed user data.",
  );
  assert.ok(
    rootPackage.build?.asarUnpack?.includes("Dist/Apps/Desktop/DesktopMicrosandboxRuntimeBridge.js"),
    "Desktop packages must unpack the Microsandbox ESM runtime bridge.",
  );
  assert.ok(
    rootPackage.build?.asarUnpack?.includes("node_modules/microsandbox/**/*") &&
      rootPackage.build?.asarUnpack?.includes("node_modules/@superradcompany/microsandbox-*/**/*"),
    "Desktop packages must unpack the official Microsandbox CLI and platform runtime packages.",
  );

  const sourceRoot = path.join(workspaceRoot, "source");
  const targetRoot = path.join(workspaceRoot, "target");

  writeText(path.join(sourceRoot, "AgentDecisionPlugin", "docs", "ToolCalls.md"), "current docs");
  writeText(path.join(sourceRoot, "WeatherToolPlugin", "PluginManifest.json"), "{}");
  writeText(path.join(targetRoot, "AgentDecisionPlugin", "PluginManifest.json"), '{"DecisionActions":[]}');
  writeText(path.join(targetRoot, "AgentDecisionPlugin", "PluginConfig.toml"), "enabled = true");
  writeText(path.join(targetRoot, "AgentDecisionPlugin", "docs", "Old.md"), "old docs");
  writeText(path.join(targetRoot, "RemovedPlugin", "PluginManifest.json"), "{}");
  writeText(path.join(targetRoot, "WeatherToolPlugin", "stale.txt"), "stale");

  syncRuntimeDirectory(sourceRoot, targetRoot, {
    preserveFileNames: ["PluginConfig.toml"],
    pruneExtraneous: true,
  });

  assert.equal(exists(path.join(targetRoot, "AgentDecisionPlugin", "PluginManifest.json")), false);
  assert.equal(readText(path.join(targetRoot, "AgentDecisionPlugin", "PluginConfig.toml")), "enabled = true");
  assert.equal(readText(path.join(targetRoot, "AgentDecisionPlugin", "docs", "ToolCalls.md")), "current docs");
  assert.equal(exists(path.join(targetRoot, "AgentDecisionPlugin", "docs", "Old.md")), false);
  assert.equal(exists(path.join(targetRoot, "RemovedPlugin")), false);
  assert.equal(exists(path.join(targetRoot, "WeatherToolPlugin", "stale.txt")), false);

  const packageSourceRoot = path.join(workspaceRoot, "package-source");
  const packageTargetRoot = path.join(workspaceRoot, "package-target");
  writeText(path.join(packageSourceRoot, "package.json"), "{}");
  writeText(path.join(packageTargetRoot, "generated.cache"), "keep");

  syncRuntimeDirectory(packageSourceRoot, packageTargetRoot);

  assert.equal(readText(path.join(packageTargetRoot, "generated.cache")), "keep");

  await verifyElectronMicrosandboxRuntimeBridge(workspaceRoot);

  console.log("Desktop runtime asset sync verification passed.");
} finally {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}

async function verifyElectronMicrosandboxRuntimeBridge(root: string): Promise<void> {
  const bridgePath = path.join(root, "DesktopMicrosandboxRuntimeBridge.mjs");
  writeText(
    bridgePath,
    [
      "export const loadDesktopMicrosandboxModule = async () => ({ runtime: 'unpacked' });",
      "export const resolveDesktopMicrosandboxPackageEntry = () => new URL('./microsandbox/index.js', import.meta.url).href;",
      "",
    ].join("\n"),
  );
  const runtime = createDesktopMicrosandboxRuntimeAccess(bridgePath);
  const microsandboxModule = await runtime.moduleLoader();
  assert.ok(microsandboxModule && typeof microsandboxModule === "object");
  assert.equal("runtime" in microsandboxModule ? microsandboxModule.runtime : undefined, "unpacked");
  assert.equal(
    await runtime.packageEntryResolver(),
    new URL("./microsandbox/index.js", pathToFileURL(bridgePath)).href,
  );
}

function writeText(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}
