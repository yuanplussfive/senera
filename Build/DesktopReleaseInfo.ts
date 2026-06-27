import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export const DesktopReleaseVersionEnv = "SENERA_DESKTOP_VERSION";
export const DesktopReleaseBuildNumberEnv = "SENERA_DESKTOP_BUILD_NUMBER";
export const DesktopReleaseShaEnv = "SENERA_DESKTOP_RELEASE_SHA";

export interface DesktopReleaseInfo {
  baseVersion: string;
  version: string;
  tag: string;
  releaseName: string;
  artifactName: string;
  artifactPath: string;
  sourceSha: string;
}

export interface DesktopReleaseInfoInput {
  workspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export function readDesktopReleaseInfo(input: DesktopReleaseInfoInput = {}): DesktopReleaseInfo {
  const workspaceRoot = input.workspaceRoot ?? process.cwd();
  const env = input.env ?? process.env;
  return createDesktopReleaseInfo({
    baseVersion: readRootPackageVersion(workspaceRoot),
    env,
  });
}

export function createDesktopReleaseInfo(input: {
  baseVersion: string;
  env?: NodeJS.ProcessEnv;
}): DesktopReleaseInfo {
  const env = input.env ?? process.env;
  const baseVersion = assertDesktopReleaseVersion(input.baseVersion);
  const explicitVersion = readOptionalText(env[DesktopReleaseVersionEnv]);
  const version = explicitVersion
    ? assertDesktopReleaseVersion(explicitVersion)
    : createCiDesktopVersion(baseVersion, env);
  const sourceSha = readOptionalText(env[DesktopReleaseShaEnv]) ?? readOptionalText(env.GITHUB_SHA) ?? "";

  return {
    baseVersion,
    version,
    tag: `desktop-v${version}`,
    releaseName: `Senera Desktop v${version}`,
    artifactName: `SeneraSetup-${version}.exe`,
    artifactPath: `Release/SeneraSetup-${version}.exe`,
    sourceSha,
  };
}

export function readDesktopPackageVersionOverride(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = readOptionalText(env[DesktopReleaseVersionEnv]);
  return value ? assertDesktopReleaseVersion(value) : undefined;
}

export function assertDesktopReleaseVersion(value: string): string {
  parseThreePartVersion(value);
  return value;
}

export function writeGitHubOutputs(info: DesktopReleaseInfo, env: NodeJS.ProcessEnv = process.env): void {
  const outputPath = readOptionalText(env.GITHUB_OUTPUT);
  if (!outputPath) {
    return;
  }

  const outputs: Record<string, string> = {
    version: info.version,
    tag: info.tag,
    release_name: info.releaseName,
    artifact_name: info.artifactName,
    artifact_path: info.artifactPath,
    source_sha: info.sourceSha,
  };

  fs.appendFileSync(
    outputPath,
    Object.entries(outputs).map(([name, value]) => `${name}=${assertSingleLineOutput(value)}\n`).join(""),
    "utf8",
  );
}

function createCiDesktopVersion(baseVersion: string, env: NodeJS.ProcessEnv): string {
  const base = parseThreePartVersion(baseVersion);
  const buildNumber = readBuildNumber(env);
  if (buildNumber === undefined) {
    return baseVersion;
  }
  return `${base.major}.${base.minor}.${buildNumber}`;
}

function readRootPackageVersion(workspaceRoot: string): string {
  const packagePath = path.join(workspaceRoot, "package.json");
  const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as unknown;
  assert.ok(isRecord(parsed), "Root package.json must be a JSON object.");
  return readPackageVersionField(parsed);
}

function readBuildNumber(env: NodeJS.ProcessEnv): number | undefined {
  const raw = readOptionalText(env[DesktopReleaseBuildNumberEnv]) ?? readOptionalText(env.GITHUB_RUN_NUMBER);
  if (!raw) {
    return undefined;
  }
  const buildNumber = parseNonNegativeInteger(raw, DesktopReleaseBuildNumberEnv);
  assert.ok(buildNumber > 0, `${DesktopReleaseBuildNumberEnv} must be greater than zero.`);
  return buildNumber;
}

function parseThreePartVersion(value: string): ParsedVersion {
  const parts = value.split(".");
  assert.equal(parts.length, 3, `Desktop release version must have three numeric parts: ${value}`);
  return {
    major: parseNonNegativeInteger(parts[0], "major version"),
    minor: parseNonNegativeInteger(parts[1], "minor version"),
    patch: parseNonNegativeInteger(parts[2], "patch version"),
  };
}

function parseNonNegativeInteger(value: string, label: string): number {
  const numberValue = Number(value);
  assert.ok(Number.isInteger(numberValue), `${label} must be an integer: ${value}`);
  assert.ok(numberValue >= 0, `${label} must be non-negative: ${value}`);
  assert.equal(String(numberValue), value, `${label} must be normalized decimal text: ${value}`);
  return numberValue;
}

function readOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function assertSingleLineOutput(value: string): string {
  assert.ok(!value.includes("\n") && !value.includes("\r"), `GitHub output value must be single-line: ${value}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPackageVersionField(value: Record<string, unknown>): string {
  const version = value.version;
  if (typeof version !== "string") {
    throw new TypeError("Root package.json must define a string version.");
  }
  return version;
}

if (require.main === module) {
  const info = readDesktopReleaseInfo();
  writeGitHubOutputs(info);
  console.log(JSON.stringify(info, null, 2));
}
