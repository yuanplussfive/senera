import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { redactArtifactSecrets } from "./AgentArtifactRedaction.js";
import { stableArtifactHash } from "./AgentArtifactStableJson.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";

/**
 * Produces the immutable identity for everything an Artifact owns beyond its
 * public result value. Process streams and binary payloads must participate:
 * the same call/result coordinates are not enough to prove that their durable
 * output is interchangeable.
 */
export async function createAgentToolArtifactPayloadHash(
  result: ExecutedToolCallResult,
  redactedResult: unknown,
  redactedOutcome: ExecutedToolCallResult["outcome"],
): Promise<string> {
  const policy = result.artifactPolicy;
  return stableArtifactHash({
    policy,
    result: redactedResult,
    process: redactArtifactSecrets(result.process, policy),
    outcome: redactedOutcome,
    artifactPayload: redactArtifactSecrets(result.artifactPayload, policy),
    workspaceCapture: redactArtifactSecrets(result.workspaceCapture, policy),
    outputCapture: result.outputCapture ? await readOutputCaptureIdentity(result.outputCapture) : undefined,
  });
}

async function readOutputCaptureIdentity(capture: NonNullable<ExecutedToolCallResult["outputCapture"]>): Promise<{
  readonly truncated: Readonly<Record<"stdout" | "stderr", boolean>>;
  readonly streams: Readonly<Record<"stdout" | "stderr", { readonly byteLength: number; readonly sha256: string }>>;
}> {
  const [stdout, stderr] = await Promise.all([
    hashCapturedStream(capture.files.stdout),
    hashCapturedStream(capture.files.stderr),
  ]);
  return {
    truncated: capture.truncated,
    streams: { stdout, stderr },
  };
}

async function hashCapturedStream(filePath: string): Promise<{ readonly byteLength: number; readonly sha256: string }> {
  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    hash.update(buffer);
  }
  return { byteLength, sha256: hash.digest("hex") };
}
