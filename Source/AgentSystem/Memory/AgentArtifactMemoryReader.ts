import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import {
  assertInsideRoot,
  normalizeAgentArtifactUri,
  parseAgentArtifactUri,
} from "../Artifacts/AgentArtifactLocator.js";
import {
  type ArtifactManifestRecord,
  type ArtifactManifestContentRecord,
  type ArtifactMemoryContentItem,
  type ArtifactMemoryReadArguments,
  type ArtifactJsonViewRequest,
  type ArtifactMemoryRefReadResult,
  type ArtifactMemoryReadResultItem,
  type ReadableArtifactRef,
  ReadableArtifactRefDefinitions,
  ReadableArtifactRefs,
} from "./AgentArtifactMemoryTypes.js";
import {
  artifactJsonProjectionPolicyHash,
  isArtifactJsonFieldVisibleForModel,
  projectArtifactJsonForModel,
  sliceUtf8Buffer,
  type Utf8RangeSlice,
} from "./AgentArtifactMemoryProjection.js";
import { AgentConcurrencyGate } from "../Core/AgentConcurrencyGate.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { SeneraWorkspaceBoundary } from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";
import type { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import {
  indexArtifactJsonStructure,
  queryArtifactJsonStream,
  type AgentArtifactJsonIndexIdentity,
} from "./AgentArtifactJsonQuery.js";
import { openVerifiedArtifactFile } from "../Artifacts/AgentArtifactIntegrity.js";
import {
  AgentArtifactJsonStructureProtocol,
  createArtifactJsonStructureStream,
} from "../Artifacts/AgentArtifactJsonStructure.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";

export interface AgentArtifactMemoryReadOptions {
  readonly workspaceRoot: string;
  readonly artifactRoot: string;
  readonly maxBytes: number;
  readonly startByte: number;
  readonly maxArtifacts: number;
  readonly maxRefs: number;
  readonly maxConcurrency: number;
  readonly ranges?: ReadonlyMap<ReadableArtifactRef, { maxBytes: number; startByte: number }>;
  readonly signal?: AbortSignal;
  readonly jsonTokenProjector?: AgentTokenProjector;
  readonly jsonTokenLimit?: number;
}

type ArtifactMemoryReadContext = AgentArtifactMemoryReadOptions & {
  readonly concurrency: AgentConcurrencyGate;
  readonly boundary: SeneraWorkspaceBoundary;
  readonly jsonView: ArtifactJsonViewRequest;
};

export class ArtifactMemoryReadRequestLimitError extends AgentBaseError {
  readonly kind = "ArtifactMemoryReadRequestLimitError" as const;

  constructor(
    readonly argumentPath: "artifactUris" | "refs" | "refRanges",
    readonly actual: number,
    readonly limit: number,
  ) {
    super(`${argumentPath} contains ${actual} entries; the configured limit is ${limit}.`);
  }
}

export function assertArtifactMemoryReadRequestWithinLimits(
  args: ArtifactMemoryReadArguments,
  limits: Pick<AgentArtifactMemoryReadOptions, "maxArtifacts" | "maxRefs">,
): void {
  assertPositiveSafeInteger(limits.maxArtifacts, "maxArtifacts");
  assertPositiveSafeInteger(limits.maxRefs, "maxRefs");
  if (args.artifactUris.length > limits.maxArtifacts) {
    throw new ArtifactMemoryReadRequestLimitError("artifactUris", args.artifactUris.length, limits.maxArtifacts);
  }
  const refs = args.refs ?? ["projection"];
  if (refs.length > limits.maxRefs) {
    throw new ArtifactMemoryReadRequestLimitError("refs", refs.length, limits.maxRefs);
  }
  if ((args.refRanges?.length ?? 0) > limits.maxRefs) {
    throw new ArtifactMemoryReadRequestLimitError("refRanges", args.refRanges!.length, limits.maxRefs);
  }
}

export async function readArtifactMemories(
  args: ArtifactMemoryReadArguments,
  manifests: ReadonlyMap<string, ArtifactManifestRecord>,
  options: AgentArtifactMemoryReadOptions,
) {
  assertArtifactMemoryReadRequestWithinLimits(args, options);
  const refs = args.refs ?? ["projection"];
  const context: ArtifactMemoryReadContext = {
    ...options,
    jsonView: args.jsonView ?? { kind: "index" },
    jsonTokenLimit:
      options.jsonTokenLimit === undefined
        ? undefined
        : Math.max(1, Math.floor(options.jsonTokenLimit / Math.max(1, args.artifactUris.length * refs.length))),
    concurrency: new AgentConcurrencyGate(options.maxConcurrency),
    boundary: new SeneraWorkspaceBoundary({ workspaceRoot: options.workspaceRoot, linkPolicy: "deny" }),
  };
  const requestedRanges = new Map(options.ranges);
  for (const range of args.refRanges ?? []) {
    requestedRanges.set(range.ref, {
      maxBytes: range.maxBytes,
      startByte: range.startByte ?? options.startByte,
    });
  }
  const artifacts = await Promise.all(
    args.artifactUris.map((uri) => readArtifactMemory(uri, refs, manifests, { ...context, ranges: requestedRanges })),
  );

  return {
    artifacts: {
      item: artifacts,
    },
    guidance:
      "Use each text byte range once and continue only when complete=false. JSON views are typed: use jsonView.kind=index and its cursor to page top-level structure, then jsonView.kind=query with sourcePath/select and its cursor to retrieve complete array items. Cursors are view-specific and cannot be exchanged. If blockedAtIndex is present, narrow jsonView.select before retrying. unavailable and failed refs are terminal for the same request.",
  };
}

async function readArtifactMemory(
  requestedUri: string,
  refs: readonly ReadableArtifactRef[],
  manifests: ReadonlyMap<string, ArtifactManifestRecord>,
  options: ArtifactMemoryReadContext,
): Promise<ArtifactMemoryReadResultItem> {
  const artifactId = parseAgentArtifactUri(requestedUri);
  if (!artifactId) {
    return emptyArtifactResult({
      artifactUri: requestedUri,
      artifactId: "",
      status: "invalid",
      message: "artifactUri is not a canonical Senera artifact URI.",
    });
  }

  const artifactUri = normalizeAgentArtifactUri(requestedUri) ?? requestedUri;
  const manifest = manifests.get(artifactId);
  if (!manifest) {
    return emptyArtifactResult({
      artifactUri,
      artifactId,
      status: "not_found",
      message: "Artifact manifest was not found in the configured artifact root.",
    });
  }

  const availableRefs = await listAvailableRefs(manifest, options);
  const refReads = await Promise.all(
    refs.map((ref) => {
      const range = options.ranges?.get(ref);
      return readArtifactRef(ref, manifest, {
        ...options,
        maxBytes: range?.maxBytes ?? options.maxBytes,
        startByte: range?.startByte ?? options.startByte,
      });
    }),
  );
  const memories = refReads.flatMap((read) => (read.memory ? [read.memory] : []));
  const unavailableRefCount = refReads.filter((read) => read.result.status === "unavailable").length;
  const failedRefCount = refReads.filter((read) => read.result.status === "failed").length;
  return {
    artifactUri,
    artifactId,
    status: "found",
    message: projectArtifactReadMessage(memories.length, unavailableRefCount, failedRefCount),
    availableRefs: {
      item: availableRefs,
    },
    availableRefCount: availableRefs.length,
    refResults: {
      item: refReads.map((read) => read.result),
    },
    unavailableRefCount,
    failedRefCount,
    memories: {
      item: memories,
    },
    memoryCount: memories.length,
  };
}

function emptyArtifactResult(input: {
  artifactUri: string;
  artifactId: string;
  status: ArtifactMemoryReadResultItem["status"];
  message: string;
}): ArtifactMemoryReadResultItem {
  return {
    ...input,
    availableRefs: {
      item: [],
    },
    availableRefCount: 0,
    refResults: {
      item: [],
    },
    unavailableRefCount: 0,
    failedRefCount: 0,
    memories: {
      item: [],
    },
    memoryCount: 0,
  };
}

async function listAvailableRefs(
  manifest: ArtifactManifestRecord,
  options: {
    artifactRoot: string;
    concurrency: AgentConcurrencyGate;
    boundary: SeneraWorkspaceBoundary;
    signal?: AbortSignal;
  },
): Promise<Array<{ ref: ReadableArtifactRef; byteLength: number; mediaType?: string; sha256?: string }>> {
  const entries = await Promise.all(
    ReadableArtifactRefs.map(async (ref) => {
      const content = manifest.contents?.find((entry) => entry.ref === ref);
      if (!content) {
        return undefined;
      }
      const filePath = await readArtifactFilePath(manifest, ref, options.artifactRoot, options.boundary);
      if (!filePath) {
        return undefined;
      }

      try {
        await options.concurrency.run(() => fs.stat(filePath), options.signal);
        return {
          ref,
          byteLength: content.byteLength,
          mediaType: content.mediaType,
          sha256: content.sha256,
        };
      } catch {
        throwIfAborted(options.signal);
        return undefined;
      }
    }),
  );
  return entries.flatMap((entry) => (entry ? [entry] : []));
}

async function readArtifactRef(
  ref: ReadableArtifactRef,
  manifest: ArtifactManifestRecord,
  options: ArtifactMemoryReadContext,
): Promise<{ result: ArtifactMemoryRefReadResult; memory?: ArtifactMemoryContentItem }> {
  const filePath = await readArtifactFilePath(manifest, ref, options.artifactRoot, options.boundary);
  if (!filePath) {
    return {
      result: {
        ref,
        status: "unavailable",
        message: "The requested ref is not available in this artifact.",
      },
    };
  }

  try {
    const definition = ReadableArtifactRefDefinitions[ref];
    const contentRecord = manifest.contents?.find((content) => content.ref === ref);
    if (!contentRecord) throw new Error("Artifact ref is missing its published content identity.");
    const sourceSha256 = contentRecord.sha256;
    if (definition.format === "text") {
      const memory = await options.concurrency.run(async () => {
        const file = await openVerifiedArtifactFile(options.boundary, filePath, contentRecord, options.signal);
        try {
          return projectArtifactMemoryContent(
            ref,
            await readTextArtifactRange(file, options.startByte, options.maxBytes),
            sourceSha256,
          );
        } finally {
          await file.close();
        }
      }, options.signal);
      return loadedArtifactRef(ref, memory);
    }

    const memory = await options.concurrency.run(async () => {
      switch (options.jsonView.kind) {
        case "index": {
          const sourcePath = options.jsonView.sourcePath ?? [];
          if (sourcePath.length > 0) {
            return readDerivedArtifactJsonIndex(filePath, ref, contentRecord, options.jsonView, options);
          }
          const structure = contentRecord.structure;
          if (!structure) throw new Error("Structured Artifact JSON is missing its published structure index.");
          const structurePath = await readArtifactStructurePath(structure.file, ref, options);
          return readPublishedArtifactJsonIndex(
            filePath,
            structurePath,
            ref,
            contentRecord,
            structure,
            options.jsonView,
            options,
          );
        }
        case "query":
          return readStructuredArtifactQuery(filePath, ref, contentRecord, options.jsonView, options);
      }
    }, options.signal);
    return loadedArtifactRef(ref, memory);
  } catch (error) {
    throwIfAborted(options.signal);
    return failedArtifactRef(ref, errorMessage(error));
  }
}

async function readPublishedArtifactJsonIndex(
  filePath: string,
  structurePath: string,
  ref: ReadableArtifactRef,
  sourceIdentity: ArtifactManifestContentRecord,
  structureIdentity: NonNullable<ArtifactManifestContentRecord["structure"]>,
  request: Extract<ArtifactJsonViewRequest, { kind: "index" }>,
  options: ArtifactMemoryReadContext,
): Promise<ArtifactMemoryContentItem> {
  const source = await openVerifiedArtifactFile(options.boundary, filePath, sourceIdentity, options.signal);
  await source.close();
  const file = await openVerifiedArtifactFile(options.boundary, structurePath, structureIdentity, options.signal);
  try {
    const memory = await indexArtifactJsonStructureMemory({
      openSource: (startByte) => file.createReadStream({ autoClose: false, start: startByte }),
      ref,
      request,
      sourceSha256: sourceIdentity.sha256,
      indexIdentity: { kind: "published_sidecar", contentSha256: structureIdentity.sha256 },
      options,
    });
    return memory;
  } finally {
    await file.close();
  }
}

async function readDerivedArtifactJsonIndex(
  filePath: string,
  ref: ReadableArtifactRef,
  sourceIdentity: ArtifactManifestContentRecord,
  request: Extract<ArtifactJsonViewRequest, { kind: "index" }>,
  options: ArtifactMemoryReadContext,
): Promise<ArtifactMemoryContentItem> {
  const file = await openVerifiedArtifactFile(options.boundary, filePath, sourceIdentity, options.signal);
  const sourcePath = request.sourcePath ?? [];
  try {
    const memory = await indexArtifactJsonStructureMemory({
      openSource: (startByte) =>
        createArtifactJsonStructureStream(file.createReadStream({ autoClose: false }), sourcePath, startByte),
      ref,
      request,
      sourceSha256: sourceIdentity.sha256,
      indexIdentity: {
        kind: "derived_path",
        identitySha256: sha256HexOfCanonicalJson({
          format: AgentArtifactJsonStructureProtocol.type,
          sourceSha256: sourceIdentity.sha256,
          sourcePath,
        }),
      },
      options,
    });
    return memory;
  } finally {
    await file.close();
  }
}

async function indexArtifactJsonStructureMemory(input: {
  openSource: (startByte: number) => import("node:stream").Readable;
  ref: ReadableArtifactRef;
  request: Extract<ArtifactJsonViewRequest, { kind: "index" }>;
  sourceSha256: string;
  indexIdentity: AgentArtifactJsonIndexIdentity;
  options: ArtifactMemoryReadContext;
}): Promise<ArtifactMemoryContentItem> {
  const budget = requireStructuredJsonBudget(input.options);
  const projection = await indexArtifactJsonStructure({
    openSource: input.openSource,
    ref: input.ref,
    request: input.request,
    sourceSha256: input.sourceSha256,
    indexIdentity: input.indexIdentity,
    projectionHash: artifactJsonProjectionPolicyHash(input.ref),
    ...budget,
    includeTopLevelField: (field) => isArtifactJsonFieldVisibleForModel(input.ref, field),
    signal: input.options.signal,
  });
  const sourcePath = input.request.sourcePath ?? [];
  return structuredArtifactMemory(input.ref, input.sourceSha256, projection.content, projection.value, {
    kind: "json_index",
    ...(sourcePath.length > 0 ? { sourcePath: [...sourcePath] } : {}),
    rootType: projection.rootType,
    ...(projection.rootItemCount === undefined ? {} : { rootItemCount: projection.rootItemCount }),
    fieldCount: projection.totalFieldCount,
    startFieldIndex: projection.startFieldIndex,
    returnedFieldCount: projection.returnedFieldCount,
    remainingFieldCount: projection.remainingFieldCount,
    complete: projection.complete,
    ...(projection.nextCursor ? { nextCursor: projection.nextCursor } : {}),
    ...(projection.blockedAtFieldIndex === undefined ? {} : { blockedAtFieldIndex: projection.blockedAtFieldIndex }),
  });
}

async function readStructuredArtifactQuery(
  filePath: string,
  ref: ReadableArtifactRef,
  sourceIdentity: ArtifactManifestContentRecord,
  query: Extract<ArtifactJsonViewRequest, { kind: "query" }>,
  options: ArtifactMemoryReadContext,
): Promise<ArtifactMemoryContentItem> {
  const budget = requireStructuredJsonBudget(options);
  const file = await openVerifiedArtifactFile(options.boundary, filePath, sourceIdentity, options.signal);
  const source = file.createReadStream({ autoClose: false });
  try {
    const projection = await queryArtifactJsonStream({
      source,
      ref,
      query,
      sourceSha256: sourceIdentity.sha256,
      projectionHash: artifactJsonProjectionPolicyHash(ref),
      ...budget,
      projectValue: (value) => projectArtifactJsonForModel(ref, value, options.workspaceRoot),
      signal: options.signal,
    });
    return structuredArtifactMemory(ref, sourceIdentity.sha256, projection.content, projection.value, {
      kind: "json_query",
      sourcePath: projection.sourcePath,
      ...(projection.selectedFields ? { selectedFields: projection.selectedFields } : {}),
      scanned: projection.scanned,
      returned: projection.returned,
      complete: projection.complete,
      ...(projection.nextCursor ? { nextCursor: projection.nextCursor } : {}),
      ...(projection.blockedAtIndex === undefined ? {} : { blockedAtIndex: projection.blockedAtIndex }),
    });
  } finally {
    source.destroy();
    await file.close();
  }
}

function requireStructuredJsonBudget(options: ArtifactMemoryReadContext): {
  tokenProjector: AgentTokenProjector;
  tokenLimit: number;
} {
  if (!options.jsonTokenProjector || options.jsonTokenLimit === undefined) {
    throw new Error("Structured Artifact JSON reads require an active model token budget.");
  }
  return { tokenProjector: options.jsonTokenProjector, tokenLimit: options.jsonTokenLimit };
}

function structuredArtifactMemory(
  ref: ReadableArtifactRef,
  sourceSha256: string | undefined,
  content: string,
  structuredContent: unknown,
  view: NonNullable<ArtifactMemoryContentItem["view"]>,
): ArtifactMemoryContentItem {
  const contentBytes = Buffer.byteLength(content, "utf8");
  return {
    ref,
    ...(sourceSha256 ? { sourceSha256 } : {}),
    view,
    structuredContent,
    range: {
      startByte: 0,
      endByte: contentBytes,
      totalBytes: contentBytes,
      returnedBytes: contentBytes,
      complete: true,
    },
    content,
  };
}

function loadedArtifactRef(
  ref: ReadableArtifactRef,
  memory: ArtifactMemoryContentItem,
): { result: ArtifactMemoryRefReadResult; memory: ArtifactMemoryContentItem } {
  return {
    result: { ref, status: "loaded", message: "Artifact ref loaded." },
    memory,
  };
}

function failedArtifactRef(
  ref: ReadableArtifactRef,
  message = "The requested ref could not be read. Repeating the same read in this turn will not change it.",
): { result: ArtifactMemoryRefReadResult } {
  return {
    result: {
      ref,
      status: "failed",
      message,
    },
  };
}

function projectArtifactReadMessage(memoryCount: number, unavailableRefCount: number, failedRefCount: number): string {
  if (failedRefCount > 0) return "Artifact found; one or more requested refs failed to load.";
  if (unavailableRefCount > 0) return "Artifact found; one or more requested refs are unavailable.";
  return memoryCount > 0 ? "Artifact memory loaded." : "Artifact found; no memory content was loaded.";
}

function projectArtifactMemoryContent(
  ref: ReadableArtifactRef,
  slice: Utf8RangeSlice,
  sourceSha256?: string,
): ArtifactMemoryContentItem {
  const complete = slice.endByte >= slice.totalBytes;
  return {
    ref,
    ...(sourceSha256 ? { sourceSha256 } : {}),
    range: {
      startByte: slice.startByte,
      endByte: slice.endByte,
      totalBytes: slice.totalBytes,
      returnedBytes: slice.endByte - slice.startByte,
      complete,
      nextStartByte: complete ? undefined : slice.endByte,
    },
    content: slice.text,
  };
}

async function readTextArtifactRange(
  file: FileHandle,
  requestedStartByte: number,
  maxBytes: number,
): Promise<Utf8RangeSlice> {
  const totalBytes = (await file.stat()).size;
  const boundedStart = Math.min(totalBytes, Math.max(0, Math.floor(requestedStartByte)));
  const readCapacity = Math.min(totalBytes - boundedStart, Math.max(1, Math.floor(maxBytes)) + 4);
  const buffer = Buffer.allocUnsafe(readCapacity);
  const { bytesRead } = await file.read(buffer, 0, readCapacity, boundedStart);
  const local = sliceUtf8Buffer(buffer.subarray(0, bytesRead), 0, maxBytes);
  return {
    text: local.text,
    startByte: boundedStart + local.startByte,
    endByte: boundedStart + local.endByte,
    totalBytes,
  };
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

async function readArtifactFilePath(
  manifest: ArtifactManifestRecord,
  ref: ReadableArtifactRef,
  artifactRoot: string,
  boundary: SeneraWorkspaceBoundary,
): Promise<string | undefined> {
  const definition = ReadableArtifactRefDefinitions[ref];
  const filePath = manifest.files[definition.file];
  if (!filePath) return undefined;
  return resolveArtifactContentPath(filePath, ref, artifactRoot, boundary);
}

async function readArtifactStructurePath(
  filePath: string,
  ref: ReadableArtifactRef,
  options: Pick<ArtifactMemoryReadContext, "artifactRoot" | "boundary">,
): Promise<string> {
  return resolveArtifactContentPath(filePath, `${ref} structure`, options.artifactRoot, options.boundary);
}

async function resolveArtifactContentPath(
  filePath: string,
  label: string,
  artifactRoot: string,
  boundary: SeneraWorkspaceBoundary,
): Promise<string> {
  const lexicalPath = assertInsideRoot(
    artifactRoot,
    path.resolve(filePath),
    `artifact 文件超出 artifact 根目录：${label}`,
  );
  const resolved = await boundary.resolve(lexicalPath, AgentResourceAccessIntents.Read);
  return assertInsideRoot(artifactRoot, resolved.absolutePath, `artifact 文件的真实路径超出 artifact 根目录：${label}`);
}
