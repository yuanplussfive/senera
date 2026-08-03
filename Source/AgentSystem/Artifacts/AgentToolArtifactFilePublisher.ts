import fs from "node:fs/promises";
import path from "node:path";
import { updateSeneraOutputSpoolState } from "../Execution/SeneraOutputSpool.js";
import { ReadableArtifactRefDefinitions, ReadableArtifactRefs } from "../Memory/AgentArtifactMemoryTypes.js";
import type { ResolvedAgentArtifactsConfig } from "../Types/AgentConfigTypes.js";
import type { ExecutedToolCallArtifact, ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentArtifactFileWriter } from "./AgentArtifactFileWriter.js";
import type { AgentArtifactFileReceipt } from "./AgentArtifactIntegrity.js";
import { artifactJsonStructurePath, createArtifactJsonStructureTransform } from "./AgentArtifactJsonStructure.js";
import { AgentArtifactManifestWriterSchemaVersion } from "./AgentArtifactManifestContract.js";
import {
  createArtifactStreamRedactionTransform,
  hasArtifactStreamRedaction,
  isArtifactStreamFullyRedacted,
} from "./AgentArtifactRedaction.js";
import type { writeToolWorkspaceArtifacts } from "./AgentToolWorkspaceArtifactRecorder.js";

export interface PublishToolArtifactFilesInput {
  readonly fileWriter: AgentArtifactFileWriter;
  readonly config: ResolvedAgentArtifactsConfig;
  readonly artifact: ExecutedToolCallArtifact;
  readonly sessionId?: string;
  readonly requestId: string;
  readonly step: number;
  readonly callIndex: number;
  readonly result: ExecutedToolCallResult;
  readonly argsHash: string;
  readonly resultHash: string;
  readonly redactionPolicySha256: string;
  readonly redactedInput: unknown;
  readonly redactedRaw: unknown;
  readonly redactedOutcome: ExecutedToolCallResult["outcome"];
  readonly workspaceRoot: string;
  readonly rootDir: string;
  readonly absoluteDir: string;
  readonly relativeDir: string;
  readonly workspaceArtifacts?: Awaited<ReturnType<typeof writeToolWorkspaceArtifacts>>;
}

export async function publishToolArtifactFiles(input: PublishToolArtifactFilesInput): Promise<void> {
  const receipts = new Map<string, AgentArtifactFileReceipt>();
  if (input.workspaceArtifacts) retainReceipt(receipts, input.workspaceArtifacts.patchReceipt);
  if (input.result.outputCapture) {
    retainReceipt(receipts, await copyCapturedOutput(input, "stdout"));
    retainReceipt(receipts, await copyCapturedOutput(input, "stderr"));
  }
  await input.fileWriter.writeJson(input.artifact.files.input, input.redactedInput);
  retainReceipts(
    receipts,
    await writeStructuredArtifactJson(input.fileWriter, input.artifact.files.raw, input.redactedRaw),
  );
  retainReceipt(
    receipts,
    await input.fileWriter.writeBoundedJson(
      input.artifact.files.rawPreview,
      input.redactedRaw,
      input.config.RawJsonMaxBytes,
    ),
  );
  retainReceipt(receipts, await writeArtifactJsonStructure(input.fileWriter, input.artifact.files.rawPreview));
  retainReceipt(
    receipts,
    await input.fileWriter.writeText(
      input.artifact.files.summary,
      input.artifact.summary,
      input.config.TextFileMaxBytes,
    ),
  );
  await input.fileWriter.writeJson(input.artifact.files.summaryJson, input.artifact.structuredSummary);
  retainReceipts(
    receipts,
    await writeStructuredArtifactJson(input.fileWriter, input.artifact.files.evidence, {
      artifactId: input.artifact.artifactId,
      artifactUri: input.artifact.artifactUri,
      artifactPath: input.absoluteDir,
      evidence: input.artifact.evidence,
    }),
  );
  retainReceipt(
    receipts,
    await input.fileWriter.writeText(
      input.artifact.files.projection,
      input.artifact.projection ?? "",
      input.config.TextFileMaxBytes,
    ),
  );
  retainReceipts(
    receipts,
    await writeStructuredArtifactJson(input.fileWriter, input.artifact.files.delta, {
      artifactId: input.artifact.artifactId,
      artifactUri: input.artifact.artifactUri,
      artifactPath: input.absoluteDir,
      delta: input.artifact.delta,
    }),
  );
  if (input.workspaceArtifacts) {
    await input.fileWriter.writeJson(input.artifact.files.workspaceBefore, input.workspaceArtifacts.before);
    await input.fileWriter.writeJson(input.artifact.files.workspaceAfter, input.workspaceArtifacts.after);
    retainReceipts(
      receipts,
      await writeStructuredArtifactJson(input.fileWriter, input.artifact.files.workspaceDiff, {
        artifactId: input.artifact.artifactId,
        artifactUri: input.artifact.artifactUri,
        artifactPath: input.absoluteDir,
        patch: input.workspaceArtifacts.patch,
        changes: input.workspaceArtifacts.changes,
      }),
    );
  }

  await input.fileWriter.publishJson(input.artifact.files.manifest, buildArtifactManifest(input, receipts));
}

