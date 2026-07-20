import fs from "node:fs/promises";
import path from "node:path";
import {
  assertInsideRoot,
  normalizeAgentArtifactUri,
  parseAgentArtifactUri,
} from "../Artifacts/AgentArtifactLocator.js";
import {
  type ArtifactManifestRecord,
  type ArtifactMemoryContentItem,
  type ArtifactMemoryReadArguments,
  type ArtifactMemoryRefReadResult,
  type ArtifactMemoryReadResultItem,
  type ReadableArtifactRef,
  ReadableArtifactRefDefinitions,
  ReadableArtifactRefs,
} from "./AgentArtifactMemoryTypes.js";
import {
  decodeArtifactMemoryContent,
  sliceUtf8Buffer,
  sliceUtf8Range,
  type Utf8RangeSlice,
} from "./AgentArtifactMemoryProjection.js";
import type { AgentArtifactMemoryContentCache } from "./AgentArtifactMemoryContentCache.js";
import { AgentConcurrencyGate } from "../Core/AgentConcurrencyGate.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { SeneraWorkspaceBoundary } from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";

export interface AgentArtifactMemoryReadOptions {
  readonly workspaceRoot: string;
  readonly artifactRoot: string;
  readonly maxBytes: number;
  readonly startByte: number;
  readonly structuredJsonMaxBytes: number;
  readonly maxArtifacts: number;
  readonly maxRefs: number;
  readonly maxConcurrency: number;
  readonly ranges?: ReadonlyMap<ReadableArtifactRef, { maxBytes: number; startByte: number }>;
  readonly contentCache?: AgentArtifactMemoryContentCache;
  readonly signal?: AbortSignal;
}

type ArtifactMemoryReadContext = AgentArtifactMemoryReadOptions & {
  readonly concurrency: AgentConcurrencyGate;
  readonly boundary: SeneraWorkspaceBoundary;
};

export class ArtifactMemoryReadRequestLimitError extends Error {
  readonly kind = "ArtifactMemoryReadRequestLimitError" as const;

  constructor(
    readonly argumentPath: "artifactUris" | "refs" | "refRanges",
    readonly actual: number,
    readonly limit: number,
  ) {
    super(`${argumentPath} contains ${actual} entries; the configured limit is ${limit}.`);
    this.name = "ArtifactMemoryReadRequestLimitError";
  }
}

class ArtifactStructuredContentTooLargeError extends Error {
  constructor(
    readonly sourceByteLength: number,
    readonly limit: number,
  ) {
    super(`Structured JSON source is ${sourceByteLength} bytes; the configured limit is ${limit} bytes.`);
    this.name = "ArtifactStructuredContentTooLargeError";
  }
}

class ArtifactContentChangedDuringReadError extends Error {
  constructor() {
    super("The artifact changed while it was being read. Retry after the writer has committed a stable manifest.");
    this.name = "ArtifactContentChangedDuringReadError";
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
  assertPositiveSafeInteger(options.structuredJsonMaxBytes, "structuredJsonMaxBytes");
  const context: ArtifactMemoryReadContext = {
    ...options,
    concurrency: new AgentConcurrencyGate(options.maxConcurrency),
    boundary: new SeneraWorkspaceBoundary({ workspaceRoot: options.workspaceRoot, linkPolicy: "deny" }),
  };
  const refs = args.refs ?? ["projection"];
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
      "Use each memory range once. Continue loaded ranges only when complete=false, using startBytePerRef=nextStartByte. loaded+complete, unavailable, too_large, and failed are terminal for the same URI/ref/arguments in this turn; do not repeat them. For raw JSON reported as too_large, request rawBlob with byte ranges.",
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
  const oversizedRefCount = refReads.filter((read) => read.result.status === "too_large").length;
  const failedRefCount = refReads.filter((read) => read.result.status === "failed").length;
  return {
    artifactUri,
    artifactId,
    status: "found",
    message: projectArtifactReadMessage(memories.length, unavailableRefCount, oversizedRefCount, failedRefCount),
    availableRefs: {
      item: availableRefs,
    },
    availableRefCount: availableRefs.length,
    refResults: {
      item: refReads.map((read) => read.result),
    },
    unavailableRefCount,
    oversizedRefCount,
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
    oversizedRefCount: 0,
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
      const filePath = await readArtifactFilePath(manifest, ref, options.artifactRoot, options.boundary);
      if (!filePath) {
        return undefined;
      }

      try {
        const stat = await options.concurrency.run(() => fs.stat(filePath), options.signal);
        return {
          ...manifest.contents?.find((content) => content.ref === ref),
          ref,
          byteLength: stat.size,
        };
      } catch {
        throwIfAborted(options.signal);
        return undefined;
      }
    }),
  );
  return entries.filter(
    (entry): entry is { ref: ReadableArtifactRef; byteLength: number; mediaType?: string; sha256?: string } =>
      Boolean(entry),
  );
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
    const sourceSha256 = manifest.contents?.find((content) => content.ref === ref)?.sha256;
    if (definition.format === "text") {
      return loadedArtifactRef(
        ref,
        projectArtifactMemoryContent(
          ref,
          await options.concurrency.run(
            () => readTextArtifactRange(filePath, options.startByte, options.maxBytes, options.boundary),
            options.signal,
          ),
          sourceSha256,
        ),
      );
    }

    const sourceByteLength = await options.concurrency.run(async () => (await fs.stat(filePath)).size, options.signal);
    if (sourceByteLength > options.structuredJsonMaxBytes) {
      return oversizedArtifactRef(ref, sourceByteLength, options.structuredJsonMaxBytes);
    }
    const loader = () =>
      options.concurrency.run(
        () =>
          loadArtifactContent(filePath, ref, options.workspaceRoot, options.structuredJsonMaxBytes, options.boundary),
        options.signal,
      );
    const loaded = options.contentCache
      ? await options.contentCache.load(
          [manifest.artifactId, ref, sourceSha256 ?? filePath, path.resolve(options.workspaceRoot)].join("\u0000"),
          loader,
        )
      : await loader();
    if (!loaded) {
      return failedArtifactRef(ref);
    }
    return loadedArtifactRef(
      ref,
      projectArtifactMemoryContent(
        ref,
        sliceUtf8Range(loaded.content, options.startByte, options.maxBytes),
        sourceSha256,
      ),
    );
  } catch (error) {
    throwIfAborted(options.signal);
    if (error instanceof ArtifactStructuredContentTooLargeError) {
      return oversizedArtifactRef(ref, error.sourceByteLength, error.limit);
    }
    if (error instanceof ArtifactContentChangedDuringReadError) {
      return failedArtifactRef(ref, error.message);
    }
    return failedArtifactRef(ref);
  }
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

