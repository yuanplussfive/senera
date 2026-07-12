import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import semver from "semver";
import { isMainModule } from "../Source/AgentSystem/Core/AgentPath.js";

export const ProductReleaseTagEnv = "SENERA_RELEASE_TAG";
export const ProductReleaseShaEnv = "SENERA_RELEASE_SHA";

export interface ProductReleaseInfo {
  version: string;
  tag: string;
  releaseName: string;
  desktopArtifactName: string;
  desktopArtifactPath: string;
  containerVersionTag: string;
  containerMinorTag: string;
  sourceSha: string;
}

export interface ProductReleaseInfoInput {
  workspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
}

export function readProductReleaseInfo(input: ProductReleaseInfoInput = {}): ProductReleaseInfo {
  const workspaceRoot = input.workspaceRoot ?? process.cwd();
  const env = input.env ?? process.env;
  return createProductReleaseInfo({
    version: readRootPackageVersion(workspaceRoot),
    tag: readOptionalText(env[ProductReleaseTagEnv]),
    sourceSha: readOptionalText(env[ProductReleaseShaEnv]),
  });
}

export function createProductReleaseInfo(input: {
  version: string;
  tag?: string;
  sourceSha?: string;
}): ProductReleaseInfo {
  const version = assertStableProductVersion(input.version);
  const parsedVersion = semver.parse(version);
  assert.ok(parsedVersion, `Unable to parse normalized product version: ${version}`);
  const tag = `v${version}`;

  if (input.tag !== undefined) {
    assert.equal(
      input.tag,
      tag,
      `Release tag must exactly match the root package version: expected ${tag}, received ${input.tag}`,
    );
  }

  return {
    version,
    tag,
    releaseName: `Senera v${version}`,
    desktopArtifactName: `SeneraSetup-${version}.exe`,
    desktopArtifactPath: `Release/SeneraSetup-${version}.exe`,
    containerVersionTag: version,
    containerMinorTag: `${parsedVersion.major}.${parsedVersion.minor}`,
    sourceSha: input.sourceSha ?? "",
  };
}

export function assertStableProductVersion(value: string): string {
  const normalized = semver.valid(value);
  assert.ok(normalized, `Product version must be valid SemVer: ${value}`);
  assert.equal(normalized, value, `Product version must use normalized SemVer: ${value}`);
  assert.equal(semver.prerelease(value), null, `Stable product version cannot be a prerelease: ${value}`);
  return value;
}

export function writeGitHubOutputs(info: ProductReleaseInfo, env: NodeJS.ProcessEnv = process.env): void {
  const outputPath = readOptionalText(env.GITHUB_OUTPUT);
  if (!outputPath) return;

  const outputs: Record<string, string> = {
    version: info.version,
    tag: info.tag,
    release_name: info.releaseName,
    desktop_artifact_name: info.desktopArtifactName,
    desktop_artifact_path: info.desktopArtifactPath,
    container_version_tag: info.containerVersionTag,
    container_minor_tag: info.containerMinorTag,
    source_sha: info.sourceSha,
  };

  fs.appendFileSync(
    outputPath,
    Object.entries(outputs)
      .map(([name, value]) => `${name}=${assertSingleLineOutput(value)}\n`)
      .join(""),
    "utf8",
  );
}

function readRootPackageVersion(workspaceRoot: string): string {
  const packagePath = path.join(workspaceRoot, "package.json");
  const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as unknown;
  assert.ok(isRecord(parsed), "Root package.json must be a JSON object.");
  const version = parsed.version;
  if (typeof version !== "string") {
    throw new TypeError("Root package.json must define a string version.");
  }
  return version;
}

function readOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function assertSingleLineOutput(value: string): string {
  assert.ok(!value.includes("\n") && !value.includes("\r"), `GitHub output must be single-line: ${value}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (isMainModule(import.meta.url)) {
  const info = readProductReleaseInfo();
  writeGitHubOutputs(info);
  process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
}
