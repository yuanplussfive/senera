import path from "node:path";
import { createAgentResourceId, createAgentResourceUri } from "../Resources/AgentResourceUri.js";
import { extension as mimeExtension } from "mime-types";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import { projectAgentToolResultPresentation } from "../ToolRuntime/AgentToolResultPresentation.js";
import {
  AgentToolAssessmentStatuses,
  projectAgentExecutedToolResultStatus,
  readAgentToolFailure,
} from "../ToolRuntime/AgentToolResultOutcome.js";
import type { ResolvedAgentArtifactsConfig } from "../Types/AgentConfigTypes.js";
import type {
  AgentToolArtifactAssetReference,
  ExecutedToolCallArtifact,
  ExecutedToolCallResult,
  ToolWorkspaceCaptureResult,
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
import { createAgentToolArtifactPayloadHash } from "./AgentToolArtifactPayloadIdentity.js";
import { writeToolWorkspaceArtifacts } from "./AgentToolWorkspaceArtifactRecorder.js";
import type { WrittenWorkspaceArtifacts } from "./AgentWorkspaceArtifactWriter.js";
import { toPosixPath } from "./AgentArtifactLocator.js";
import type { AgentArtifactFileReceipt } from "./AgentArtifactIntegrity.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { AgentCancellationError } from "../Core/AgentCancellation.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { markAgentToolArtifactUnavailable } from "./AgentToolArtifactAvailability.js";
import { projectAgentToolArtifactEvidenceCandidates } from "./AgentToolArtifactEvidenceCandidates.js";
import {
  AgentToolSourceViewInvariantError,
  assertAgentToolSourceViewExecution,
  assertAgentToolSourceViewReferences,
} from "./AgentToolSourceView.js";
import { isAgentToolResultSourceView } from "../Types/ToolRuntimeTypes.js";

export { AgentArtifactPublicationConflictError } from "./AgentArtifactPublicationRecovery.js";

export interface AgentToolExecutionArtifactRecorderOptions {
  readonly workspaceRoot: string;
  readonly config: ResolvedAgentArtifactsConfig;
  readonly model: string;
  readonly logger?: AgentLogger;
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

  constructor(private readonly options: AgentToolExecutionArtifactRecorderOptions) {
    this.fileWriter = new AgentArtifactFileWriter(options.workspaceRoot);
    this.summaryCompiler = new AgentToolResultSummaryCompiler({ model: options.model });
    this.recovery = new AgentArtifactPublicationRecovery(this.fileWriter, this.summaryCompiler);
  }

  async record(input: RecordToolArtifactsInput): Promise<ExecutedToolCallResult[]> {
    const previousEvidence = new Set<string>();
    const recorded: ExecutedToolCallResult[] = [];
    for (const [index, result] of input.results.entries()) {
      try {
        if (isAgentToolResultSourceView(result)) {
          recorded.push(await this.recordSourceView(result));
          continue;
        }
        const artifact = await this.recordOne({
          sessionId: input.sessionId,
          requestId: input.requestId,
          step: input.step,
          callIndex: index + 1,
          result,
          previousEvidence,
        });
        artifact.evidence.forEach((entry) => previousEvidence.add(entry.key));
        const resultWithoutPayload = projectArtifactBackedExecution(result);
        const artifactBackedResult = {
          ...resultWithoutPayload,
          result: projectArtifactAssetLinks(result.result, artifact.assets),
          artifact,
        };
        const presentation = projectAgentToolResultPresentation(artifactBackedResult);
        const recordedResult = {
          ...artifactBackedResult,
          presentation,
        };
        recorded.push({
          ...recordedResult,
          presentation,
        });
      } catch (error) {
        if (error instanceof AgentCancellationError || error instanceof AgentToolSourceViewInvariantError) throw error;
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

  /**
   * Source views expose a bounded read during this turn, but their durable
   * source was published before this call. Recording them again would create
   * a nested artifact chain and duplicate the page in every history layer.
   */
  private async recordSourceView(result: ExecutedToolCallResult): Promise<ExecutedToolCallResult> {
    const policy = result.artifactPolicy;
    const redactedResult = redactArtifactSecrets(result.result, policy);
    const sourceArtifacts = result.sourceArtifacts ?? [];
    if (result.outcome.assessment.status !== AgentToolAssessmentStatuses.Failure) {
      assertAgentToolSourceViewExecution(result);
      assertAgentToolSourceViewReferences(result.name, sourceArtifacts);
    } else {
      await markAgentToolOutputCaptureFailed(result.outputCapture);
    }
    const sourceView = {
      ...projectAgentToolPersistentExecution(result),
      result: redactedResult,
      ...(sourceArtifacts.length > 0 ? { sourceArtifacts } : {}),
    };
    return {
      ...sourceView,
      presentation: projectAgentToolResultPresentation(sourceView),
    };
  }

  private async recordOne(input: {
    sessionId?: string;
    requestId: string;
    step: number;
    callIndex: number;
    result: ExecutedToolCallResult;
    previousEvidence: Set<string>;
  }): Promise<ExecutedToolCallArtifact> {
    const policy = input.result.artifactPolicy;
    const redactedInput = redactArtifactSecrets(input.result.arguments, policy);
    const redactedRaw = redactArtifactSecrets(input.result.result, policy);
    const redactedOutcome = redactArtifactToolOutcome(input.result.outcome, policy);
    const redactedRawResponse =
      input.result.artifactPayload?.rawResponse === undefined
        ? undefined
        : redactArtifactSecrets(input.result.artifactPayload.rawResponse, policy);
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
        });
        await finalizeAgentToolOutputCapture(input.result.outputCapture);
        return artifact;
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
        const workspaceArtifacts = input.result.workspaceCapture
          ? await writeToolWorkspaceArtifacts({
              artifactId: locator.artifactId,
              workspaceRoot: this.options.workspaceRoot,
              policy,
              toolName: input.result.name,
              defaultPatchContextLines: this.options.config.WorkspacePatchContextLines,
              workspaceCapture: input.result.workspaceCapture,
              artifactDir: locator.absoluteDir,
              files: locator.files,
              fileWriter: this.fileWriter,
            })
          : undefined;
        const assets = [
          ...(materializedPayload?.assets ?? []),
          ...(workspaceArtifacts?.patchAsset ? [workspaceArtifacts.patchAsset] : []),
        ];
        const evidence = collectArtifactEvidence(
          redactedRaw,
          policy,
          locator.artifactId,
          projectAgentToolArtifactEvidenceCandidates({
            result: input.result,
            redactedResult: redactedRaw,
            policy,
            assets,
          }),
        );
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
          ? projectWrittenWorkspaceCapture(workspaceArtifactsWithUri)
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
          ...(assets.length > 0 ? { assets } : {}),
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
        return artifact;
      } catch (error) {
        await publication.fail();
        throw error;
      }
    } finally {
      releasePublication();
    }
  }
}

