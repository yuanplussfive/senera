import path from "node:path";
import {
  assertInsideRoot,
  normalizeAgentArtifactUri,
  parseAgentArtifactUri,
} from "../Artifacts/AgentArtifactLocator.js";
import { AgentArtifactCompactViewStore } from "../Artifacts/AgentArtifactCompactViewStore.js";
import { openVerifiedArtifactFile } from "../Artifacts/AgentArtifactIntegrity.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { SeneraWorkspaceBoundary } from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";
import { ReadableArtifactRefDefinitions } from "./AgentArtifactMemoryTypes.js";
import type {
  ArtifactMemoryReadArguments,
  ArtifactMemoryReadResultItem,
  ArtifactManifestContentRecord,
  ArtifactManifestRecord,
  ArtifactMemoryReadView,
  ReadableArtifactRef,
} from "./AgentArtifactMemoryTypes.js";

export interface AgentArtifactMemoryReadOptions {
  readonly workspaceRoot: string;
  readonly artifactRoot: string;
  readonly maxArtifacts: number;
  readonly maxConcurrency: number;
  readonly signal?: AbortSignal;
}

type ArtifactMemoryReadContext = AgentArtifactMemoryReadOptions & {
  readonly boundary: SeneraWorkspaceBoundary;
  readonly compactViews: AgentArtifactCompactViewStore;
};

interface ArtifactMemoryContent {
  readonly value: unknown;
  readonly sourceSha256?: string;
  readonly compressionMethod?: "mechanical" | "llm";
  readonly artifactRefs: readonly string[];
}

export class ArtifactMemoryReadRequestLimitError extends AgentBaseError {
  readonly kind = "ArtifactMemoryReadRequestLimitError" as const;

  constructor(
    readonly actual: number,
    readonly limit: number,
  ) {
    super(`artifactUris contains ${actual} entries; the configured limit is ${limit}.`);
  }
}

export function assertArtifactMemoryReadRequestWithinLimits(
  args: ArtifactMemoryReadArguments,
  limits: Pick<AgentArtifactMemoryReadOptions, "maxArtifacts">,
): void {
  if (!Number.isSafeInteger(limits.maxArtifacts) || limits.maxArtifacts < 1) {
    throw new RangeError("maxArtifacts must be a positive safe integer.");
  }
  if (args.artifactUris.length > limits.maxArtifacts) {
    throw new ArtifactMemoryReadRequestLimitError(args.artifactUris.length, limits.maxArtifacts);
  }
}

export async function readArtifactMemories(
  args: ArtifactMemoryReadArguments,
  manifests: ReadonlyMap<string, ArtifactManifestRecord>,
  options: AgentArtifactMemoryReadOptions,
): Promise<{ artifacts: { item: ArtifactMemoryReadResultItem[] } }> {
  assertArtifactMemoryReadRequestWithinLimits(args, options);
  assertPositiveSafeInteger(options.maxConcurrency, "maxConcurrency");
  const context: ArtifactMemoryReadContext = {
    ...options,
    boundary: new SeneraWorkspaceBoundary({ workspaceRoot: options.workspaceRoot, linkPolicy: "deny" }),
    compactViews: new AgentArtifactCompactViewStore(options.workspaceRoot),
  };
  const artifacts = await readArtifactsWithBoundedConcurrency(args.artifactUris, args.view, manifests, context);
  return { artifacts: { item: artifacts } };
}

async function readArtifactsWithBoundedConcurrency(
  artifactUris: readonly string[],
  view: ArtifactMemoryReadView,
  manifests: ReadonlyMap<string, ArtifactManifestRecord>,
  context: ArtifactMemoryReadContext,
): Promise<ArtifactMemoryReadResultItem[]> {
  const results = new Array<ArtifactMemoryReadResultItem>(artifactUris.length);
  let nextIndex = 0;
  const workerCount = Math.min(context.maxConcurrency, artifactUris.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        throwIfAborted(context.signal);
        const index = nextIndex++;
        if (index >= artifactUris.length) return;
        results[index] = await readArtifactMemory(artifactUris[index], view, manifests, context);
      }
    }),
  );
  return results;
}

async function readArtifactMemory(
  requestedUri: string,
  view: ArtifactMemoryReadView,
  manifests: ReadonlyMap<string, ArtifactManifestRecord>,
  options: ArtifactMemoryReadContext,
): Promise<ArtifactMemoryReadResultItem> {
  const artifactId = parseAgentArtifactUri(requestedUri);
  if (!artifactId) {
    return emptyArtifactResult(requestedUri, "", view, "invalid", "artifactUri is not a valid Senera artifact URI.");
  }

  const artifactUri = normalizeAgentArtifactUri(requestedUri) ?? requestedUri;
  const manifest = manifests.get(artifactId);
  if (!manifest) {
    return emptyArtifactResult(
      artifactUri,
      artifactId,
      view,
      "not_found",
      "Artifact manifest was not found in the configured artifact root.",
    );
  }

  try {
    assertManifestIdentity(manifest, artifactId);
    throwIfAborted(options.signal);
    const content =
      view === "full"
        ? await readRawResult(manifest, options)
        : await readCompactResult(artifactUri, manifest, options);
    return {
      artifactUri,
      artifactId,
      status: "found",
      view,
      message: view === "full" ? "Original artifact result loaded." : "Compact artifact result loaded.",
      ...(content.artifactRefs ? { artifactRefs: [...content.artifactRefs] } : {}),
      ...(content.sourceSha256 ? { sourceSha256: content.sourceSha256 } : {}),
      ...(content.compressionMethod ? { compressionMethod: content.compressionMethod } : {}),
      content: content.value,
    };
  } catch (error) {
    throwIfAborted(options.signal);
    return emptyArtifactResult(artifactUri, artifactId, view, "failed", errorMessage(error));
  }
}

