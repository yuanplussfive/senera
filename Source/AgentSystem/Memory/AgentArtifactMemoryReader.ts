import path from "node:path";
import { assertInsideRoot, parseAgentArtifactUri } from "../Artifacts/AgentArtifactLocator.js";
import { AgentArtifactCompactViewStore } from "../Artifacts/AgentArtifactCompactViewStore.js";
import { openVerifiedArtifactFile } from "../Artifacts/AgentArtifactIntegrity.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { SeneraWorkspaceBoundary } from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";
import { ReadableArtifactRefDefinitions } from "./AgentArtifactMemoryTypes.js";
import {
  ArtifactReadResultProtocol,
  artifactReadRequests,
  type ArtifactReadRequest,
  type ArtifactReadPart,
} from "./AgentArtifactMemoryTypes.js";
import { AgentArtifactResultView, selectAgentArtifactValue } from "../Artifacts/AgentArtifactResultView.js";
import { registerAgentArtifactResource } from "../Resources/AgentResourceRegistry.js";
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
  readonly model?: string;
  readonly tokenLimit?: number;
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
    super(`Artifact read contains ${actual} requests; the configured limit is ${limit}.`);
  }
}

export function assertArtifactMemoryReadRequestWithinLimits(
  args: ArtifactMemoryReadArguments,
  limits: Pick<AgentArtifactMemoryReadOptions, "maxArtifacts">,
): void {
  if (!Number.isSafeInteger(limits.maxArtifacts) || limits.maxArtifacts < 1) {
    throw new RangeError("maxArtifacts must be a positive safe integer.");
  }
  const count = artifactReadRequests(args).length;
  if (count > limits.maxArtifacts) {
    throw new ArtifactMemoryReadRequestLimitError(count, limits.maxArtifacts);
  }
}

export async function readArtifactMemories(
  args: ArtifactMemoryReadArguments,
  manifests: ReadonlyMap<string, ArtifactManifestRecord>,
  options: AgentArtifactMemoryReadOptions,
): Promise<{ type: typeof ArtifactReadResultProtocol; artifacts: { item: ArtifactMemoryReadResultItem[] } }> {
  assertArtifactMemoryReadRequestWithinLimits(args, options);
  assertPositiveSafeInteger(options.maxConcurrency, "maxConcurrency");
  const context: ArtifactMemoryReadContext = {
    ...options,
    boundary: new SeneraWorkspaceBoundary({ workspaceRoot: options.workspaceRoot, linkPolicy: "deny" }),
    compactViews: new AgentArtifactCompactViewStore(options.workspaceRoot),
  };
  const requests = artifactReadRequests(args);
  const artifacts = await readArtifactsWithBoundedConcurrency(
    requests,
    "view" in args ? args.view : undefined,
    manifests,
    context,
  );
  return { type: ArtifactReadResultProtocol, artifacts: { item: artifacts } };
}

async function readArtifactsWithBoundedConcurrency(
  requests: readonly ArtifactReadRequest[],
  view: ArtifactMemoryReadView | undefined,
  manifests: ReadonlyMap<string, ArtifactManifestRecord>,
  context: ArtifactMemoryReadContext,
): Promise<ArtifactMemoryReadResultItem[]> {
  const results = new Array<ArtifactMemoryReadResultItem>(requests.length);
  let nextIndex = 0;
  const workerCount = Math.min(context.maxConcurrency, requests.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        throwIfAborted(context.signal);
        const index = nextIndex++;
        if (index >= requests.length) return;
        const request = requests[index];
        results[index] = await readArtifactMemory(
          request,
          view ??
            (request.view === "structure"
              ? "structure"
              : request.view === "content" || request.paths?.length
                ? "selected"
                : "structure"),
          manifests,
          {
            ...context,
            ...(context.tokenLimit === undefined
              ? {}
              : { tokenLimit: Math.floor(context.tokenLimit / requests.length) }),
          },
        );
      }
    }),
  );
  return results;
}

async function readArtifactMemory(
  request: ArtifactReadRequest,
  view: ArtifactMemoryReadView,
  manifests: ReadonlyMap<string, ArtifactManifestRecord>,
  options: ArtifactMemoryReadContext,
): Promise<ArtifactMemoryReadResultItem> {
  const requestedUri = request.uri;
  const artifactId = parseAgentArtifactUri(requestedUri);
  if (!artifactId) {
    return emptyArtifactResult(requestedUri, "", view, "invalid", "artifactUri is not a valid Senera artifact URI.");
  }

  const manifest = manifests.get(artifactId);
  if (!manifest) {
    return emptyArtifactResult(
      requestedUri,
      artifactId,
      view,
      "not_found",
      "Artifact manifest was not found in the configured artifact root.",
    );
  }

  try {
    assertManifestIdentity(manifest, manifest.artifactId);
    const artifactUri = registerAgentArtifactResource(options.workspaceRoot, {
      artifactId: manifest.artifactId,
      artifactUri: manifest.artifactUri,
      manifestPath: manifest.files.manifest,
    });
    if (artifactId !== manifest.artifactId && artifactId !== parseAgentArtifactUri(artifactUri)) {
      throw new Error("The requested resource does not match the loaded Artifact manifest.");
    }
    throwIfAborted(options.signal);
    const content =
      view === "full"
        ? await readRawResult(manifest, options)
        : view === "compact"
          ? await readCompactResult(manifest.artifactUri, manifest, options)
          : await readSelectedResult(request, manifest, options);
    throwIfAborted(options.signal);
    return {
      requestedUri,
      artifactUri,
      artifactId: manifest.artifactId,
      status: "found",
      view,
      message: `Artifact ${view} view loaded.`,
      ...(content.artifactRefs ? { artifactRefs: [...content.artifactRefs] } : {}),
      ...(content.sourceSha256 ? { sourceSha256: content.sourceSha256 } : {}),
      ...(content.compressionMethod ? { compressionMethod: content.compressionMethod } : {}),
      content: content.value,
      ...(view === "structure" || view === "selected"
        ? { part: request.part ?? "result", availableParts: availableParts(manifest) }
        : {}),
    };
  } catch (error) {
    throwIfAborted(options.signal);
    return {
      ...emptyArtifactResult(requestedUri, artifactId, view, "failed", errorMessage(error)),
      part: request.part ?? "result",
      availableParts: availableParts(manifest),
    };
  }
}

