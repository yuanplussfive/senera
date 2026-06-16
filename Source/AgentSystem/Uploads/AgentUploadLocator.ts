import crypto from "node:crypto";
import path from "node:path";
import { assertInsideRoot } from "../Artifacts/AgentArtifactLocator.js";

export const DefaultAgentUploadRootDir = ".senera/uploads";

export const AgentUploadUriSpec = {
  Protocol: "senera:",
  Host: "upload",
} as const;

export const AgentUploadFileNames = {
  Original: "original",
  Manifest: "manifest.json",
} as const;

export function createAgentUploadId(): string {
  return `upl_${crypto.randomBytes(16).toString("hex")}`;
}

export function formatAgentUploadUri(uploadId: string): string {
  const uri = new URL(`${AgentUploadUriSpec.Protocol}//${AgentUploadUriSpec.Host}/`);
  uri.pathname = `/${encodeURIComponent(uploadId)}`;
  return uri.toString();
}

export function normalizeAgentUploadUri(value: string): string | undefined {
  const uploadId = parseAgentUploadUri(value);
  return uploadId ? formatAgentUploadUri(uploadId) : undefined;
}

export function parseAgentUploadUri(value: string): string | undefined {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    return undefined;
  }

  if (uri.protocol !== AgentUploadUriSpec.Protocol || uri.hostname !== AgentUploadUriSpec.Host) {
    return undefined;
  }

  const pathSegments = uri.pathname.split("/").filter(Boolean);
  if (pathSegments.length !== 1) {
    return undefined;
  }

  const uploadId = decodeURIComponent(pathSegments[0]);
  return isSinglePathSegment(uploadId) ? uploadId : undefined;
}

export function resolveAgentUploadRoot(workspaceRoot: string, rootDir: string): string {
  return assertInsideRoot(
    workspaceRoot,
    path.resolve(workspaceRoot, rootDir),
    `upload 根目录超出工作区：${rootDir}`,
  );
}

export function resolveAgentUploadDir(uploadRoot: string, uploadId: string): string {
  return assertInsideRoot(
    uploadRoot,
    path.resolve(uploadRoot, uploadId),
    `upload 目录超出上传根目录：${uploadId}`,
  );
}

export function resolveAgentUploadFile(uploadRoot: string, uploadId: string, fileName: string): string {
  const uploadDir = resolveAgentUploadDir(uploadRoot, uploadId);
  return assertInsideRoot(
    uploadDir,
    path.resolve(uploadDir, fileName),
    `upload 文件超出上传目录：${uploadId}/${fileName}`,
  );
}

function isSinglePathSegment(value: string): boolean {
  if (!value || value === "." || value === "..") {
    return false;
  }

  return path.basename(value) === value && path.posix.basename(value) === value;
}