export class AgentArtifactPublicationSession {
  private readonly markerPath: string;
  private readonly writingState: { readonly sessionId?: string; readonly state: "writing"; readonly startedAt: string };

  constructor(
    private readonly input: {
      readonly fileWriter: AgentArtifactFileWriter;
      readonly artifactDirectory: string;
      readonly sessionId?: string;
      readonly outputCapture: ExecutedToolCallResult["outputCapture"];
    },
  ) {
    this.markerPath = path.join(input.artifactDirectory, ".artifact-writing");
    this.writingState = { sessionId: input.sessionId, state: "writing", startedAt: new Date().toISOString() };
  }

  begin(): Promise<AgentArtifactFileReceipt> {
    return this.input.fileWriter.writeText(this.markerPath, JSON.stringify(this.writingState), Number.MAX_SAFE_INTEGER);
  }

  async commit(): Promise<void> {
    if (this.input.outputCapture) {
      await updateSeneraOutputSpoolState(this.input.outputCapture, "committed").catch(() => undefined);
      await cleanupOutputCapture(this.input.outputCapture);
    }
    await fs.rm(this.markerPath, { force: true }).catch(() => undefined);
  }

  async fail(): Promise<void> {
    if (this.input.outputCapture) {
      await updateSeneraOutputSpoolState(this.input.outputCapture, "failed").catch(() => undefined);
    }
    await this.input.fileWriter
      .writeText(
        this.markerPath,
        JSON.stringify({ ...this.writingState, state: "failed", failedAt: new Date().toISOString() }),
        Number.MAX_SAFE_INTEGER,
      )
      .catch(() => undefined);
  }
}

function buildArtifactManifest(
  input: PublishToolArtifactFilesInput,
  receipts: ReadonlyMap<string, AgentArtifactFileReceipt>,
) {
  return {
    schemaVersion: AgentArtifactManifestWriterSchemaVersion,
    artifactId: input.artifact.artifactId,
    artifactUri: input.artifact.artifactUri,
    createdAt: new Date().toISOString(),
    sessionId: input.sessionId,
    sessionIds: input.sessionId ? [input.sessionId] : undefined,
    workspaceRoot: input.workspaceRoot,
    rootDir: input.rootDir,
    absoluteDir: input.absoluteDir,
    relativeDir: input.relativeDir,
    requestId: input.requestId,
    step: input.step,
    callIndex: input.callIndex,
    toolName: input.result.name,
    callId: input.result.callId,
    argsHash: input.argsHash,
    resultHash: input.resultHash,
    redactionPolicySha256: input.redactionPolicySha256,
    process: input.result.process,
    outcome: input.redactedOutcome,
    outputCapture: input.result.outputCapture
      ? {
          refs: ["stdout", "stderr"],
          redacted: {
            stdout: hasArtifactStreamRedaction(input.result.artifactPolicy, "stdout"),
            stderr: hasArtifactStreamRedaction(input.result.artifactPolicy, "stderr"),
          },
          truncated: input.result.outputCapture.truncated,
          files: { stdout: input.artifact.files.stdout, stderr: input.artifact.files.stderr },
        }
      : undefined,
    workspace: input.workspaceArtifacts
      ? {
          beforeCount: input.workspaceArtifacts.before.files.length,
          afterCount: input.workspaceArtifacts.after.files.length,
          changeCount: input.workspaceArtifacts.changes.length,
          files: {
            before: input.artifact.files.workspaceBefore,
            after: input.artifact.files.workspaceAfter,
            diff: input.artifact.files.workspaceDiff,
            patch: input.artifact.files.workspacePatch,
            beforeDir: input.artifact.files.workspaceBeforeDir,
            afterDir: input.artifact.files.workspaceAfterDir,
          },
          patch: input.workspaceArtifacts.patch,
        }
      : undefined,
    contents: collectArtifactContents(input.artifact.files, receipts),
    files: input.artifact.files,
  };
}

