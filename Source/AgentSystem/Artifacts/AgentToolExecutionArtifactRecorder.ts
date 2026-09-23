import path from "node:path";
import { createAgentResourceId, createAgentResourceUri } from "../Resources/AgentResourceUri.js";
import { extension as mimeExtension } from "mime-types";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import { projectAgentToolResultPresentation } from "../ToolRuntime/AgentToolResultPresentation.js";
import { projectAgentExecutedToolResultStatus, readAgentToolFailure } from "../ToolRuntime/AgentToolResultOutcome.js";
import type { ResolvedAgentArtifactsConfig } from "../Types/AgentConfigTypes.js";
import type {
  AgentToolArtifactAssetReference,
  ExecutedToolCallArtifact,
  ExecutedToolCallResult,
} from "../Types/ToolRuntimeTypes.js";
import { buildArtifactDelta } from "./AgentArtifactDeltaProjection.js";
import { AgentArtifactDirectoryReservations, AgentArtifactFileWriter } from "./AgentArtifactFileWriter.js";
import { createAgentArtifactLocator } from "./AgentArtifactLocator.js";
import { AgentArtifactPublicationRecovery } from "./AgentArtifactPublicationRecovery.js";
import { collectArtifactEvidence } from "./AgentArtifactEvidenceProjection.js";
import { redactArtifactSecrets, redactArtifactToolOutcome } from "./AgentArtifactRedaction.js";
import { stableArtifactHash } from "./AgentArtifactStableJson.js";
import { buildArtifactProjection, buildArtifactSummary } from "./AgentArtifactTemplateProjection.js";
import {
  AgentArtifactPublicationSession,
  finalizeAgentToolOutputCapture,
  markAgentToolOutputCaptureFailed,
  publishToolArtifactFiles,
} from "./AgentToolArtifactFilePublisher.js";
import { AgentToolResultSummaryCompiler } from "./AgentToolResultSummaryCompiler.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import { projectAgentToolResultEventValue } from "../ToolRuntime/AgentToolResultEventProjection.js";
import { createAgentToolArtifactPayloadHash } from "./AgentToolArtifactPayloadIdentity.js";
import { writeToolWorkspaceArtifacts } from "./AgentToolWorkspaceArtifactRecorder.js";
import { toPosixPath } from "./AgentArtifactLocator.js";
import type { AgentArtifactFileReceipt } from "./AgentArtifactIntegrity.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { AgentCancellationError } from "../Core/AgentCancellation.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { markAgentToolArtifactUnavailable } from "./AgentToolArtifactAvailability.js";
import {
  AgentDefaultToolSemanticProjector,
  type AgentToolSemanticProjection,
  type AgentToolSemanticProjector,
} from "../ToolRuntime/AgentToolSemanticProjection.js";
import { projectAgentToolArtifactEvidenceCandidates } from "./AgentToolArtifactEvidenceCandidates.js";
import { AgentToolContentPolicyDispatcher } from "../ToolRuntime/AgentToolContentPolicyDispatcher.js";

export { AgentArtifactPublicationConflictError } from "./AgentArtifactPublicationRecovery.js";

export interface AgentToolExecutionArtifactRecorderOptions {
  readonly workspaceRoot: string;
  readonly config: ResolvedAgentArtifactsConfig;
  readonly model: string;
  readonly logger?: AgentLogger;
  readonly semanticProjector?: AgentToolSemanticProjector;
}

export interface RecordToolArtifactsInput {
  readonly sessionId?: string;
  readonly requestId: string;
  readonly step: number;
  readonly results: readonly ExecutedToolCallResult[];
}

export class AgentToolExecutionArtifactRecorder {
  private readonly summaryCompiler: AgentToolResultSummaryCompiler;
  private readonly fileWriter: AgentArtifactFileWriter;
  private readonly recovery: AgentArtifactPublicationRecovery;
  private readonly publicationLeases = new AgentKeyedLeaseQueue<string>();
  private readonly semanticProjector: AgentToolSemanticProjector;
  private readonly tokenProjector: AgentTokenProjector;
  private readonly contentPolicyDispatcher = new AgentToolContentPolicyDispatcher();

  constructor(private readonly options: AgentToolExecutionArtifactRecorderOptions) {
    this.fileWriter = new AgentArtifactFileWriter(options.workspaceRoot);
    this.summaryCompiler = new AgentToolResultSummaryCompiler({ model: options.model });
    this.recovery = new AgentArtifactPublicationRecovery(this.fileWriter, this.summaryCompiler);
    this.semanticProjector = options.semanticProjector ?? new AgentDefaultToolSemanticProjector();
    this.tokenProjector = new AgentTokenProjector(options.model);
  }

