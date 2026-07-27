import fs from "node:fs";
import path from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "parse5";
import {
  AgentStaticAssetEncodingVariants,
  readAgentStaticAssetSidecarSuffix,
  shouldPrecompressAgentStaticAsset,
  type AgentStaticAssetContentEncoding,
} from "../Source/AgentSystem/WebSocket/AgentStaticAssetEncoding.js";
import { resolveWorkspaceRoot } from "../Scripts/WorkspaceRoot.js";
import { toPosixPath, walkFiles } from "../Scripts/Support/FileWalk.js";

interface FrontendBundleLimits {
  resourceCount: number;
  identityBytes: number;
  gzipBytes: number;
  brotliBytes: number;
}

interface FrontendBundleBudgetGroupPolicy {
  id: string;
  includeEntryDocument?: boolean;
  extends?: string[];
  roots: string[];
  requiredAssets?: FrontendRequiredAssetPolicy[];
  limits: FrontendBundleLimits;
}

interface FrontendRequiredAssetPolicy {
  extension: string;
  minimumCount: number;
}

interface FrontendBundleBudgetPolicy {
  schemaVersion: 3;
  entryDocument: string;
  manifest: string;
  groups: FrontendBundleBudgetGroupPolicy[];
}

interface ViteManifestChunk {
  file: string;
  name?: string;
  src?: string;
  css?: string[];
  assets?: string[];
  imports?: string[];
  dynamicImports?: string[];
  isEntry?: boolean;
  isDynamicEntry?: boolean;
}

type ViteManifest = Record<string, ViteManifestChunk>;

interface HtmlNode {
  nodeName: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
}

interface FrontendBundleMeasurements {
  resourceCount: number;
  identityBytes: number;
  gzipBytes: number;
  brotliBytes: number;
}

const workspaceRoot = resolveWorkspaceRoot(import.meta.url);
const policy = readPolicy(path.join(workspaceRoot, "Build", "FrontendBundleBudget.json"));
const entryDocumentPath = path.resolve(workspaceRoot, policy.entryDocument);
const outputRoot = path.dirname(entryDocumentPath);
const manifest = readManifest(path.resolve(workspaceRoot, policy.manifest), outputRoot);
const precompressedAssetCount = verifyPrecompressedAssets(outputRoot);
const resourcesByGroup = resolveGroupResources(policy, manifest, entryDocumentPath, outputRoot);
const measurementsByGroup = new Map(
  policy.groups.map((group) => [group.id, measureBundle(resourcesByGroup.get(group.id)!)]),
);
const failures = policy.groups.flatMap((group) => [
  ...compareMeasurements(group.id, measurementsByGroup.get(group.id)!, group.limits),
  ...verifyRequiredAssets(group.id, resourcesByGroup.get(group.id)!, group.requiredAssets ?? []),
]);

