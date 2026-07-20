import type { ResolvedAgentArtifactsConfig } from "../Types/AgentConfigTypes.js";
import type {
  ExecutedToolCallArtifact,
  ExecutedToolCallResult,
  ToolArtifactDeltaRecord,
  ToolArtifactEvidenceRecord,
  ToolWorkspaceChange,
} from "../Types/ToolRuntimeTypes.js";
import { createAgentArtifactLocator } from "./AgentArtifactLocator.js";
import { AgentArtifactFileWriter } from "./AgentArtifactFileWriter.js";
import {
  createArtifactStreamRedactionTransform,
  hasArtifactStreamRedaction,
  isArtifactStreamFullyRedacted,
  redactArtifactSecrets,
} from "./AgentArtifactRedaction.js";
import { stableArtifactHash } from "./AgentArtifactStableJson.js";
import { collectArtifactEvidence } from "./AgentArtifactEvidenceProjection.js";
import { buildArtifactProjection, buildArtifactSummary } from "./AgentArtifactTemplateProjection.js";
import { AgentToolResultSummaryCompiler } from "./AgentToolResultSummaryCompiler.js";
import { projectAgentToolResultPresentation } from "../ToolRuntime/AgentToolResultPresentation.js";
import { writeToolWorkspaceArtifacts } from "./AgentToolWorkspaceArtifactRecorder.js";
import { updateSeneraOutputSpoolState } from "../Execution/SeneraOutputSpool.js";
import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { ReadableArtifactRefDefinitions, ReadableArtifactRefs } from "../Memory/AgentArtifactMemoryTypes.js";

export interface AgentToolExecutionArtifactRecorderOptions {
  workspaceRoot: string;
  config: ResolvedAgentArtifactsConfig;
  model: string;
}

export interface RecordToolArtifactsInput {
  sessionId?: string;
  requestId: string;
  step: number;
  results: readonly ExecutedToolCallResult[];
}

export class AgentToolExecutionArtifactRecorder {
  private readonly options: AgentToolExecutionArtifactRecorderOptions;
  private readonly summaryCompiler: AgentToolResultSummaryCompiler;
  private readonly fileWriter: AgentArtifactFileWriter;

  constructor(options: AgentToolExecutionArtifactRecorderOptions) {
    this.options = options;
    this.fileWriter = new AgentArtifactFileWriter(options.workspaceRoot);
    this.summaryCompiler = new AgentToolResultSummaryCompiler({
      model: options.model,
    });
  }

  async record(input: RecordToolArtifactsInput): Promise<ExecutedToolCallResult[]> {
    const previousEvidence = new Set<string>();
    const recorded: ExecutedToolCallResult[] = [];

    for (const [index, result] of input.results.entries()) {
      const artifact = await this.recordOne({
        sessionId: input.sessionId,
        requestId: input.requestId,
        step: input.step,
        callIndex: index + 1,
        result,
        previousEvidence,
      });
      artifact.evidence.forEach((entry) => previousEvidence.add(entry.key));
      const recordedResult = {
        ...result,
        artifact,
      };
      recorded.push({
        ...recordedResult,
        presentation: projectAgentToolResultPresentation(recordedResult),
      });
    }

    return recorded;
  }

