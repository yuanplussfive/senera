import { createHash, timingSafeEqual } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { SeneraWorkspaceBoundary } from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";

export interface AgentArtifactFileReceipt {
  readonly filePath: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface AgentArtifactContentIdentity {
  readonly byteLength: number;
  readonly sha256: string;
}

export class AgentArtifactIntegrityError extends AgentBaseError {
  readonly code = "ArtifactIntegrityMismatch" as const;

  constructor(
    readonly filePath: string,
    readonly expected: AgentArtifactContentIdentity,
    readonly actual: AgentArtifactContentIdentity,
  ) {
    super(
      `Artifact content integrity verification failed: ${filePath}; ` +
        `expected ${expected.byteLength} bytes sha256:${expected.sha256}, ` +
        `received ${actual.byteLength} bytes sha256:${actual.sha256}`,
    );
  }
}

export async function openVerifiedArtifactFile(
  boundary: SeneraWorkspaceBoundary,
  filePath: string,
  expected: AgentArtifactContentIdentity,
  signal?: AbortSignal,
): Promise<FileHandle> {
  const opened = await boundary.openFile(filePath, AgentResourceAccessIntents.Read);
  try {
    await verifyArtifactFileHandle(opened.handle, filePath, expected, signal);
    return opened.handle;
  } catch (error) {
    await opened.handle.close().catch(() => undefined);
    throw error;
  }
}

export async function verifyArtifactFileHandle(
  handle: FileHandle,
  filePath: string,
  expected: AgentArtifactContentIdentity,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const stat = await handle.stat();
  const hash = createHash("sha256");
  const source = handle.createReadStream({ autoClose: false, start: 0 });
  const abort = (): void => {
    source.destroy(signal?.reason);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for await (const chunk of source) {
      throwIfAborted(signal);
      hash.update(chunk);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
  }

  const actual = { byteLength: stat.size, sha256: hash.digest("hex") };
  if (actual.byteLength !== expected.byteLength || !sameDigest(actual.sha256, expected.sha256)) {
    throw new AgentArtifactIntegrityError(filePath, expected, actual);
  }
}

function sameDigest(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}