  async record(input: RecordToolArtifactsInput): Promise<ExecutedToolCallResult[]> {
    const previousEvidence = new Set<string>();
    const recorded: ExecutedToolCallResult[] = [];
    for (const [index, result] of input.results.entries()) {
      try {
        const { artifact, inline, inlinePayload } = await this.recordOne({
          sessionId: input.sessionId,
          requestId: input.requestId,
          step: input.step,
          callIndex: index + 1,
          result,
          previousEvidence,
        });
        artifact.evidence.forEach((entry) => previousEvidence.add(entry.key));
        const semanticProjection = await this.projectSemanticObservation(result);
        const resultWithoutPayload = projectArtifactBackedExecution(result);
        const observationProjection = this.contentPolicyDispatcher.project({
          value: redactArtifactSecrets(result.result, result.artifactPolicy),
          policy: result.contentPolicy,
        });
        const artifactBackedResult = {
          ...resultWithoutPayload,
          result: projectArtifactAssetLinks(result.result, artifact.assets),
          ...(inline ? { inlineResult: true as const, inlinePayload } : {}),
          ...(observationProjection.stats.transformedTargets > 0
            ? { observationResult: observationProjection.value }
            : {}),
          artifact,
          ...(semanticProjection ? { semanticProjection } : {}),
        };
        const presentation = projectAgentToolResultPresentation(artifactBackedResult);
        const recordedResult = {
          ...artifactBackedResult,
          result: projectAgentToolResultEventValue(artifactBackedResult),
          presentation,
        };
        recorded.push({
          ...recordedResult,
          presentation,
        });
      } catch (error) {
        if (error instanceof AgentCancellationError) throw error;
        this.options.logger?.warn("tool.artifact.recording_failed", {
          toolName: result.name,
          toolCallId: result.callId,
          requestId: input.requestId,
          step: input.step,
          message: errorMessage(error),
        });
        recorded.push(markAgentToolArtifactUnavailable(result));
      }
    }
    return recorded;
  }

  private async projectSemanticObservation(
    result: ExecutedToolCallResult,
  ): Promise<AgentToolSemanticProjection | undefined> {
    const request = result.semanticProjectionRequest;
    if (!request) return undefined;
    try {
      const process = redactArtifactSecrets(result.process, result.artifactPolicy) as ExecutedToolCallResult["process"];
      const projection = await this.semanticProjector.project({
        request,
        toolName: result.name,
        toolCallId: result.callId,
        stdout: process.stdout,
        stderr: process.stderr,
        exitCode: process.exitCode,
      });
      if (projection.kind === "projected") return projection.value;
      this.options.logger?.warn("tool.semantic_projection.failed", {
        toolName: result.name,
        toolCallId: result.callId,
        projectionKind: request.kind,
        error: projection.message,
      });
    } catch (error) {
      if (error instanceof AgentCancellationError) throw error;
      this.options.logger?.warn("tool.semantic_projection.failed", {
        toolName: result.name,
        toolCallId: result.callId,
        projectionKind: request.kind,
        error: errorMessage(error),
      });
    }
    return undefined;
  }