  private async recordOne(input: {
    sessionId?: string;
    requestId: string;
    step: number;
    callIndex: number;
    result: ExecutedToolCallResult;
    previousEvidence: Set<string>;
  }): Promise<ExecutedToolCallArtifact> {
    const argsHash = stableArtifactHash(input.result.arguments);
    const resultHash = stableArtifactHash(input.result.result);
    const locator = createAgentArtifactLocator({
      workspaceRoot: this.options.workspaceRoot,
      rootDir: this.options.config.RootDir,
      requestId: input.requestId,
      step: input.step,
      callIndex: input.callIndex,
      toolName: input.result.name,
      argsHash,
      resultHash,
    });
    const policy = input.result.artifactPolicy;
    const redactedInput = redactArtifactSecrets(input.result.arguments, policy);
    const redactedRaw = redactArtifactSecrets(input.result.result, policy);
    const evidence = collectArtifactEvidence(redactedRaw, policy, locator.artifactId);
    const workspaceArtifacts = input.result.workspaceCapture
      ? await writeToolWorkspaceArtifacts({
          workspaceRoot: this.options.workspaceRoot,
          policy,
          toolName: input.result.name,
          workspaceCapture: input.result.workspaceCapture,
          artifactDir: locator.absoluteDir,
          files: locator.files,
          fileWriter: this.fileWriter,
        })
      : undefined;
    const delta = buildArtifactDelta({
      evidence,
      previousEvidence: input.previousEvidence,
      workspaceChanges: workspaceArtifacts?.changes,
    });
    const workspaceProjection = workspaceArtifacts
      ? {
          before: workspaceArtifacts.before,
          after: workspaceArtifacts.after,
          changes: workspaceArtifacts.changes,
        }
      : undefined;
    const deterministicSummary = buildArtifactSummary({
      toolName: input.result.name,
      callId: input.result.callId,
      args: redactedInput,
      result: redactedRaw,
      evidence,
      delta,
      policy,
      artifact: {
        artifactId: locator.artifactId,
        artifactUri: locator.artifactUri,
        artifactPath: locator.absoluteDir,
        relativePath: locator.relativeDir,
      },
      workspace: workspaceProjection,
    });
    const structuredSummary = this.summaryCompiler.compile({
      toolName: input.result.name,
      callId: input.result.callId,
      status: readToolResultStatus(input.result),
      artifactUri: locator.artifactUri,
      deterministicSummary,
      result: redactedRaw,
      evidence,
      delta,
      workspace: workspaceProjection,
    });
    const summary = this.summaryCompiler.renderMarkdown(structuredSummary);
    const artifactBase: ExecutedToolCallArtifact = {
      artifactId: locator.artifactId,
      artifactUri: locator.artifactUri,
      artifactPath: locator.absoluteDir,
      relativePath: locator.relativeDir,
      manifestPath: locator.files.manifest,
      files: locator.files,
      summary,
      structuredSummary,
      evidence,
      delta,
      workspace: workspaceProjection,
    };
    const projection = buildArtifactProjection({
      artifact: artifactBase,
      toolName: input.result.name,
      callId: input.result.callId,
      args: redactedInput,
      result: redactedRaw,
      policy: input.result.artifactPolicy,
    });
    const artifact: ExecutedToolCallArtifact = {
      ...artifactBase,
      projection,
    };

    await writeToolArtifactFiles({
      fileWriter: this.fileWriter,
      config: this.options.config,
      artifact,
      sessionId: input.sessionId,
      requestId: input.requestId,
      step: input.step,
      callIndex: input.callIndex,
      result: input.result,
      argsHash,
      resultHash,
      redactedInput,
      redactedRaw,
      workspaceRoot: locator.workspaceRoot,
      rootDir: locator.rootDir,
      absoluteDir: locator.absoluteDir,
      relativeDir: locator.relativeDir,
      workspaceArtifacts,
    });

    return artifact;
  }
}

function buildArtifactDelta(input: {
  evidence: readonly ToolArtifactEvidenceRecord[];
  previousEvidence: ReadonlySet<string>;
  workspaceChanges?: readonly ToolWorkspaceChange[];
}): ToolArtifactDeltaRecord[] {
  return [
    ...input.evidence.map(
      (entry) =>
        ({
          kind: "evidence",
          key: entry.key,
          status: input.previousEvidence.has(entry.key) ? "unchanged" : "added",
          summary: entry.label,
          metadata: {
            evidenceKind: entry.kind,
          },
        }) satisfies ToolArtifactDeltaRecord,
    ),
    ...(input.workspaceChanges ?? []).map(
      (change) =>
        ({
          kind: "workspace",
          key: change.path,
          status: change.status === "unchanged" ? "unchanged" : "changed",
          summary: `${change.status}: ${change.path}`,
          metadata: {
            beforeHash: change.beforeHash,
            afterHash: change.afterHash,
            beforeSize: change.beforeSize,
            afterSize: change.afterSize,
            patch: change.patch,
          },
        }) satisfies ToolArtifactDeltaRecord,
    ),
  ];
}

