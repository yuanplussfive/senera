import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { validateWorkspaceMutationPath } from "../Execution/SeneraWorkspacePath.js";

const TruncationMarker = "\n[truncated]\n";

export class AgentArtifactFileWriter {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  async writeJson(filePath: string, value: unknown): Promise<void> {
    await this.writeText(filePath, artifactJsonText(value), Number.MAX_SAFE_INTEGER);
  }

  async writeBoundedJson(filePath: string, value: unknown, maxBytes: number): Promise<void> {
    await this.writeText(filePath, boundedArtifactJsonText(value, maxBytes), maxBytes);
  }

  async writeText(filePath: string, value: string, maxBytes: number): Promise<void> {
    assertByteLimit(maxBytes);
    const targetPath = path.resolve(filePath);
    await this.assertSafeMutationPath(targetPath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await this.assertSafeMutationPath(targetPath);

    const text = truncateArtifactTextByBytes(value, maxBytes);
    const tempPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await this.assertSafeMutationPath(tempPath);
      await fs.writeFile(tempPath, text, { encoding: "utf8", flag: "wx" });
      await this.assertSafeMutationPath(targetPath);
      await fs.rename(tempPath, targetPath);
    } finally {
      await this.removeTemporaryFile(tempPath);
    }
  }

  private async assertSafeMutationPath(filePath: string): Promise<void> {
    const validation = await validateWorkspaceMutationPath(this.workspaceRoot, filePath);
    if (!validation.ok) {
      throw new Error(validation.message);
    }
  }

  private async removeTemporaryFile(filePath: string): Promise<void> {
    const validation = await validateWorkspaceMutationPath(this.workspaceRoot, filePath);
    if (validation.ok) {
      await fs.rm(filePath, { force: true });
    }
  }
}

export function truncateArtifactText(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 13))}\n[truncated]` : value;
}

export function truncateArtifactTextByBytes(value: string, maxBytes: number): string {
  assertByteLimit(maxBytes);
  if (byteLength(value) <= maxBytes) return value;
  const markerBytes = byteLength(TruncationMarker);
  if (markerBytes >= maxBytes) return truncateUtf8(TruncationMarker, maxBytes);
  return `${truncateUtf8(value, maxBytes - markerBytes)}${TruncationMarker}`;
}

function boundedArtifactJsonText(value: unknown, maxBytes: number): string {
  assertByteLimit(maxBytes);
  const fullText = artifactJsonText(value);
  if (byteLength(fullText) <= maxBytes) return fullText;

  const originalBytes = byteLength(fullText);
  let lower = 0;
  let upper = fullText.length;
  let best: string | undefined;
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const candidate = artifactJsonText({
      truncated: true,
      originalBytes,
      preview: fullText.slice(0, middle),
    });
    if (byteLength(candidate) <= maxBytes) {
      best = candidate;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  if (best) return best;

  for (const fallback of [{ truncated: true, originalBytes }, { truncated: true }, null]) {
    const candidate = artifactJsonText(fallback);
    if (byteLength(candidate) <= maxBytes) return candidate;
  }
  throw new Error(`Artifact JSON byte limit is too small to preserve valid JSON: ${maxBytes}`);
}

function artifactJsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2) ?? "null"}\n`;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = Math.min(maxBytes, buffer.byteLength);
  while (length > 0) {
    try {
      return decoder.decode(buffer.subarray(0, length));
    } catch {
      length -= 1;
    }
  }
  return "";
}

function assertByteLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error(`Artifact byte limit must be a non-negative safe integer: ${maxBytes}`);
  }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
