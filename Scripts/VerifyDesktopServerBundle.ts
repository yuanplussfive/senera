import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isMissingFileError } from "../Source/AgentSystem/Core/AgentFs.js";
import { isDesktopServerBundleCurrent } from "../Build/BundleDesktopServer.js";

/**
 * The desktop server runs from a single bundled file (`Build/BundleDesktopServer.ts`)
 * instead of separately resolving its application modules. Bundling rewrites
 * `import.meta` anchors so asset reads keep pointing at
 * the module's own directory; this check keeps that rewrite honest.
 */
const workspaceRoot = process.cwd();
const bundlePath = path.join(workspaceRoot, "Dist", "Apps", "Desktop", "DesktopServerProcess.bundle.mjs");
const entryPath = path.join(workspaceRoot, "Dist", "Apps", "Desktop", "DesktopServerProcess.js");

// Reading first gives a missing build an actionable diagnostic.
const bundle = readBundle();
const entryStat = fs.statSync(entryPath, { throwIfNoEntry: false });
assert.ok(entryStat, `Desktop server entry is missing: ${entryPath}. Run npm run build first.`);
// Content digests are authoritative: recompiling identical source can update
// mtimes while correctly reusing the same bundle.
assert.ok(isDesktopServerBundleCurrent(), "Desktop server bundle inputs changed. Re-run the build.");

const bundleDirectory = path.dirname(bundlePath);
const anchors = [...bundle.matchAll(/__seneraModule(?:Url|File|Dir)\("([^"]+)"\)/gu)].map((match) => match[1]);
assert.ok(anchors.length > 0, "Desktop server bundle contains no rewritten module anchors.");

const unresolved = [...new Set(anchors)].filter((anchor) => !fs.existsSync(path.resolve(bundleDirectory, anchor)));
assert.deepEqual(unresolved, [], `Desktop server bundle anchors point at missing paths: ${unresolved.join(", ")}`);

assert.ok(
  bundle.includes("const __seneraBundleDirectory ="),
  "Desktop server bundle is missing the module anchor helpers.",
);

console.log(
  `Desktop server bundle verification passed (${anchors.length} anchors, ${new Set(anchors).size} distinct).`,
);

function readBundle(): string {
  try {
    return fs.readFileSync(bundlePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`Desktop server bundle is missing: ${bundlePath}. Run npm run build first.`, {
        cause: error,
      });
    }
    throw error;
  }
}