  private async recordOne(input: {
    sessionId?: string;
    requestId: string;
    step: number;
    callIndex: number;
    result: ExecutedToolCallResult;
    previousEvidence: Set<string>;
  }): Promise<{ artifact: ExecutedToolCallArtifact; inline: boolean; inlinePayload?: unknown }> {
    const policy = input.result.artifactPolicy;
    const redactedInput = redactArtifactSecrets(input.result.arguments, policy);
    const redactedRaw = redactArtifactSecrets(input.result.result, policy);
    const redactedOutcome = redactArtifactToolOutcome(input.result.outcome, policy);
    const redactedRawResponse =
      input.result.artifactPayload?.rawResponse === undefined
        ? undefined
        : redactArtifactSecrets(input.result.artifactPayload.rawResponse, policy);
    const inline = this.shouldInlinePayload(redactedRaw);
    const inlinePayload = inline ? redactedRaw : undefined;
    const argsHash = stableArtifactHash(redactedInput);
    const resultHash = stableArtifactHash(redactedRaw);
    const redactionPolicySha256 = stableArtifactHash(policy ?? {});
    let payloadHash: string;
    try {
      payloadHash = await createAgentToolArtifactPayloadHash(input.result, redactedRaw, redactedOutcome);
    } catch (error) {
      await markAgentToolOutputCaptureFailed(input.result.outputCapture);
      throw error;
    }
    const locator = createAgentArtifactLocator({
      workspaceRoot: this.options.workspaceRoot,
      rootDir: this.options.config.RootDir,
      sessionId: input.sessionId,
      requestId: input.requestId,
      step: input.step,
      callIndex: input.callIndex,
      callId: input.result.callId,
      toolName: input.result.name,
      argsHash,
      resultHash,
      payloadHash,
    });
    const releasePublication = await this.publicationLeases.acquire(locator.artifactId);
    try {
      const reservation = await this.fileWriter.reserveArtifactDirectory(locator.absoluteDir);
      if (reservation === AgentArtifactDirectoryReservations.Existing) {
        const artifact = await this.recovery.restore({
          locator,
          sessionId: input.sessionId,
          result: input.result,
          previousEvidence: input.previousEvidence,
          policy,
          redactedInput,
          redactedRaw,
          redactedOutcome,
          argsHash,
          resultHash,
          payloadHash,
          redactionPolicySha256,
          inline,
        });
        await finalizeAgentToolOutputCapture(input.result.outputCapture);
        return { artifact, inline, inlinePayload };
      }
      const publication = new AgentArtifactPublicationSession({
        fileWriter: this.fileWriter,
        artifactDirectory: locator.absoluteDir,
        sessionId: input.sessionId,
        outputCapture: input.result.outputCapture,
      });
      try {
        await publication.begin();
        const materializedPayload = await materializeArtifactPayload(
          input.result.artifactPayload,
          locator,
          this.fileWriter,
        );
        const evidence = collectArtifactEvidence(
          redactedRaw,
          policy,
          locator.artifactId,
          projectAgentToolArtifactEvidenceCandidates({
            result: input.result,
            redactedResult: redactedRaw,
            policy,
            assets: materializedPayload?.assets,
            inline,
          }),
        );
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
        const workspaceArtifactsWithUri = workspaceArtifacts?.checkpoint
          ? {
              ...workspaceArtifacts,
              checkpoint: {
                ...workspaceArtifacts.checkpoint,
                artifactUri: locator.artifactUri,
              },
            }
          : workspaceArtifacts;
        const delta = buildArtifactDelta({
          evidence,
          previousEvidence: input.previousEvidence,
          workspaceChanges: workspaceArtifactsWithUri?.changes,
        });
        const workspaceProjection = workspaceArtifactsWithUri
          ? {
              before: workspaceArtifactsWithUri.before,
              after: workspaceArtifactsWithUri.after,
              changes: workspaceArtifactsWithUri.changes,
              ...(workspaceArtifactsWithUri.checkpoint ? { checkpoint: workspaceArtifactsWithUri.checkpoint } : {}),
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
          status: projectAgentExecutedToolResultStatus(input.result),
          failure: readAgentToolFailure(redactedOutcome),
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
          ...(materializedPayload?.assets ? { assets: materializedPayload.assets } : {}),
        };
        const artifact: ExecutedToolCallArtifact = {
          ...artifactBase,
          projection: buildArtifactProjection({
            artifact: artifactBase,
            toolName: input.result.name,
            callId: input.result.callId,
            args: redactedInput,
            result: redactedRaw,
            policy,
          }),
        };
        await publishToolArtifactFiles({
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
          payloadHash,
          redactionPolicySha256,
          redactedInput,
          redactedRaw,
          redactedRawResponse,
          redactedOutcome,
          workspaceRoot: locator.workspaceRoot,
          rootDir: locator.rootDir,
          absoluteDir: locator.absoluteDir,
          relativeDir: locator.relativeDir,
          workspaceArtifacts: workspaceArtifactsWithUri,
          artifactAssetReceipts: materializedPayload?.receipts,
        });
        await publication.commit();
        return { artifact, inline, inlinePayload };
      } catch (error) {
        await publication.fail();
        throw error;
      }
    } finally {
      releasePublication();
    }
  }

  private shouldInlinePayload(value: unknown): boolean {
    const limit = this.options.config.InlineResultMaxTokens;
    if (limit <= 0) return false;
    // Two-dimensional gate: the model receives the verbatim result, so both the
    // token budget (what the context window actually costs) and a raw UTF-8 size
    // bound (against high-compression text that tokenizes efficiently) must hold.
    const rawSize = estimateInlineUtf8Bytes(value);
    const fitsBudget =
      rawSize !== undefined &&
      rawSize <= this.options.config.InlineResultMaxBytes &&
      this.tokenProjector.countJson(value) <= limit;
    return fitsBudget;
  }
}

