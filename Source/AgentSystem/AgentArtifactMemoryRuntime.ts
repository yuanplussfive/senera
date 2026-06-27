import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AgentHostToolHandler } from "./AgentToolHostCapabilityRegistry.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessRunner.js";
import {
  toolProcessFailureResult,
  toolProcessSuccessResult,
} from "./AgentToolProcessEnvelope.js";
import type { AgentSystemConfig } from "./Types/AgentConfigTypes.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "./AgentXmlStatus.js";
import { throwIfAborted } from "./AgentCancellation.js";
import { resolveArtifactsConfig } from "./AgentDefaults.js";
import {
  AgentArtifactFileNames,
  assertInsideRoot,
  normalizeAgentArtifactUri,
  parseAgentArtifactUri,
  toPosixPath,
} from "./Artifacts/AgentArtifactLocator.js";
import {
  normalizeToolArrayArgument,
  normalizeToolNumberArgument,
} from "./AgentToolArgumentNormalization.js";

const ReadableArtifactRefs = [
  "summary",
  "projection",
  "evidence",
  "delta",
  "raw",
  "workspaceDiff",
  "workspacePatch",
] as const satisfies Array<keyof typeof AgentArtifactFileNames>;

type ReadableArtifactRef = typeof ReadableArtifactRefs[number];

const ReadableArtifactRefDefinitions = {
  summary: {
    file: "summary",
    format: "text",
  },
  projection: {
    file: "projection",
    format: "text",
  },
  evidence: {
    file: "evidence",
    format: "json",
  },
  delta: {
    file: "delta",
    format: "json",
  },
  raw: {
    file: "raw",
    format: "json",
  },
  workspaceDiff: {
    file: "workspaceDiff",
    format: "json",
  },
  workspacePatch: {
    file: "workspacePatch",
    format: "text",
  },
} as const satisfies Record<ReadableArtifactRef, {
  file: keyof typeof AgentArtifactFileNames;
  format: "json" | "text";
}>;

const ArtifactMemoryReadArgumentsSchema = z
  .object({
    artifactUris: z.preprocess(normalizeToolArrayArgument, z.array(z.string().trim().min(1)).min(1)),
    refs: z.preprocess(normalizeToolArrayArgument, z.array(z.enum(ReadableArtifactRefs)).min(1)).optional(),
    maxBytesPerRef: z.preprocess(normalizeToolNumberArgument, z.number().int().positive()).optional(),
  })
  .strict();

type ArtifactMemoryReadArguments = z.infer<typeof ArtifactMemoryReadArgumentsSchema>;

interface ArtifactManifestRecord {
  artifactId: string;
  artifactUri: string;
  files: Record<string, string>;
}

interface ArtifactMemoryReadResultItem {
  artifactUri: string;
  artifactId: string;
  status: "found" | "not_found" | "invalid";
  message: string;
  availableRefs: {
    item: Array<{
      ref: ReadableArtifactRef;
      byteLength: number;
    }>;
  };
  availableRefCount: number;
  memories: {
    item: Array<{
      ref: string;
      content: string;
      byteLength: number;
      truncated: boolean;
    }>;
  };
  memoryCount: number;
}

export const readArtifactMemoryHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = ArtifactMemoryReadArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return artifactMemoryFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: "ArtifactMemoryReadTool 参数无效。",
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        issues: parsed.error.issues,
        toolName: context.tool.name,
      },
      diagnostics: parsed.error.issues.map((issue) => ({
        message: issue.message,
        pointer: `/${issue.path.join("/")}`,
        path: issue.path.map((entry) => typeof entry === "number" ? entry : String(entry)),
      })),
    });
  }

  try {
    throwIfAborted(context.signal);
    const result = await readArtifactMemories(parsed.data, {
      workspaceRoot: context.workspaceRoot,
      rootDir: resolveArtifactsConfig(context.config).RootDir,
      maxBytes: resolveArtifactReadMaxBytes(parsed.data, context.config),
      signal: context.signal,
    });
    return toolProcessSuccessResult(result);
  } catch (error) {
    return artifactMemoryFailure({
      code: AgentExecutionErrorCodes.PluginExecutionError,
      message: error instanceof Error ? error.message : String(error),
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        toolName: context.tool.name,
      },
    });
  }
};

