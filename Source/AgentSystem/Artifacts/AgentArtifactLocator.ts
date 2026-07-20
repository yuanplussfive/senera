import crypto from "node:crypto";
import path from "node:path";
import { z } from "zod";

export const DefaultAgentArtifactRootDir = ".senera/artifacts/runs";
const ArtifactUriProtocol = "senera:";
const ArtifactUriAuthority = "artifact";
const LegacyArtifactUriPrefix = "urn:senera:artifact:";
const SafeSegmentPattern = /^[a-z0-9][a-z0-9._-]*$/;
const ArtifactIdPattern = /^art_[a-f0-9]{24}$/;

export const AgentArtifactFileNames = {
  manifest: "manifest.json",
  input: "input.redacted.json",
  raw: "raw.json",
  rawPreview: "raw.preview.json",
  summary: "summary.md",
  summaryJson: "summary.json",
  evidence: "evidence.json",
  projection: "projection.md",
  delta: "delta.json",
  workspaceBefore: "workspace.before.json",
  workspaceAfter: "workspace.after.json",
  workspaceDiff: "workspace.diff.json",
  workspacePatch: "workspace.patch",
  stdout: "stdout.txt",
  stderr: "stderr.txt",
  workspaceBeforeDir: "workspace/before",
  workspaceAfterDir: "workspace/after",
} as const;

export const AgentArtifactLocatorSchema = z.object({
  artifactId: z.string().min(1),
  artifactUri: z.string().min(1),
  workspaceRoot: z.string().min(1),
  rootDir: z.string().min(1),
  requestId: z.string().min(1),
  step: z.number().int().min(0),
  callIndex: z.number().int().min(0),
  toolName: z.string().min(1),
  argsHash: z.string().min(1),
  resultHash: z.string().min(1),
  absoluteDir: z.string().min(1),
  relativeDir: z.string().min(1),
  files: z.record(z.string(), z.string().min(1)),
});

export type AgentArtifactLocator = z.infer<typeof AgentArtifactLocatorSchema>;
export type AgentArtifactFileName = keyof typeof AgentArtifactFileNames;

export interface AgentArtifactLocatorInput {
  workspaceRoot: string;
  rootDir?: string;
  requestId?: string;
  step: number;
  callIndex?: number;
  toolName: string;
  argsHash: string;
  resultHash: string;
}

export class AgentArtifactPathResolver {
  private readonly workspaceRoot: string;
  private readonly rootDir: string;

  constructor(workspaceRoot: string, rootDir = DefaultAgentArtifactRootDir) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.rootDir = rootDir;
  }

  locate(input: Omit<AgentArtifactLocatorInput, "workspaceRoot">): AgentArtifactLocator {
    return createAgentArtifactLocator({
      ...input,
      workspaceRoot: this.workspaceRoot,
      rootDir: input.rootDir ?? this.rootDir,
    });
  }
}

export function createAgentArtifactLocator(input: AgentArtifactLocatorInput): AgentArtifactLocator {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const rootDir = normalizeRelativeRootDir(input.rootDir ?? DefaultAgentArtifactRootDir);
  const requestId = safePathSegment(input.requestId ?? "anonymous", {
    replacementPrefix: "request",
    hashSource: input.requestId ?? workspaceRoot,
  });
  const toolSegment = safePathSegment(input.toolName, {
    replacementPrefix: "tool",
    hashSource: input.toolName,
  });
  const stepSegment = padPositiveInteger(input.step, 3);
  const callSegment = padPositiveInteger(input.callIndex ?? 1, 3);
  const argsHash = safeHashSegment(input.argsHash);
  const resultHash = safeHashSegment(input.resultHash);
  const artifactId = stableArtifactId({
    requestId,
    step: input.step,
    callIndex: input.callIndex ?? 1,
    toolName: input.toolName,
    argsHash,
    resultHash,
  });
  const relativeDir = toPosixPath(
    path.join(
      rootDir,
      requestId,
      "steps",
      stepSegment,
      "calls",
      `${callSegment}-${toolSegment}-${artifactId.slice(4, 16)}`,
    ),
  );
  const absoluteDir = assertInsideRoot(
    workspaceRoot,
    path.resolve(workspaceRoot, relativeDir),
    `artifact 目录超出工作区：${relativeDir}`,
  );
  const files = Object.fromEntries(
    Object.entries(AgentArtifactFileNames).map(([name, fileName]) => [name, path.join(absoluteDir, fileName)]),
  );

  const locator = {
    artifactId,
    artifactUri: createAgentArtifactUri(artifactId),
    workspaceRoot,
    rootDir,
    requestId,
    step: input.step,
    callIndex: input.callIndex ?? 1,
    toolName: input.toolName,
    argsHash,
    resultHash,
    absoluteDir,
    relativeDir,
    files,
  };

  return AgentArtifactLocatorSchema.parse(locator);
}