function collectArtifactContents(
  files: Readonly<Record<string, string>>,
  receipts: ReadonlyMap<string, AgentArtifactFileReceipt>,
) {
  return ReadableArtifactRefs.flatMap((ref) => {
    const definition = ReadableArtifactRefDefinitions[ref];
    const filePath = files[definition.file];
    if (!filePath) return [];
    const receipt = receipts.get(path.resolve(filePath));
    if (!receipt) return [];
    const structure = receipts.get(path.resolve(artifactJsonStructurePath(filePath)));
    return [
      {
        ref,
        mediaType: definition.mediaType,
        byteLength: receipt.byteLength,
        sha256: receipt.sha256,
        ...(definition.format === "json" && structure
          ? {
              structure: {
                file: structure.filePath,
                mediaType: "application/x-ndjson" as const,
                byteLength: structure.byteLength,
                sha256: structure.sha256,
              },
            }
          : {}),
      },
    ];
  });
}

async function writeStructuredArtifactJson(
  fileWriter: AgentArtifactFileWriter,
  filePath: string,
  value: unknown,
): Promise<readonly AgentArtifactFileReceipt[]> {
  const content = await fileWriter.writeJson(filePath, value);
  const structure = await writeArtifactJsonStructure(fileWriter, filePath);
  return [content, structure];
}

function writeArtifactJsonStructure(
  fileWriter: AgentArtifactFileWriter,
  filePath: string,
): Promise<AgentArtifactFileReceipt> {
  return fileWriter.copyFileWithTransform(
    filePath,
    artifactJsonStructurePath(filePath),
    createArtifactJsonStructureTransform(),
  );
}

async function copyCapturedOutput(
  input: PublishToolArtifactFilesInput,
  stream: "stdout" | "stderr",
): Promise<AgentArtifactFileReceipt> {
  const capture = input.result.outputCapture;
  if (!capture) throw new Error("Artifact output capture receipt requested without an output capture.");
  const target = input.artifact.files[stream];
  if (isArtifactStreamFullyRedacted(input.result.artifactPolicy, stream)) {
    return input.fileWriter.writeText(target, "[REDACTED]\n", input.config.TextFileMaxBytes);
  }
  const transform = createArtifactStreamRedactionTransform(input.result.artifactPolicy, stream);
  return transform
    ? input.fileWriter.copyFileWithTransform(capture.files[stream], target, transform)
    : input.fileWriter.copyFile(capture.files[stream], target);
}

function retainReceipt(receipts: Map<string, AgentArtifactFileReceipt>, receipt: AgentArtifactFileReceipt): void {
  receipts.set(path.resolve(receipt.filePath), receipt);
}

function retainReceipts(
  receipts: Map<string, AgentArtifactFileReceipt>,
  entries: readonly AgentArtifactFileReceipt[],
): void {
  entries.forEach((entry) => retainReceipt(receipts, entry));
}

async function cleanupOutputCapture(capture: ExecutedToolCallResult["outputCapture"]): Promise<void> {
  if (!capture) return;
  await fs.rm(capture.directory, { recursive: true, force: true }).catch(() => undefined);
}
