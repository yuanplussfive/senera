import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isMissingFileError } from "../Source/AgentSystem/Core/AgentFs.js";

/**
 * The desktop server runs from a single bundled file (`Build/BundleDesktopServer.ts`)
 * instead of the ~5000 compiled modules it used to load. Bundling rewrites
 * `import.meta.url`, `__dirname` and `__filename` so asset reads keep pointing at
 * the module's own directory; this check keeps that rewrite honest.
 */
const workspaceRoot = process.cwd();
const bundlePath = path.join(workspaceRoot, "Dist", "Apps", "Desktop", "DesktopServerProcess.bundle.mjs");
const entryPath = path.join(workspaceRoot, "Dist", "Apps", "Desktop", "DesktopServerProcess.js");

// The bundle is read first and its metadata taken afterwards: a missing build
// then fails on the read itself, and nothing has to assume the file it just
// checked is still there.
const bundle = readBundle();
const bundleStat = fs.statSync(bundlePath);
const entryStat = fs.statSync(entryPath, { throwIfNoEntry: false });
assert.ok(entryStat, `Desktop server entry is missing: ${entryPath}. Run npm run build first.`);
// The bundle is produced after `tsc`, so a stale bundle means the desktop forks
// code that no longer matches the compiled server.
assert.ok(
  bundleStat.mtimeMs >= entryStat.mtimeMs - 1000,
  "Desktop server bundle is older than the compiled server entry. Re-run the build.",
);

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