function estimateInlineUtf8Bytes(value: unknown): number | undefined {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? Buffer.byteLength(serialized, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

function projectArtifactBackedExecution(
  result: ExecutedToolCallResult,
): Omit<
  ExecutedToolCallResult,
  "artifactPayload" | "outputCapture" | "semanticProjectionRequest" | "workspaceCapture"
> {
  const {
    artifactPayload: _artifactPayload,
    outputCapture: _outputCapture,
    semanticProjectionRequest: _semanticProjectionRequest,
    workspaceCapture: _workspaceCapture,
    observationResult: _observationResult,
    ...persisted
  } = result;
  const hasDurableOutput =
    result.outputCapture !== undefined || result.process.stdout.length > 0 || result.process.stderr.length > 0;
  return hasDurableOutput
    ? {
        ...persisted,
        process: {
          ...result.process,
          stdout: "",
          stderr: "",
        },
      }
    : persisted;
}

async function materializeArtifactPayload(
  payload: ExecutedToolCallResult["artifactPayload"],
  locator: ReturnType<typeof createAgentArtifactLocator>,
  fileWriter: AgentArtifactFileWriter,
): Promise<
  | {
      assets: AgentToolArtifactAssetReference[];
      receipts: Map<string, AgentArtifactFileReceipt>;
    }
  | undefined
> {
  if (!payload) return undefined;
  const assets: AgentToolArtifactAssetReference[] = [];
  const receipts = new Map<string, AgentArtifactFileReceipt>();
  const usedFileNames = new Set<string>();
  const uniqueAssets = [...new Map((payload.assets ?? []).map((asset) => [asset.id, asset])).values()];
  for (const [index, asset] of uniqueAssets.entries()) {
    const extension = assetExtension(asset.mediaType, asset.fileName);
    const fileName = allocateAssetFileName(safeAssetSegment(asset.id, `asset-${index + 1}`), extension, usedFileNames);
    const relativePath = path.join("assets", fileName);
    const absolutePath = path.join(locator.absoluteDir, relativePath);
    const receipt = await fileWriter.writeBase64(absolutePath, asset.dataBase64);
    receipts.set(path.resolve(receipt.filePath), receipt);
    assets.push(
      createArtifactAssetReference({
        id: asset.id,
        fileName,
        mediaType: asset.mediaType,
        relativePath,
        receipt,
        locator,
      }),
    );
  }
  return { assets, receipts };
}

function createArtifactAssetReference(input: {
  id: string;
  fileName: string;
  mediaType: string;
  relativePath: string;
  receipt: AgentArtifactFileReceipt;
  locator: ReturnType<typeof createAgentArtifactLocator>;
}): AgentToolArtifactAssetReference {
  const relative = toPosixPath(input.relativePath);
  const resourceUri = createAgentResourceUri(createAgentResourceId(`${input.locator.artifactId}\u0000${input.id}`));
  return {
    id: input.id,
    resourceUri,
    fileName: input.fileName,
    mediaType: input.mediaType,
    relativePath: relative,
    workspacePath: `./${toPosixPath(path.join(input.locator.relativeDir, input.relativePath))}`,
    byteLength: input.receipt.byteLength,
    sha256: input.receipt.sha256,
  };
}

function projectArtifactAssetLinks(
  value: unknown,
  assets: readonly AgentToolArtifactAssetReference[] | undefined,
): unknown {
  if (!assets || assets.length === 0) return value;
  const links = new Map(
    assets.map((asset) => [createAgentResourceUri(createAgentResourceId(asset.id)), asset.resourceUri]),
  );
  return replaceArtifactAssetLinks(value, links);
}

function replaceArtifactAssetLinks(value: unknown, links: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") {
    let result = value;
    for (const [placeholder, link] of links) result = result.replaceAll(placeholder, link);
    return result;
  }
  if (Array.isArray(value)) return value.map((entry) => replaceArtifactAssetLinks(entry, links));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, replaceArtifactAssetLinks(entry, links)]),
    );
  }
  return value;
}

function assetExtension(mediaType: string, fileName: string): string {
  const fromName = path
    .extname(fileName)
    .slice(1)
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");
  if (fromName) return fromName;
  return mimeExtension(mediaType) || "bin";
}

function allocateAssetFileName(stem: string, extension: string, used: Set<string>): string {
  const base = `${stem}.${extension}`;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem}-${suffix}.${extension}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

function safeAssetSegment(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || fallback;
}