const PartRefs: Readonly<Partial<Record<ArtifactReadPart, ReadableArtifactRef>>> = {
  result: "raw",
  source: "rawResponse",
  summary: "summary",
  stdout: "stdout",
  stderr: "stderr",
  changes: "workspaceDiff",
};

function availableParts(manifest: ArtifactManifestRecord): ArtifactReadPart[] {
  const refs = new Set(manifest.contents?.map((entry) => entry.ref));
  return [
    ...Object.entries(PartRefs).flatMap(([part, ref]) => (refs.has(ref) ? [part as ArtifactReadPart] : [])),
    ...(manifest.process ? ["process" as const] : []),
    ...(manifest.outcome ? ["outcome" as const] : []),
    ...(Array.isArray(manifest.assets) && manifest.assets.length ? ["assets" as const] : []),
  ];
}

async function readSelectedResult(
  request: ArtifactReadRequest,
  manifest: ArtifactManifestRecord,
  options: ArtifactMemoryReadContext,
): Promise<ArtifactMemoryContent> {
  const part = request.part ?? "result";
  const process = part === "process" ? await readProcessResult(manifest, options) : undefined;
  const metadata: Partial<Record<ArtifactReadPart, unknown>> = {
    process: manifest.process ? process?.value : undefined,
    outcome: manifest.outcome,
    assets: manifest.assets ?? [],
  };
  const ref = PartRefs[part];
  if (!ref && metadata[part] === undefined) throw new Error(`Artifact does not contain ${part} metadata.`);
  const source = ref ? await readArtifactFile(ref, manifest, options) : undefined;
  const value: unknown =
    source && ref
      ? ReadableArtifactRefDefinitions[ref].mediaType === "application/json"
        ? (JSON.parse(source.text) as unknown)
        : source.text
      : metadata[part];
  const structure = new AgentArtifactResultView(options.model ?? "");
  const paths = request.paths?.length ? request.paths : request.view === "content" ? [""] : undefined;
  const content = paths?.length
    ? {
        selections: paths.map((pointer) => {
          const selection = selectAgentArtifactValue(value, pointer);
          if (selection.status !== "found" || request.view !== "structure") return selection;
          const projected = structure.structure(
            selection.value,
            Math.floor((options.tokenLimit ?? 0) / paths.length),
            pointer,
          );
          return { ...selection, value: projected.outline, representation: "structure", complete: projected.complete };
        }),
      }
    : {
        representation: "structure",
        ...structure.structure(value, options.tokenLimit ?? 0),
      };
  return {
    value: content,
    artifactRefs: ref ? [ref] : (process?.artifactRefs ?? []),
    ...(source ? { sourceSha256: source.identity.sha256 } : {}),
  };
}

async function readRawResult(
  manifest: ArtifactManifestRecord,
  options: ArtifactMemoryReadContext,
): Promise<ArtifactMemoryContent> {
  const raw = await readArtifactFile("raw", manifest, options);
  const result = JSON.parse(raw.text) as unknown;
  const rawResponse = await readOptionalArtifactFile("rawResponse", manifest, options);
  const process = await readProcessResult(manifest, options);
  const artifactRefs = ["raw", ...(rawResponse ? ["rawResponse"] : []), ...process.artifactRefs];
  const rawResponseValue = rawResponse ? (JSON.parse(rawResponse.text) as unknown) : undefined;
  return {
    value: {
      result,
      ...(Object.keys(process.value).length > 0 ? { process: process.value } : {}),
      ...(manifest.outcome ? { outcome: manifest.outcome } : {}),
      ...(rawResponse ? { rawResponse: rawResponseValue } : {}),
    },
    sourceSha256: raw.identity.sha256,
    artifactRefs: [...new Set(artifactRefs)],
  };
}

async function readProcessResult(manifest: ArtifactManifestRecord, options: ArtifactMemoryReadContext) {
  const value: Record<string, unknown> = {
    ...(manifest.process?.exitCode === undefined ? {} : { exitCode: manifest.process.exitCode }),
    ...(manifest.process?.signal === undefined ? {} : { signal: manifest.process.signal }),
    ...(manifest.process?.streams ? { stdout: "", stderr: "" } : {}),
  };
  const artifactRefs: string[] = [];
  for (const { ref } of manifest.process?.streams ?? []) {
    throwIfAborted(options.signal);
    value[ref] = (await readArtifactFile(ref, manifest, options)).text;
    artifactRefs.push(ref);
  }
  return { value, artifactRefs };
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
  return { requestedUri: artifactUri, artifactUri, artifactId, status, view, message };
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}
