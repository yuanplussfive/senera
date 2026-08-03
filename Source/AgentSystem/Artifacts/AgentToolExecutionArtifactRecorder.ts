import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import { projectAgentToolResultPresentation } from "../ToolRuntime/AgentToolResultPresentation.js";
import { projectAgentExecutedToolResultStatus, readAgentToolFailure } from "../ToolRuntime/AgentToolResultOutcome.js";
import type { ResolvedAgentArtifactsConfig } from "../Types/AgentConfigTypes.js";
import type { ExecutedToolCallArtifact, ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { buildArtifactDelta } from "./AgentArtifactDeltaProjection.js";
import { AgentArtifactDirectoryReservations, AgentArtifactFileWriter } from "./AgentArtifactFileWriter.js";
import { createAgentArtifactLocator } from "./AgentArtifactLocator.js";
import { AgentArtifactPublicationRecovery } from "./AgentArtifactPublicationRecovery.js";
import { collectArtifactEvidence } from "./AgentArtifactEvidenceProjection.js";
import { redactArtifactSecrets, redactArtifactToolOutcome } from "./AgentArtifactRedaction.js";
import { stableArtifactHash } from "./AgentArtifactStableJson.js";
import { buildArtifactProjection, buildArtifactSummary } from "./AgentArtifactTemplateProjection.js";
import { AgentArtifactPublicationSession, publishToolArtifactFiles } from "./AgentToolArtifactFilePublisher.js";
import { AgentToolResultSummaryCompiler } from "./AgentToolResultSummaryCompiler.js";
import { writeToolWorkspaceArtifacts } from "./AgentToolWorkspaceArtifactRecorder.js";

export { AgentArtifactPublicationConflictError } from "./AgentArtifactPublicationRecovery.js";

export interface AgentToolExecutionArtifactRecorderOptions {
  readonly workspaceRoot: string;
  readonly config: ResolvedAgentArtifactsConfig;
  readonly model: string;
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
      const artifact = await this.recordOne({
        sessionId: input.sessionId,
        requestId: input.requestId,
        step: input.step,
        callIndex: index + 1,
        result,
        previousEvidence,
      });
      artifact.evidence.forEach((entry) => previousEvidence.add(entry.key));
      const recordedResult = { ...result, artifact };
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
    const policy = input.result.artifactPolicy;
    const redactedInput = redactArtifactSecrets(input.result.arguments, policy);
    const redactedRaw = redactArtifactSecrets(input.result.result, policy);
    const redactedOutcome = redactArtifactToolOutcome(input.result.outcome, policy);
    const argsHash = stableArtifactHash(redactedInput);
    const resultHash = stableArtifactHash(redactedRaw);
    const redactionPolicySha256 = stableArtifactHash(policy ?? {});
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
    });
    const releasePublication = await this.publicationLeases.acquire(locator.artifactId);
    try {
      const reservation = await this.fileWriter.reserveArtifactDirectory(locator.absoluteDir);
      if (reservation === AgentArtifactDirectoryReservations.Existing) {
        return this.recovery.restore({
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
          redactionPolicySha256,
        });
      }
      const publication = new AgentArtifactPublicationSession({
        fileWriter: this.fileWriter,
        artifactDirectory: locator.absoluteDir,
        sessionId: input.sessionId,
        outputCapture: input.result.outputCapture,
      });
      try {
        await publication.begin();
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
          redactionPolicySha256,
          redactedInput,
          redactedRaw,
          redactedOutcome,
          workspaceRoot: locator.workspaceRoot,
          rootDir: locator.rootDir,
          absoluteDir: locator.absoluteDir,
          relativeDir: locator.relativeDir,
          workspaceArtifacts,
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