function oversizedArtifactRef(
  ref: ReadableArtifactRef,
  sourceByteLength: number,
  structuredJsonMaxBytes: number,
): { result: ArtifactMemoryRefReadResult } {
  const alternativeRef = ref === "raw" ? "rawBlob" : undefined;
  return {
    result: {
      ref,
      status: "too_large",
      message: alternativeRef
        ? "The structured JSON source exceeds the parse budget. Read rawBlob with byte ranges instead."
        : "The structured JSON source exceeds the configured parse budget.",
      sourceByteLength,
      structuredJsonMaxBytes,
      ...(alternativeRef ? { alternativeRef } : {}),
    },
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

function projectArtifactReadMessage(
  memoryCount: number,
  unavailableRefCount: number,
  oversizedRefCount: number,
  failedRefCount: number,
): string {
  if (failedRefCount > 0) return "Artifact found; one or more requested refs failed to load.";
  if (oversizedRefCount > 0) return "Artifact found; one or more requested refs exceed the structured JSON budget.";
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
  filePath: string,
  requestedStartByte: number,
  maxBytes: number,
  boundary: SeneraWorkspaceBoundary,
): Promise<Utf8RangeSlice> {
  const file = (await boundary.openFile(filePath, AgentResourceAccessIntents.Read)).handle;
  try {
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
  } finally {
    await file.close();
  }
}

async function loadArtifactContent(
  filePath: string,
  ref: ReadableArtifactRef,
  workspaceRoot: string,
  maxSourceBytes: number,
  boundary: SeneraWorkspaceBoundary,
): Promise<{ content: string; byteLength: number }> {
  const file = (await boundary.openFile(filePath, AgentResourceAccessIntents.Read)).handle;
  let data: Buffer;
  try {
    const sourceByteLength = (await file.stat()).size;
    if (sourceByteLength > maxSourceBytes) {
      throw new ArtifactStructuredContentTooLargeError(sourceByteLength, maxSourceBytes);
    }
    const buffer = Buffer.allocUnsafe(sourceByteLength);
    let bytesRead = 0;
    while (bytesRead < buffer.byteLength) {
      const read = await file.read(buffer, bytesRead, buffer.byteLength - bytesRead, bytesRead);
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;
    }
    const sentinel = Buffer.allocUnsafe(1);
    const extra = await file.read(sentinel, 0, 1, bytesRead);
    if (extra.bytesRead > 0) {
      const currentByteLength = (await file.stat()).size;
      if (currentByteLength > maxSourceBytes) {
        throw new ArtifactStructuredContentTooLargeError(currentByteLength, maxSourceBytes);
      }
      throw new ArtifactContentChangedDuringReadError();
    }
    data = buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
  const content = decodeArtifactMemoryContent(ref, data, { workspaceRoot });
  return {
    content,
    byteLength: Buffer.byteLength(content, "utf8"),
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
  const lexicalPath = assertInsideRoot(
    artifactRoot,
    path.resolve(filePath),
    `artifact 文件超出 artifact 根目录：${ref}`,
  );
  const resolved = await boundary.resolve(lexicalPath, AgentResourceAccessIntents.Read);
  return assertInsideRoot(artifactRoot, resolved.absolutePath, `artifact 文件的真实路径超出 artifact 根目录：${ref}`);
}
