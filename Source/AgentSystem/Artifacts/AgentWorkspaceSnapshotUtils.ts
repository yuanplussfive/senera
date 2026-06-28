import { createReadStream } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import type { ToolWorkspaceFileSnapshot } from "../Types/ToolRuntimeTypes.js";
import { toPosixPath } from "./AgentArtifactLocator.js";

export function missingWorkspaceSnapshot(
  filePath: string,
  absolutePath: string,
): ToolWorkspaceFileSnapshot {
  return {
    path: filePath,
    absolutePath,
    exists: false,
    kind: "missing",
    size: 0,
    mtimeMs: 0,
    hash: "",
    content: {
      state: "omitted",
      reason: "missing",
      byteLength: 0,
    },
  };
}

export async function hashWorkspaceFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return `sha256:${hash.digest("hex")}`;
}

export function hashWorkspaceText(value: string): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

export function normalizeWorkspaceRelativePath(value: string): string {
  return toPosixPath(path.normalize(value)).replace(/^\.\//, "");
}

export function joinWorkspacePath(base: string, name: string): string {
  return normalizeWorkspaceRelativePath(base ? path.join(base, name) : name);
}

export function isProbablyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }
  if (buffer.includes(0)) {
    return true;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  const suspicious = sample.reduce((count, byte) =>
    count + (byte < 8 || (byte > 13 && byte < 32) ? 1 : 0), 0);
  return suspicious / sample.length > 0.3;
}

export function countLines(value: string): number {
  if (value.length === 0) {
    return 0;
  }
  return value.endsWith("\n")
    ? value.slice(0, -1).split("\n").length
    : value.split("\n").length;
}