if (failures.length > 0) {
  throw new Error(`Frontend route bundle budget failed.\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

process.stdout.write(
  `Frontend distribution verified: ${precompressedAssetCount} precompressed assets; ` +
    policy.groups.map((group) => formatGroup(group.id, measurementsByGroup.get(group.id)!)).join("; ") +
    ".\n",
);

function verifyPrecompressedAssets(outputDirectory: string): number {
  let verified = 0;
  for (const resourcePath of walkFiles(outputDirectory)) {
    if (AgentStaticAssetEncodingVariants.some(({ fileSuffix }) => resourcePath.endsWith(fileSuffix))) continue;
    const source = fs.readFileSync(resourcePath);
    if (!shouldPrecompressAgentStaticAsset(resourcePath, source.byteLength)) continue;
    for (const { contentEncoding } of AgentStaticAssetEncodingVariants) {
      const sidecarPath = `${resourcePath}${readAgentStaticAssetSidecarSuffix(contentEncoding)}`;
      if (!fs.existsSync(sidecarPath)) throw new Error(`Precompressed frontend asset is missing: ${sidecarPath}`);
      const sidecar = fs.readFileSync(sidecarPath);
      const decoded = contentEncoding === "br" ? brotliDecompressSync(sidecar) : gunzipSync(sidecar);
      if (!decoded.equals(source)) throw new Error(`Precompressed frontend asset is stale: ${sidecarPath}`);
      verified += 1;
    }
  }
  return verified;
}

function readPolicy(filePath: string): FrontendBundleBudgetPolicy {
  const candidate: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const schemaPath = path.join(path.dirname(filePath), "FrontendBundleBudget.schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
  if (!ajv.validateSchema(schema)) {
    throw new Error(`Invalid frontend bundle budget schema: ${ajv.errorsText(ajv.errors)}`);
  }
  const validate = ajv.compile<FrontendBundleBudgetPolicy>(schema);
  if (!validate(candidate)) {
    throw new Error(`Invalid frontend bundle budget policy: ${ajv.errorsText(validate.errors)}`);
  }
  assertGroupGraph(candidate.groups);
  return candidate;
}

function assertGroupGraph(groups: FrontendBundleBudgetGroupPolicy[]): void {
  const groupsById = new Map<string, FrontendBundleBudgetGroupPolicy>();
  for (const group of groups) {
    if (groupsById.has(group.id)) throw new Error(`Frontend bundle group is duplicated: ${group.id}`);
    groupsById.set(group.id, group);
  }
  const verified = new Set<string>();
  const visit = (groupId: string, ancestry: readonly string[]): void => {
    if (verified.has(groupId)) return;
    const group = groupsById.get(groupId);
    if (!group) throw new Error(`Frontend bundle group is not declared: ${groupId}`);
    if (ancestry.includes(groupId)) {
      throw new Error(`Frontend bundle group inheritance is cyclic: ${[...ancestry, groupId].join(" -> ")}`);
    }
    for (const parentId of group.extends ?? []) visit(parentId, [...ancestry, groupId]);
    verified.add(groupId);
  };
  for (const group of groups) visit(group.id, []);
}

function readManifest(filePath: string, outputRoot: string): ViteManifest {
  assertInsideDirectory(outputRoot, filePath, "Vite manifest");
  const candidate: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`Vite manifest must be an object: ${filePath}`);
  }
  return candidate as ViteManifest;
}

function resolveGroupResources(
  policyValue: FrontendBundleBudgetPolicy,
  manifestValue: ViteManifest,
  documentPath: string,
  outputDirectory: string,
): Map<string, Set<string>> {
  const policiesById = new Map(policyValue.groups.map((group) => [group.id, group]));
  const resourcesByGroup = new Map<string, Set<string>>();
  const resolveResources = (groupId: string): Set<string> => {
    const cached = resourcesByGroup.get(groupId);
    if (cached) return cached;
    const group = policiesById.get(groupId)!;
    const resources = new Set<string>();
    for (const parentId of group.extends ?? []) {
      for (const resource of resolveResources(parentId)) resources.add(resource);
    }
    if (group.includeEntryDocument) {
      for (const resource of readInitialResourcePaths(documentPath, outputDirectory)) resources.add(resource);
    }
    for (const resource of collectManifestResources(manifestValue, group.roots, outputDirectory)) {
      resources.add(resource);
    }
    resourcesByGroup.set(groupId, resources);
    return resources;
  };

  for (const group of policyValue.groups) resolveResources(group.id);
  return resourcesByGroup;
}

function collectManifestResources(
  manifestValue: ViteManifest,
  roots: readonly string[],
  outputDirectory: string,
): Set<string> {
  const resources = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visited.has(key)) return;
    const chunk = manifestValue[key];
    if (!chunk) throw new Error(`Vite manifest import is missing: ${key}`);
    visited.add(key);
    for (const reference of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]) {
      resources.add(resolveOutputResourcePath(reference, outputDirectory));
    }
    for (const importedKey of chunk.imports ?? []) visit(importedKey);
  };
  for (const root of roots) visit(resolveManifestRoot(manifestValue, root));
  return resources;
}

function resolveManifestRoot(manifestValue: ViteManifest, root: string): string {
  const normalizedRoot = normalizePath(root);
  const matches = Object.entries(manifestValue)
    .filter(
      ([key, chunk]) =>
        normalizePath(key) === normalizedRoot ||
        normalizePath(chunk.src ?? "") === normalizedRoot ||
        chunk.name === root,
    )
    .map(([key]) => key);
  if (matches.length !== 1) {
    throw new Error(`Vite manifest root ${root} resolved to ${matches.length} entries; exactly one is required.`);
  }
  return matches[0]!;
}

function readInitialResourcePaths(entryDocumentPath: string, outputRoot: string): string[] {
  const html = fs.readFileSync(entryDocumentPath, "utf8");
  const document = parse(html) as HtmlNode;
  const references = new Set<string>([entryDocumentPath]);
  visitHtml(document, (node) => {
    const attributes = new Map(node.attrs?.map(({ name, value }) => [name, value]) ?? []);
    const reference = readInitialResourceReference(node.nodeName, attributes);
    if (!reference) return;
    const resourcePath = resolveLocalResourcePath(reference, outputRoot);
    if (resourcePath) references.add(resourcePath);
  });
  return [...references].sort((left, right) => left.localeCompare(right));
}

function visitHtml(node: HtmlNode, visitor: (node: HtmlNode) => void): void {
  visitor(node);
  for (const child of node.childNodes ?? []) visitHtml(child, visitor);
}

function readInitialResourceReference(nodeName: string, attributes: Map<string, string>): string | undefined {
  if (nodeName === "script") return attributes.get("src");
  if (nodeName !== "link") return undefined;
  const relations = new Set((attributes.get("rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean));
  return relations.has("modulepreload") || relations.has("stylesheet") ? attributes.get("href") : undefined;
}

function resolveLocalResourcePath(reference: string, outputRoot: string): string | undefined {
  const url = new URL(reference, "https://senera.local/");
  if (url.origin !== "https://senera.local") return undefined;
  return resolveOutputResourcePath(decodeURIComponent(url.pathname).replace(/^\/+/, ""), outputRoot);
}

function resolveOutputResourcePath(reference: string, outputRoot: string): string {
  const candidate = path.resolve(outputRoot, reference);
  assertInsideDirectory(outputRoot, candidate, "Frontend resource");
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new Error(`Frontend resource is missing: ${candidate}`);
  }
  return candidate;
}

function assertInsideDirectory(rootDirectory: string, candidate: string, label: string): void {
  const relative = path.relative(rootDirectory, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside its output root: ${candidate}`);
  }
}