async function readRawResult(
  manifest: ArtifactManifestRecord,
  options: ArtifactMemoryReadContext,
): Promise<ArtifactMemoryContent> {
  const raw = await readArtifactFile("raw", manifest, options);
  const result = JSON.parse(raw.text) as unknown;
  const rawResponse = await readOptionalArtifactFile("rawResponse", manifest, options);
  const process: Record<string, unknown> = {
    ...(manifest.process?.exitCode === undefined ? {} : { exitCode: manifest.process.exitCode }),
    ...(manifest.process?.signal === undefined ? {} : { signal: manifest.process.signal }),
  };
  const artifactRefs = ["raw", ...(rawResponse ? ["rawResponse"] : [])];
  const rawResponseValue = rawResponse ? (JSON.parse(rawResponse.text) as unknown) : undefined;
  for (const { ref } of manifest.process?.streams ?? []) {
    throwIfAborted(options.signal);
    process[ref] = (await readArtifactFile(ref, manifest, options)).text;
    artifactRefs.push(ref);
  }
  return {
    value: {
      result,
      ...(Object.keys(process).length > 0 ? { process } : {}),
      ...(manifest.outcome ? { outcome: manifest.outcome } : {}),
      ...(rawResponse ? { rawResponse: rawResponseValue } : {}),
    },
    sourceSha256: raw.identity.sha256,
    artifactRefs: [...new Set(artifactRefs)],
  };
}

async function readCompactResult(
  artifactUri: string,
  manifest: ArtifactManifestRecord,
  options: ArtifactMemoryReadContext,
): Promise<ArtifactMemoryContent> {
  const artifactPath = await resolveArtifactManifestDirectory(manifest, options);
  const priorSummary = await options.compactViews.read(artifactUri, artifactPath);
  const rawIdentity = manifest.contents?.find((entry) => entry.ref === "raw")?.sha256;
  if (priorSummary) {
    return {
      value: priorSummary.summary,
      compressionMethod: "llm",
      artifactRefs: ["raw"],
      ...(rawIdentity ? { sourceSha256: rawIdentity } : {}),
    };
  }

  const compact = await readArtifactFile("summary", manifest, options);
  if (!compact.text.trim()) throw new Error("Artifact does not contain a deterministic compact summary.");
  return {
    value: compact.text,
    compressionMethod: "mechanical",
    sourceSha256: compact.identity.sha256,
    artifactRefs: ["summary"],
  };
}

async function readArtifactFile(
  ref: ReadableArtifactRef,
  manifest: ArtifactManifestRecord,
  options: ArtifactMemoryReadContext,
): Promise<{ text: string; identity: ArtifactManifestContentRecord }> {
  const definition = ReadableArtifactRefDefinitions[ref];
  const filePath = manifest.files[definition.file];
  if (!filePath) throw new Error(`Artifact is missing its ${ref} result.`);
  const identity = manifest.contents?.find((entry) => entry.ref === ref);
  if (!identity) throw new Error(`Artifact manifest is missing the integrity identity for ${ref}.`);
  const resolved = await resolveArtifactContentPath(filePath, ref, options);
  const file = await openVerifiedArtifactFile(options.boundary, resolved, identity, options.signal);
  try {
    return { text: await file.readFile({ encoding: "utf8" }), identity };
  } finally {
    await file.close();
  }
}

async function readOptionalArtifactFile(
  ref: ReadableArtifactRef,
  manifest: ArtifactManifestRecord,
  options: ArtifactMemoryReadContext,
): Promise<{ text: string; identity: ArtifactManifestContentRecord } | undefined> {
  if (!manifest.contents?.some((entry) => entry.ref === ref)) return undefined;
  return readArtifactFile(ref, manifest, options);
}

async function resolveArtifactContentPath(
  filePath: string,
  label: string,
  options: Pick<ArtifactMemoryReadContext, "artifactRoot" | "boundary">,
): Promise<string> {
  const lexicalPath = assertInsideRoot(
    options.artifactRoot,
    path.resolve(filePath),
    `artifact 文件超出 artifact 根目录：${label}`,
  );
  const resolved = await options.boundary.resolve(lexicalPath, AgentResourceAccessIntents.Read);
  return assertInsideRoot(
    options.artifactRoot,
    resolved.absolutePath,
    `artifact 文件的真实路径超出 artifact 根目录：${label}`,
  );
}

async function resolveArtifactManifestDirectory(
  manifest: ArtifactManifestRecord,
  options: Pick<ArtifactMemoryReadContext, "artifactRoot" | "boundary">,
): Promise<string> {
  const manifestPath = manifest.files.manifest;
  if (!manifestPath) throw new Error("Artifact manifest does not declare its published path.");
  const resolved = await resolveArtifactContentPath(manifestPath, "manifest", options);
  const directory = path.dirname(resolved);
  return assertInsideRoot(options.artifactRoot, directory, "artifact 目录超出 artifact 根目录。");
}

function assertManifestIdentity(manifest: ArtifactManifestRecord, artifactId: string): void {
  if (manifest.artifactId !== artifactId || parseAgentArtifactUri(manifest.artifactUri) !== artifactId) {
    throw new Error(`Artifact manifest identity does not match ${artifactId}.`);
  }
}

function emptyArtifactResult(
  artifactUri: string,
  artifactId: string,
  view: ArtifactMemoryReadView,
  status: ArtifactMemoryReadResultItem["status"],
  message: string,
): ArtifactMemoryReadResultItem {
  return { artifactUri, artifactId, status, view, message };
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}
