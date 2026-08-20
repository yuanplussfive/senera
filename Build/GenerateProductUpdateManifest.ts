import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isMainModule } from "../Source/AgentSystem/Core/AgentPath.js";
import { readAgentProductMetadata } from "../Source/AgentSystem/Core/AgentProductMetadata.js";
import {
  createAgentRuntimeUpdateOrigin,
  type AgentRuntimeUpdateOrigin,
} from "../Source/AgentSystem/Runtime/AgentRuntimeUpdateOrigin.js";
import { createProductReleaseInfo, readProductReleaseInfo } from "./ProductReleaseInfo.js";

export const ProductUpdateManifestName = "senera-update.json" as const;

if (isMainModule(import.meta.url)) {
  const argumentsMap = readArguments(process.argv.slice(2));
  const outputPath = argumentsMap.output ?? path.join(process.cwd(), ProductUpdateManifestName);
  const installerPath =
    argumentsMap.installer ?? path.join(process.cwd(), "Release", readProductReleaseInfo().desktopArtifactName);
  const info = readProductReleaseInfo({
    env: {
      ...process.env,
      ...(argumentsMap.tag ? { SENERA_RELEASE_TAG: argumentsMap.tag } : {}),
      ...(argumentsMap.sourceSha ? { SENERA_RELEASE_SHA: argumentsMap.sourceSha } : {}),
    },
  });
  const product = readAgentProductMetadata(process.cwd());
  verifyElectronReleaseArtifacts(installerPath);
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(
    path.resolve(outputPath),
    `${JSON.stringify(
      createProductUpdateManifest(info, installerPath, {
        updateOrigin: product.updateOrigin,
        containerImage: argumentsMap.containerImage ?? product.containerImage,
        repository: argumentsMap.repository,
        serverUrl: argumentsMap.serverUrl,
        publishedAt: argumentsMap.publishedAt,
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export function createProductUpdateManifest(
  info: ReturnType<typeof createProductReleaseInfo>,
  installerPath: string,
  options: {
    readonly updateOrigin?: AgentRuntimeUpdateOrigin;
    /** Legacy test and operator override for a GitHub-compatible release host. */
    readonly repository?: string;
    readonly serverUrl?: string;
    readonly containerImage?: string;
    readonly publishedAt?: string;
  } = {},
): Record<string, unknown> {
  const updateOrigin = resolveUpdateOrigin(options);

  const installer = fs.statSync(installerPath);
  const installerName = path.basename(installerPath);
  const installerSha256 = sha256File(installerPath);
  const desktop = createDesktopArtifacts(updateOrigin, info.tag, installerName, installer.size, installerSha256);
  const image = options.containerImage ?? defaultContainerImage(updateOrigin);

  return {
    schemaVersion: 1,
    product: "senera",
    version: info.version,
    tag: info.tag,
    releaseName: info.releaseName,
    releaseUrl: updateOrigin.releaseUrl(info.tag),
    publishedAt: options.publishedAt ?? new Date().toISOString(),
    ...(info.sourceSha ? { sourceSha: info.sourceSha } : {}),
    desktop,
    container: {
      image,
      versionTag: `${image}:${info.containerVersionTag}`,
      latestTag: `${image}:latest`,
    },
  };
}

function createDesktopArtifacts(
  origin: AgentRuntimeUpdateOrigin,
  tag: string,
  installerName: string,
  installerSize: number,
  installerSha256: string,
): Record<string, unknown> {
  return {
    installerUrl: origin.releaseAssetUrl(tag, installerName),
    installerSha256,
    installerSize,
    metadataUrl: origin.releaseAssetUrl(tag, "latest.yml"),
    blockmapUrl: origin.releaseAssetUrl(tag, `${installerName}.blockmap`),
  };
}

function resolveUpdateOrigin(options: Parameters<typeof createProductUpdateManifest>[2]): AgentRuntimeUpdateOrigin {
  if (options?.updateOrigin) return options.updateOrigin;
  const repository = normalizeRepository(options?.repository ?? readRepositoryFromPackage());
  const serverUrl = (options?.serverUrl ?? "https://github.com").replace(/\/$/u, "");
  return createAgentRuntimeUpdateOrigin({
    repositoryUrl: `${serverUrl}/${repository}`,
    trustedRedirectHosts: ["objects.githubusercontent.com", "release-assets.githubusercontent.com"],
  });
}

function defaultContainerImage(origin: AgentRuntimeUpdateOrigin): string {
  const url = new URL(origin.repositoryUrl);
  const repository = url.pathname.split("/").filter(Boolean).slice(-2).join("/").toLowerCase();
  if (!repository) throw new Error("Unable to derive a container image from the GitHub release origin.");
  return `ghcr.io/${repository}`;
}

function readArguments(values: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const name = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for --${name}.`);
    result[name] = next;
    index += 1;
  }
  return result;
}

function normalizeRepository(value: string): string {
  const normalized = value
    .trim()
    .replace(/^https?:\/\/github\.com\//u, "")
    .replace(/\.git$/u, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(normalized)) {
    throw new Error(`Repository must use owner/name form: ${value}`);
  }
  return normalized;
}

function readRepositoryFromPackage(): string {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    repository?: string | { url?: string };
  };
  const value = typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url;
  if (!value) throw new Error("package.json must declare a repository for update manifest generation.");
  return value;
}

function sha256File(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function verifyElectronReleaseArtifacts(installerPath: string): void {
  const resolvedInstallerPath = path.resolve(installerPath);
  const requiredFiles = [
    resolvedInstallerPath,
    `${resolvedInstallerPath}.blockmap`,
    path.join(path.dirname(resolvedInstallerPath), "latest.yml"),
  ];
  const missingFiles = requiredFiles.filter((filePath) => !isRegularFile(filePath));
  if (missingFiles.length > 0) {
    throw new Error(`Electron update artifacts are incomplete: ${missingFiles.join(", ")}`);
  }
}

function isRegularFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
