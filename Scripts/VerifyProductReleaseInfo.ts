import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ProductReleaseShaEnv,
  ProductReleaseTagEnv,
  createProductReleaseInfo,
  readProductReleaseInfo,
  writeGitHubOutputs,
} from "../Build/ProductReleaseInfo.js";

const release = createProductReleaseInfo({
  version: "1.2.3",
  tag: "v1.2.3",
  sourceSha: "abcdef1234567890",
});

assert.deepEqual(release, {
  version: "1.2.3",
  tag: "v1.2.3",
  releaseName: "Senera v1.2.3",
  desktopArtifactName: "SeneraSetup-1.2.3.exe",
  desktopArtifactPath: "Release/SeneraSetup-1.2.3.exe",
  containerVersionTag: "1.2.3",
  containerMinorTag: "1.2",
  sandboxBundleArtifactName: "SeneraSandboxBundle-1.0.0-x64.tar.zst",
  sandboxBundleManifestArtifactName: "SeneraSandboxBundleManifest.json",
  sourceSha: "abcdef1234567890",
});

assert.throws(
  () => createProductReleaseInfo({ version: "1.2.3", tag: "desktop-v1.2.3" }),
  /Release tag must exactly match/u,
);
assert.throws(() => createProductReleaseInfo({ version: "1.2" }), /valid SemVer/u);
assert.throws(() => createProductReleaseInfo({ version: "1.2.3-preview.1" }), /cannot be a prerelease/u);

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-release-info-"));
try {
  fs.writeFileSync(path.join(workspaceRoot, "package.json"), JSON.stringify({ version: "2.4.6" }), "utf8");
  const outputPath = path.join(workspaceRoot, "github-output.txt");
  const projected = readProductReleaseInfo({
    workspaceRoot,
    env: {
      [ProductReleaseTagEnv]: "v2.4.6",
      [ProductReleaseShaEnv]: "release-sha",
    },
  });

  writeGitHubOutputs(projected, { GITHUB_OUTPUT: outputPath });
  const outputs = Object.fromEntries(
    fs
      .readFileSync(outputPath, "utf8")
      .trim()
      .split(/\r?\n/u)
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );

  assert.equal(outputs.version, "2.4.6");
  assert.equal(outputs.tag, "v2.4.6");
  assert.equal(outputs.desktop_artifact_name, "SeneraSetup-2.4.6.exe");
  assert.equal(outputs.container_minor_tag, "2.4");
  assert.equal(outputs.sandbox_bundle_artifact_name, "SeneraSandboxBundle-1.0.0-x64.tar.zst");
  assert.equal(outputs.sandbox_bundle_manifest_artifact_name, "SeneraSandboxBundleManifest.json");
  assert.equal(outputs.source_sha, "release-sha");
} finally {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}

console.log("Product release info verification passed.");