export function parseAgentArtifactUri(value: string): string | undefined {
  const canonical = parseCanonicalArtifactUri(value);
  if (canonical) {
    return canonical;
  }

  return parseLegacyArtifactUri(value);
}

export function createAgentArtifactUri(artifactId: string): string {
  assertArtifactId(artifactId);
  return new URL(artifactId, `${ArtifactUriProtocol}//${ArtifactUriAuthority}/`).toString();
}

export function normalizeAgentArtifactUri(value: string): string | undefined {
  const artifactId = parseAgentArtifactUri(value);
  return artifactId ? createAgentArtifactUri(artifactId) : undefined;
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function toWorkspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
  const root = path.resolve(workspaceRoot);
  const target = assertInsideRoot(root, path.resolve(absolutePath), `路径超出工作区：${absolutePath}`);
  return toPosixPath(path.relative(root, target));
}

export function assertInsideRoot(rootPath: string, targetPath: string, message: string): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return target;
  }

  throw new Error(message);
}

export function safePathSegment(
  value: string,
  options: {
    replacementPrefix: string;
    hashSource?: string;
  },
): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const ascii = normalized.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const bounded = ascii.slice(0, 64).replace(/[._-]+$/g, "");

  if (bounded && SafeSegmentPattern.test(bounded) && bounded !== "." && bounded !== "..") {
    return bounded;
  }

  return `${options.replacementPrefix}-${hashText(options.hashSource ?? value).slice(0, 12)}`;
}

export function safeHashSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-f0-9]/g, "");
  return normalized.length > 0 ? normalized.slice(0, 32) : hashText(value).slice(0, 16);
}

function stableArtifactId(input: {
  requestId: string;
  step: number;
  callIndex: number;
  toolName: string;
  argsHash: string;
  resultHash: string;
}): string {
  const hash = hashText(JSON.stringify(input)).slice(0, 24);
  return `art_${hash}`;
}

function parseCanonicalArtifactUri(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== ArtifactUriProtocol || url.hostname !== ArtifactUriAuthority) {
      return undefined;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 1 || url.search || url.hash) {
      return undefined;
    }

    const artifactId = decodeURIComponent(parts[0] ?? "");
    return isArtifactId(artifactId) ? artifactId : undefined;
  } catch {
    return undefined;
  }
}

function parseLegacyArtifactUri(value: string): string | undefined {
  if (!value.startsWith(LegacyArtifactUriPrefix)) {
    return undefined;
  }

  const artifactId = value.slice(LegacyArtifactUriPrefix.length);
  return isArtifactId(artifactId) ? artifactId : undefined;
}

function assertArtifactId(value: string): void {
  if (!isArtifactId(value)) {
    throw new Error(`artifactId 格式无效：${value}`);
  }
}

function isArtifactId(value: string): boolean {
  return ArtifactIdPattern.test(value);
}

function hashText(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function padPositiveInteger(value: number, width: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`路径序号必须是非负整数：${value}`);
  }

  return String(value).padStart(width, "0");
}

function normalizeRelativeRootDir(value: string): string {
  const normalized = path.normalize(value);
  if (path.isAbsolute(normalized)) {
    throw new Error(`artifact 根目录必须是工作区内相对路径：${value}`);
  }

  const safe = normalized
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
  if (!safe || safe.split("/").some((segment) => segment === "..")) {
    throw new Error(`artifact 根目录无效：${value}`);
  }

  return safe;
}