function readToolResultStatus(result: ExecutedToolCallResult): "success" | "failure" | "empty" {
  const structuredError = readRecord(result.result)?.error;
  if (structuredError || (result.process.exitCode !== null && result.process.exitCode !== 0) || result.process.signal) {
    return "failure";
  }
  return result.result === undefined || result.result === null ? "empty" : "success";
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

async function writeToolArtifactFiles(input: {
  fileWriter: AgentArtifactFileWriter;
  config: ResolvedAgentArtifactsConfig;
  artifact: ExecutedToolCallArtifact;
  sessionId?: string;
  requestId: string;
  step: number;
  callIndex: number;
  result: ExecutedToolCallResult;
  argsHash: string;
  resultHash: string;
  redactedInput: unknown;
  redactedRaw: unknown;
  workspaceRoot: string;
  rootDir: string;
  absoluteDir: string;
  relativeDir: string;
  workspaceArtifacts?: Awaited<ReturnType<typeof writeToolWorkspaceArtifacts>>;
}): Promise<void> {
  const writingMarker = path.join(input.absoluteDir, ".artifact-writing");
  const startedAt = new Date().toISOString();
  const writingState = { sessionId: input.sessionId, state: "writing", startedAt } as const;
  let committed = false;
  try {
    await input.fileWriter.writeText(writingMarker, JSON.stringify(writingState), 1024);
    if (input.result.outputCapture) {
      await copyCapturedOutput(input, "stdout");
      await copyCapturedOutput(input, "stderr");
    }
    await input.fileWriter.writeJson(input.artifact.files.input, input.redactedInput);
    await input.fileWriter.writeJson(input.artifact.files.raw, input.redactedRaw);
    await input.fileWriter.writeBoundedJson(
      input.artifact.files.rawPreview,
      input.redactedRaw,
      input.config.RawJsonMaxBytes,
    );
    await input.fileWriter.writeText(
      input.artifact.files.summary,
      input.artifact.summary,
      input.config.TextFileMaxBytes,
    );
    await input.fileWriter.writeJson(input.artifact.files.summaryJson, input.artifact.structuredSummary);
    await input.fileWriter.writeJson(input.artifact.files.evidence, {
      artifactId: input.artifact.artifactId,
      artifactUri: input.artifact.artifactUri,
      artifactPath: input.absoluteDir,
      evidence: input.artifact.evidence,
    });
    await input.fileWriter.writeText(
      input.artifact.files.projection,
      input.artifact.projection ?? "",
      input.config.TextFileMaxBytes,
    );
    await input.fileWriter.writeJson(input.artifact.files.delta, {
      artifactId: input.artifact.artifactId,
      artifactUri: input.artifact.artifactUri,
      artifactPath: input.absoluteDir,
      delta: input.artifact.delta,
    });
    if (input.workspaceArtifacts) {
      await input.fileWriter.writeJson(input.artifact.files.workspaceBefore, input.workspaceArtifacts.before);
      await input.fileWriter.writeJson(input.artifact.files.workspaceAfter, input.workspaceArtifacts.after);
      await input.fileWriter.writeJson(input.artifact.files.workspaceDiff, {
        artifactId: input.artifact.artifactId,
        artifactUri: input.artifact.artifactUri,
        artifactPath: input.absoluteDir,
        patch: input.workspaceArtifacts.patch,
        changes: input.workspaceArtifacts.changes,
      });
    }

    await input.fileWriter.writeJson(input.artifact.files.manifest, await buildArtifactManifest(input));
    committed = true;
  } finally {
    if (committed) {
      if (input.result.outputCapture) {
        await updateSeneraOutputSpoolState(input.result.outputCapture, "committed").catch(() => undefined);
        await cleanupOutputCapture(input.result.outputCapture);
      }
      await fs.rm(writingMarker, { force: true }).catch(() => undefined);
    } else if (input.result.outputCapture) {
      await updateSeneraOutputSpoolState(input.result.outputCapture, "failed").catch(() => undefined);
    }
    if (!committed) {
      await input.fileWriter
        .writeText(
          writingMarker,
          JSON.stringify({ ...writingState, state: "failed", failedAt: new Date().toISOString() }),
          1024,
        )
        .catch(() => undefined);
    }
  }
}

async function buildArtifactManifest(input: Parameters<typeof writeToolArtifactFiles>[0]) {
  return {
    schemaVersion: 2,
    artifactId: input.artifact.artifactId,
    artifactUri: input.artifact.artifactUri,
    createdAt: new Date().toISOString(),
    sessionId: input.sessionId,
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
    process: input.result.process,
    outputCapture: input.result.outputCapture
      ? {
          refs: ["stdout", "stderr"],
          redacted: {
            stdout: hasArtifactStreamRedaction(input.result.artifactPolicy, "stdout"),
            stderr: hasArtifactStreamRedaction(input.result.artifactPolicy, "stderr"),
          },
          truncated: input.result.outputCapture.truncated,
          files: {
            stdout: input.artifact.files.stdout,
            stderr: input.artifact.files.stderr,
          },
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
    contents: await collectArtifactContents(input.artifact.files),
    files: input.artifact.files,
  };
}

async function collectArtifactContents(files: Readonly<Record<string, string>>) {
  const contents = await Promise.all(
    ReadableArtifactRefs.map(async (ref) => {
      const definition = ReadableArtifactRefDefinitions[ref];
      const filePath = files[definition.file];
      if (!filePath) return undefined;
      const stat = await fs.stat(filePath).catch(() => undefined);
      if (!stat?.isFile()) return undefined;
      return {
        ref,
        mediaType: definition.mediaType,
        byteLength: stat.size,
        sha256: await hashArtifactFile(filePath),
      };
    }),
  );
  return contents.filter((entry) => entry !== undefined);
}

async function hashArtifactFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function copyCapturedOutput(
  input: Parameters<typeof writeToolArtifactFiles>[0],
  stream: "stdout" | "stderr",
): Promise<void> {
  const capture = input.result.outputCapture;
  if (!capture) return;
  const target = input.artifact.files[stream];
  if (isArtifactStreamFullyRedacted(input.result.artifactPolicy, stream)) {
    await input.fileWriter.writeText(target, "[REDACTED]\n", input.config.TextFileMaxBytes);
    return;
  }
  const transform = createArtifactStreamRedactionTransform(input.result.artifactPolicy, stream);
  if (transform) {
    await input.fileWriter.copyFileWithTransform(capture.files[stream], target, transform);
    return;
  }
  await input.fileWriter.copyFile(capture.files[stream], target);
}

async function cleanupOutputCapture(capture: ExecutedToolCallResult["outputCapture"]): Promise<void> {
  if (!capture) return;
  await fs.rm(capture.directory, { recursive: true, force: true }).catch(() => undefined);
}