async function readArtifactMemories(
  args: ArtifactMemoryReadArguments,
  options: {
    workspaceRoot: string;
    rootDir: string;
    maxBytes: number;
    signal?: AbortSignal;
  },
) {
  const rootDir = resolveArtifactRoot(options.workspaceRoot, options.rootDir);
  const manifests = await indexArtifactManifests(rootDir, options.workspaceRoot);
  throwIfAborted(options.signal);
  const refs = args.refs ?? ["projection"];
  const artifacts = await Promise.all(args.artifactUris.map((uri) =>
    readArtifactMemory(uri, refs, manifests, {
      workspaceRoot: options.workspaceRoot,
      artifactRoot: rootDir,
      maxBytes: options.maxBytes,
    })));

  return {
    artifacts: {
      item: artifacts,
    },
    guidance: "Use returned memories as evidence for the current turn. Request evidence when structured records are needed.",
  };
}

async function readArtifactMemory(
  requestedUri: string,
  refs: readonly ReadableArtifactRef[],
  manifests: ReadonlyMap<string, ArtifactManifestRecord>,
  options: {
    workspaceRoot: string;
    artifactRoot: string;
    maxBytes: number;
  },
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
  const memories = await Promise.all(refs.map((ref) =>
    readArtifactRef(ref, manifest, options)));
  return {
    artifactUri,
    artifactId,
    status: "found",
    message: "Artifact memory loaded.",
    availableRefs: {
      item: availableRefs,
    },
    availableRefCount: availableRefs.length,
    memories: {
      item: memories.flatMap((entry) => entry ? [entry] : []),
    },
    memoryCount: memories.filter(Boolean).length,
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
  },
): Promise<Array<{ ref: ReadableArtifactRef; byteLength: number }>> {
  const entries = await Promise.all(ReadableArtifactRefs.map(async (ref) => {
    const filePath = readArtifactFilePath(manifest, ref, options.artifactRoot);
    if (!filePath) {
      return undefined;
    }

    try {
      const stat = await fs.stat(filePath);
      return {
        ref,
        byteLength: stat.size,
      };
    } catch {
      return undefined;
    }
  }));
  return entries.filter((entry): entry is { ref: ReadableArtifactRef; byteLength: number } => Boolean(entry));
}

async function readArtifactRef(
  ref: ReadableArtifactRef,
  manifest: ArtifactManifestRecord,
  options: {
    workspaceRoot: string;
    artifactRoot: string;
    maxBytes: number;
  },
): Promise<ArtifactMemoryReadResultItem["memories"]["item"][number] | undefined> {
  const filePath = readArtifactFilePath(manifest, ref, options.artifactRoot);
  if (!filePath) {
    return undefined;
  }

  try {
    const data = await fs.readFile(filePath);
    const content = decodeArtifactMemoryContent(ref, data, {
      workspaceRoot: options.workspaceRoot,
    });
    const contentBytes = Buffer.byteLength(content, "utf8");
    const truncated = contentBytes > options.maxBytes;
    const visible = truncateUtf8(content, options.maxBytes);
    return {
      ref,
      content: truncated ? `${visible}\n[truncated]` : visible,
      byteLength: data.byteLength,
      truncated,
    };
  } catch {
    return undefined;
  }
}

function readArtifactFilePath(
  manifest: ArtifactManifestRecord,
  ref: ReadableArtifactRef,
  artifactRoot: string,
): string | undefined {
  const definition = ReadableArtifactRefDefinitions[ref];
  const filePath = manifest.files[definition.file];
  return filePath
    ? assertInsideRoot(artifactRoot, path.resolve(filePath), `artifact 文件超出 artifact 根目录：${ref}`)
    : undefined;
}

function decodeArtifactMemoryContent(
  ref: ReadableArtifactRef,
  data: Buffer,
  options: {
    workspaceRoot: string;
  },
): string {
  const text = data.toString("utf8");
  if (ReadableArtifactRefDefinitions[ref].format === "text") {
    return text;
  }

  const parsed = JSON.parse(text) as unknown;
  return `${JSON.stringify(projectModelSafeJson(ref, parsed, options.workspaceRoot), null, 2)}\n`;
}

function projectModelSafeJson(
  ref: ReadableArtifactRef,
  value: unknown,
  workspaceRoot: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => projectModelSafeJson(ref, entry, workspaceRoot));
  }

  if (!value || typeof value !== "object") {
    return projectModelSafeScalar(value, workspaceRoot);
  }

  const hiddenFields = ArtifactInternalRoutingFieldsByRef[ref] ?? EmptyArtifactInternalRoutingFields;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
      if (hiddenFields.has(key)) {
        return [];
      }
      return [[key, projectModelSafeJson(ref, entry, workspaceRoot)]];
    }),
  );
}