function measureBundle(resourcePaths: ReadonlySet<string>): FrontendBundleMeasurements {
  const measurements: FrontendBundleMeasurements = {
    resourceCount: resourcePaths.size,
    identityBytes: 0,
    gzipBytes: 0,
    brotliBytes: 0,
  };
  for (const resourcePath of resourcePaths) {
    const source = fs.readFileSync(resourcePath);
    measurements.identityBytes += source.byteLength;
    const representationBytes = new Map<AgentStaticAssetContentEncoding, number>();
    for (const { contentEncoding } of AgentStaticAssetEncodingVariants) {
      const sidecarPath = `${resourcePath}${readAgentStaticAssetSidecarSuffix(contentEncoding)}`;
      if (!fs.existsSync(sidecarPath)) {
        if (shouldPrecompressAgentStaticAsset(resourcePath, source.byteLength)) {
          throw new Error(`Precompressed frontend route resource is missing: ${sidecarPath}`);
        }
        representationBytes.set(contentEncoding, source.byteLength);
        continue;
      }
      const sidecar = fs.readFileSync(sidecarPath);
      const decoded = contentEncoding === "br" ? brotliDecompressSync(sidecar) : gunzipSync(sidecar);
      if (!decoded.equals(source)) throw new Error(`Precompressed frontend route resource is stale: ${sidecarPath}`);
      representationBytes.set(contentEncoding, sidecar.byteLength);
    }
    measurements.gzipBytes += representationBytes.get("gzip") ?? source.byteLength;
    measurements.brotliBytes += representationBytes.get("br") ?? source.byteLength;
  }
  return measurements;
}

function compareMeasurements(
  groupId: string,
  measurements: FrontendBundleMeasurements,
  limits: FrontendBundleLimits,
): string[] {
  return (Object.keys(limits) as Array<keyof FrontendBundleLimits>).flatMap((name) =>
    measurements[name] > limits[name] ? [`${groupId}.${name} is ${measurements[name]}, limit is ${limits[name]}`] : [],
  );
}

function verifyRequiredAssets(
  groupId: string,
  resourcePaths: ReadonlySet<string>,
  requiredAssets: readonly FrontendRequiredAssetPolicy[],
): string[] {
  return requiredAssets.flatMap(({ extension, minimumCount }) => {
    const count = [...resourcePaths].filter(
      (resourcePath) => path.extname(resourcePath).toLowerCase() === extension.toLowerCase(),
    ).length;
    return count < minimumCount
      ? [`${groupId} requires at least ${minimumCount} ${extension} assets, found ${count}`]
      : [];
  });
}

function formatGroup(groupId: string, measurements: FrontendBundleMeasurements): string {
  return (
    `${groupId} ${measurements.resourceCount} resources, ${formatBytes(measurements.identityBytes)} identity, ` +
    `${formatBytes(measurements.gzipBytes)} gzip, ${formatBytes(measurements.brotliBytes)} Brotli`
  );
}

function formatBytes(byteLength: number): string {
  return `${(byteLength / 1024).toFixed(1)} KiB`;
}

function normalizePath(value: string): string {
  return toPosixPath(value).replace(/^\.\//, "");
}
