import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createProductUpdateManifest } from "../../../Build/GenerateProductUpdateManifest.js";
import { createProductReleaseInfo } from "../../../Build/ProductReleaseInfo.js";
import { createAgentRuntimeUpdateOrigin } from "../../../Source/AgentSystem/Runtime/AgentRuntimeUpdateOrigin.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("product update manifest", () => {
  test("publishes the installer checksum and differential metadata URLs", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "senera-update-manifest-"));
    temporaryDirectories.push(directory);
    const installerPath = path.join(directory, "SeneraSetup-1.2.3.exe");
    const installerBytes = Buffer.from("installer");
    fs.writeFileSync(installerPath, installerBytes);

    const manifest = createProductUpdateManifest(createProductReleaseInfo({ version: "1.2.3" }), installerPath, {
      repository: "example/senera",
      serverUrl: "https://github.com",
      publishedAt: "2026-08-19T00:00:00.000Z",
    }) as {
      releaseUrl: string;
      desktop: {
        installerUrl: string;
        installerSha256: string;
        installerSize: number;
        metadataUrl: string;
        blockmapUrl: string;
      };
      container: { versionTag: string; latestTag: string };
      sources?: unknown;
    };

    expect(manifest.releaseUrl).toBe("https://github.com/example/senera/releases/tag/v1.2.3");
    expect(manifest.desktop).toEqual({
      installerUrl: "https://github.com/example/senera/releases/download/v1.2.3/SeneraSetup-1.2.3.exe",
      installerSha256: crypto.createHash("sha256").update(installerBytes).digest("hex"),
      installerSize: installerBytes.length,
      metadataUrl: "https://github.com/example/senera/releases/download/v1.2.3/latest.yml",
      blockmapUrl: "https://github.com/example/senera/releases/download/v1.2.3/SeneraSetup-1.2.3.exe.blockmap",
    });
    expect(manifest.container).toEqual({
      image: "ghcr.io/example/senera",
      versionTag: "ghcr.io/example/senera:1.2.3",
      latestTag: "ghcr.io/example/senera:latest",
    });
    expect(manifest).not.toHaveProperty("sources");
  });

  test("projects release assets from the configured GitHub origin", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "senera-update-manifest-"));
    temporaryDirectories.push(directory);
    const installerPath = path.join(directory, "SeneraSetup-1.2.3.exe");
    fs.writeFileSync(installerPath, "installer");
    const updateOrigin = createAgentRuntimeUpdateOrigin({
      repositoryUrl: "https://github.com/example/senera-distribution",
    });

    const manifest = createProductUpdateManifest(createProductReleaseInfo({ version: "1.2.3" }), installerPath, {
      updateOrigin,
    }) as {
      releaseUrl: string;
      desktop: { installerUrl: string; metadataUrl: string };
      sources?: unknown;
    };

    expect(manifest).toMatchObject({
      releaseUrl: "https://github.com/example/senera-distribution/releases/tag/v1.2.3",
      desktop: {
        installerUrl: "https://github.com/example/senera-distribution/releases/download/v1.2.3/SeneraSetup-1.2.3.exe",
        metadataUrl: "https://github.com/example/senera-distribution/releases/download/v1.2.3/latest.yml",
      },
    });
    expect(manifest).not.toHaveProperty("sources");
  });
});