function projectModelSafeScalar(value: unknown, workspaceRoot: string): unknown {
  if (typeof value !== "string") {
    return value;
  }

  return normalizeLocalAbsolutePath(value, workspaceRoot) ?? value;
}

function normalizeLocalAbsolutePath(value: string, workspaceRoot: string): string | undefined {
  if (!path.isAbsolute(value)) {
    return undefined;
  }

  try {
    const root = path.resolve(workspaceRoot);
    const target = assertInsideRoot(root, path.resolve(value), "path outside workspace");
    const relative = path.relative(root, target);
    return relative ? toPosixPath(relative) : ".";
  } catch {
    return undefined;
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  return Buffer.byteLength(value, "utf8") > maxBytes
    ? Buffer.from(value).subarray(0, maxBytes).toString("utf8")
    : value;
}

async function indexArtifactManifests(
  artifactRoot: string,
  workspaceRoot: string,
): Promise<Map<string, ArtifactManifestRecord>> {
  const manifests = new Map<string, ArtifactManifestRecord>();
  for (const manifestPath of await findManifestFiles(artifactRoot)) {
    const manifest = await readArtifactManifest(manifestPath, workspaceRoot, artifactRoot);
    if (manifest) {
      manifests.set(manifest.artifactId, manifest);
    }
  }
  return manifests;
}

async function findManifestFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...await findManifestFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name === AgentArtifactFileNames.manifest) {
      result.push(entryPath);
    }
  }
  return result;
}

async function readArtifactManifest(
  manifestPath: string,
  workspaceRoot: string,
  artifactRoot: string,
): Promise<ArtifactManifestRecord | undefined> {
  const safeManifestPath = assertInsideRoot(
    artifactRoot,
    path.resolve(manifestPath),
    `manifest 超出 artifact 根目录：${manifestPath}`,
  );
  const value = JSON.parse(await fs.readFile(safeManifestPath, "utf8")) as Record<string, unknown>;
  const artifactId = typeof value.artifactId === "string" ? value.artifactId : "";
  const artifactUri = typeof value.artifactUri === "string" ? value.artifactUri : "";
  const files = value.files && typeof value.files === "object" && !Array.isArray(value.files)
    ? value.files as Record<string, string>
    : {};
  const normalizedUri = normalizeAgentArtifactUri(artifactUri);
  if (!artifactId || !normalizedUri || parseAgentArtifactUri(normalizedUri) !== artifactId) {
    return undefined;
  }
  assertInsideRoot(workspaceRoot, safeManifestPath, `manifest 超出工作区：${manifestPath}`);
  return {
    artifactId,
    artifactUri: normalizedUri,
    files,
  };
}

function resolveArtifactRoot(workspaceRoot: string, rootDir: string): string {
  return assertInsideRoot(
    workspaceRoot,
    path.resolve(workspaceRoot, rootDir),
    `artifact 根目录超出工作区：${rootDir}`,
  );
}

function resolveArtifactReadMaxBytes(
  args: ArtifactMemoryReadArguments,
  config: AgentSystemConfig,
): number {
  const artifacts = resolveArtifactsConfig(config);
  return Math.min(args.maxBytesPerRef ?? artifacts.TextFileMaxBytes, artifacts.TextFileMaxBytes);
}

function artifactMemoryFailure(
  error: NonNullable<AgentToolProcessRunResult["response"]["error"]>,
): AgentToolProcessRunResult {
  return toolProcessFailureResult(error);
}

const EmptyArtifactInternalRoutingFields = new Set<string>();

const ArtifactWrapperInternalRoutingFields = new Set([
  "absoluteDir",
  "absolutePath",
  "artifactPath",
  "files",
  "manifestPath",
  "relativeDir",
  "relativePath",
  "workspaceRoot",
]);

const ArtifactEvidenceInternalFields = new Set([
  ...ArtifactWrapperInternalRoutingFields,
  "key",
  "plannerMemory",
]);

const ArtifactDeltaInternalFields = new Set([
  ...ArtifactWrapperInternalRoutingFields,
  "key",
]);

const ArtifactInternalRoutingFieldsByRef: Partial<Record<ReadableArtifactRef, ReadonlySet<string>>> = {
  delta: ArtifactDeltaInternalFields,
  evidence: ArtifactEvidenceInternalFields,
  workspaceDiff: ArtifactWrapperInternalRoutingFields,
};
