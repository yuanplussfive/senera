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
import { redactArtifactSecrets } from "./AgentArtifactRedaction.js";
import { stableArtifactHash } from "./AgentArtifactStableJson.js";
import { collectArtifactEvidence } from "./AgentArtifactEvidenceProjection.js";
import { buildArtifactProjection, buildArtifactSummary } from "./AgentArtifactTemplateProjection.js";
import { AgentToolResultSummaryCompiler } from "./AgentToolResultSummaryCompiler.js";
import { projectAgentToolResultPresentation } from "../ToolRuntime/AgentToolResultPresentation.js";
import { writeToolWorkspaceArtifacts } from "./AgentToolWorkspaceArtifactRecorder.js";

export interface AgentToolExecutionArtifactRecorderOptions {
  workspaceRoot: string;
  config: ResolvedAgentArtifactsConfig;
  model: string;
}

export interface RecordToolArtifactsInput {
  requestId: string;
  step: number;
  results: readonly ExecutedToolCallResult[];
}

export class AgentToolExecutionArtifactRecorder {
  private readonly options: AgentToolExecutionArtifactRecorderOptions;
  private readonly summaryCompiler: AgentToolResultSummaryCompiler;

  constructor(options: AgentToolExecutionArtifactRecorderOptions) {
    this.options = options;
    this.summaryCompiler = new AgentToolResultSummaryCompiler({
      model: options.model,
    });
  }

  async record(input: RecordToolArtifactsInput): Promise<ExecutedToolCallResult[]> {
    const previousEvidence = new Set<string>();
    const recorded: ExecutedToolCallResult[] = [];

    for (const [index, result] of input.results.entries()) {
      const artifact = await this.recordOne({
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
      config: this.options.config,
      artifact,
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
  config: ResolvedAgentArtifactsConfig;
  artifact: ExecutedToolCallArtifact;
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
  const writer = new AgentArtifactFileWriter(input.workspaceRoot);
  await writer.writeJson(input.artifact.files.manifest, {
    schemaVersion: 1,
    artifactId: input.artifact.artifactId,
    artifactUri: input.artifact.artifactUri,
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
    files: input.artifact.files,
  });
  await writer.writeJson(input.artifact.files.input, input.redactedInput);
  await writer.writeBoundedJson(input.artifact.files.raw, input.redactedRaw, input.config.RawJsonMaxBytes);
  await writer.writeText(input.artifact.files.summary, input.artifact.summary, input.config.TextFileMaxBytes);
  await writer.writeJson(input.artifact.files.summaryJson, input.artifact.structuredSummary);
  await writer.writeJson(input.artifact.files.evidence, {
    artifactId: input.artifact.artifactId,
    artifactUri: input.artifact.artifactUri,
    artifactPath: input.absoluteDir,
    evidence: input.artifact.evidence,
  });
  await writer.writeText(
    input.artifact.files.projection,
    input.artifact.projection ?? "",
    input.config.TextFileMaxBytes,
  );
  await writer.writeJson(input.artifact.files.delta, {
    artifactId: input.artifact.artifactId,
    artifactUri: input.artifact.artifactUri,
    artifactPath: input.absoluteDir,
    delta: input.artifact.delta,
  });
  if (!input.workspaceArtifacts) {
    return;
  }

  await writer.writeJson(input.artifact.files.workspaceBefore, input.workspaceArtifacts.before);
  await writer.writeJson(input.artifact.files.workspaceAfter, input.workspaceArtifacts.after);
  await writer.writeJson(input.artifact.files.workspaceDiff, {
    artifactId: input.artifact.artifactId,
    artifactUri: input.artifact.artifactUri,
    artifactPath: input.absoluteDir,
    patch: input.workspaceArtifacts.patch,
    changes: input.workspaceArtifacts.changes,
  });
}
