import assert from "node:assert/strict";
import {
  DesktopReleaseBuildNumberEnv,
  DesktopReleaseShaEnv,
  DesktopReleaseVersionEnv,
  createDesktopReleaseInfo,
} from "../Build/DesktopReleaseInfo.js";

const ciInfo = createDesktopReleaseInfo({
  baseVersion: "1.2.3",
  env: {
    [DesktopReleaseBuildNumberEnv]: "45",
    [DesktopReleaseShaEnv]: "abcdef1234567890",
  },
});

assert.deepEqual(ciInfo, {
  baseVersion: "1.2.3",
  version: "1.2.45",
  tag: "desktop-v1.2.45",
  releaseName: "Senera Desktop v1.2.45",
  artifactName: "SeneraSetup-1.2.45.exe",
  artifactPath: "Release/SeneraSetup-1.2.45.exe",
  sourceSha: "abcdef1234567890",
});

const explicitInfo = createDesktopReleaseInfo({
  baseVersion: "1.2.3",
  env: {
    [DesktopReleaseVersionEnv]: "2.0.7",
    [DesktopReleaseBuildNumberEnv]: "45",
  },
});

assert.equal(explicitInfo.version, "2.0.7");
assert.equal(explicitInfo.tag, "desktop-v2.0.7");
assert.equal(explicitInfo.artifactName, "SeneraSetup-2.0.7.exe");

assert.throws(() => createDesktopReleaseInfo({
  baseVersion: "1.2.3",
  env: {
    [DesktopReleaseVersionEnv]: "2.0",
  },
}));

assert.throws(() => createDesktopReleaseInfo({
  baseVersion: "1.2.3",
  env: {
    [DesktopReleaseBuildNumberEnv]: "0045",
  },
}));

console.log("Desktop release info verification passed.");