function projectWrittenWorkspaceCapture(input: WrittenWorkspaceArtifacts): ToolWorkspaceCaptureResult {
  return {
    ...(input.type ? { type: input.type } : {}),
    ...(input.version ? { version: input.version } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.sources ? { sources: input.sources } : {}),
    ...(input.coverage ? { coverage: input.coverage } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.revision === undefined ? {} : { revision: input.revision }),
    before: input.before,
    after: input.after,
    changes: input.changes,
    ...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
  };
}

function projectArtifactBackedExecution(
  result: ExecutedToolCallResult,
): Omit<ExecutedToolCallResult, "artifactPayload" | "outputCapture" | "workspaceCapture" | "workspaceObservation"> {
  const persisted = projectAgentToolPersistentExecution(result);
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

/** Removes runtime-only payloads before either persistence strategy records a result. */
function projectAgentToolPersistentExecution(
  result: ExecutedToolCallResult,
): Omit<ExecutedToolCallResult, "artifactPayload" | "outputCapture" | "workspaceCapture" | "workspaceObservation"> {
  const {
    artifactPayload: _artifactPayload,
    outputCapture: _outputCapture,
    workspaceCapture: _workspaceCapture,
    workspaceObservation: _workspaceObservation,
    ...persisted
  } = result;
  return persisted;
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
