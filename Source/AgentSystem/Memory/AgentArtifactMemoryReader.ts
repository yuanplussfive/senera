import fs from "node:fs/promises";
import path from "node:path";
import {
  assertInsideRoot,
  normalizeAgentArtifactUri,
  parseAgentArtifactUri,
} from "../Artifacts/AgentArtifactLocator.js";
import {
  ArtifactManifestRecord,
  ArtifactMemoryContentItem,
  ArtifactMemoryReadArguments,
  ArtifactMemoryReadResultItem,
  ReadableArtifactRef,
  ReadableArtifactRefDefinitions,
  ReadableArtifactRefs,
} from "./AgentArtifactMemoryTypes.js";
import {
  decodeArtifactMemoryContent,
  truncateUtf8,
} from "./AgentArtifactMemoryProjection.js";

export async function readArtifactMemories(
  args: ArtifactMemoryReadArguments,
  manifests: ReadonlyMap<string, ArtifactManifestRecord>,
  options: {
    workspaceRoot: string;
    artifactRoot: string;
    maxBytes: number;
  },
) {
  const refs = args.refs ?? ["projection"];
  const artifacts = await Promise.all(args.artifactUris.map((uri) =>
    readArtifactMemory(uri, refs, manifests, options)));

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
): Promise<ArtifactMemoryContentItem | undefined> {
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

