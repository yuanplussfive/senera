import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import {
  ArtifactManifestRecordSchema,
  type ArtifactManifestContentRecord,
  type ReadableArtifactRef,
} from "../Memory/AgentArtifactMemoryTypes.js";
import { projectAgentExecutedToolResultStatus, readAgentToolFailure } from "../ToolRuntime/AgentToolResultOutcome.js";
import type { ExecutedToolCallArtifact, ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { buildArtifactDelta } from "./AgentArtifactDeltaProjection.js";
import type { AgentArtifactFileWriter } from "./AgentArtifactFileWriter.js";
import type { createAgentArtifactLocator } from "./AgentArtifactLocator.js";
import { collectArtifactEvidence } from "./AgentArtifactEvidenceProjection.js";
import { buildArtifactSummary } from "./AgentArtifactTemplateProjection.js";
import type { AgentToolResultSummaryCompiler } from "./AgentToolResultSummaryCompiler.js";

export interface RestorePublishedArtifactInput {
  readonly locator: ReturnType<typeof createAgentArtifactLocator>;
  readonly sessionId?: string;
  readonly result: ExecutedToolCallResult;
  readonly previousEvidence: ReadonlySet<string>;
  readonly policy: ExecutedToolCallResult["artifactPolicy"];
  readonly redactedInput: unknown;
  readonly redactedRaw: unknown;
  readonly redactedOutcome: ExecutedToolCallResult["outcome"];
  readonly argsHash: string;
  readonly resultHash: string;
  readonly redactionPolicySha256: string;
}

export class AgentArtifactPublicationRecovery {
  constructor(
    private readonly fileWriter: AgentArtifactFileWriter,
    private readonly summaryCompiler: AgentToolResultSummaryCompiler,
  ) {}

  async restore(input: RestorePublishedArtifactInput): Promise<ExecutedToolCallArtifact> {
    const manifestSource = await fs.readFile(input.locator.files.manifest, "utf8").catch((error: unknown) => {
      throw new AgentArtifactPublicationConflictError(input.locator.absoluteDir, "published manifest is unavailable", {
        cause: error,
      });
    });
    let manifest = ArtifactManifestRecordSchema.parse(parseJsonText(manifestSource, "Artifact manifest") as unknown);
    const identity = ArtifactPublicationIdentitySchema.parse(manifest);
    const expectedIdentity: ArtifactPublicationIdentity = {
      artifactId: input.locator.artifactId,
      artifactUri: input.locator.artifactUri,
      callId: input.result.callId,
      toolName: input.result.name,
      argsHash: input.argsHash,
      resultHash: input.resultHash,
      redactionPolicySha256: input.redactionPolicySha256,
    };
    if (!publicationIdentityMatches(identity, expectedIdentity)) {
      throw new AgentArtifactPublicationConflictError(
        input.locator.absoluteDir,
        "published identity does not match retry",
      );
    }
    manifest = await this.ensureOwner(manifest, input.sessionId, input.locator.files.manifest);

    const [summary, projection] = await Promise.all([
      this.readPublishedText(input.locator.files.summary, manifest.contents, "summary"),
      this.readPublishedText(input.locator.files.projection, manifest.contents, "projection"),
    ]);
    const evidence = collectArtifactEvidence(input.redactedRaw, input.policy, input.locator.artifactId);
    const workspace = input.result.workspaceCapture;
    const delta = buildArtifactDelta({
      evidence,
      previousEvidence: input.previousEvidence,
      workspaceChanges: workspace?.changes,
    });
    const deterministicSummary = buildArtifactSummary({
      toolName: input.result.name,
      callId: input.result.callId,
      args: input.redactedInput,
      result: input.redactedRaw,
      evidence,
      delta,
      policy: input.policy,
      artifact: {
        artifactId: input.locator.artifactId,
        artifactUri: input.locator.artifactUri,
        artifactPath: input.locator.absoluteDir,
        relativePath: input.locator.relativeDir,
      },
      workspace,
    });
    return {
      artifactId: input.locator.artifactId,
      artifactUri: input.locator.artifactUri,
      artifactPath: input.locator.absoluteDir,
      relativePath: input.locator.relativeDir,
      manifestPath: input.locator.files.manifest,
      files: input.locator.files,
      summary,
      projection,
      structuredSummary: this.summaryCompiler.compile({
        toolName: input.result.name,
        callId: input.result.callId,
        status: projectAgentExecutedToolResultStatus(input.result),
        failure: readAgentToolFailure(input.redactedOutcome),
        artifactUri: input.locator.artifactUri,
        deterministicSummary,
        result: input.redactedRaw,
        evidence,
        delta,
        workspace,
      }),
      evidence,
      delta,
      workspace,
    };
  }

  private async ensureOwner(
    manifest: z.infer<typeof ArtifactManifestRecordSchema>,
    sessionId: string | undefined,
    manifestPath: string,
  ): Promise<z.infer<typeof ArtifactManifestRecordSchema>> {
    const owner = sessionId?.trim();
    if (!owner) return manifest;
    const currentOwners = [manifest.sessionId, ...(manifest.sessionIds ?? [])].filter((value): value is string =>
      Boolean(value),
    );
    if (currentOwners.includes(owner)) return manifest;
    const sessionIds = [...new Set([...currentOwners, owner])].sort((left, right) => left.localeCompare(right));
    const updated = ArtifactManifestRecordSchema.parse({
      ...manifest,
      sessionId: sessionIds[0],
      sessionIds,
    });
    await this.fileWriter.writeJson(manifestPath, updated);
    return updated;
  }

  private readPublishedText(
    filePath: string,
    contents: readonly ArtifactManifestContentRecord[] | undefined,
    ref: ReadableArtifactRef,
  ): Promise<string> {
    const content = contents?.find((entry) => entry.ref === ref);
    if (!content) {
      throw new AgentArtifactPublicationConflictError(
        path.dirname(filePath),
        `published ${ref} identity is unavailable`,
      );
    }
    return this.fileWriter.readVerifiedText(filePath, content);
  }
}

const ArtifactPublicationIdentitySchema = z
  .object({
    artifactId: z.string().min(1),
    artifactUri: z.string().min(1),
    callId: z.string().min(1),
    toolName: z.string().min(1),
    argsHash: z.string().min(1),
    resultHash: z.string().min(1),
    redactionPolicySha256: z.string().min(1),
  })
  .passthrough();

type ArtifactPublicationIdentity = Pick<
  z.infer<typeof ArtifactPublicationIdentitySchema>,
  "artifactId" | "artifactUri" | "callId" | "toolName" | "argsHash" | "resultHash" | "redactionPolicySha256"
>;

const ArtifactPublicationIdentityFields = [
  "artifactId",
  "artifactUri",
  "callId",
  "toolName",
  "argsHash",
  "resultHash",
  "redactionPolicySha256",
] as const satisfies readonly (keyof ArtifactPublicationIdentity)[];

function publicationIdentityMatches(
  actual: ArtifactPublicationIdentity,
  expected: ArtifactPublicationIdentity,
): boolean {
  return ArtifactPublicationIdentityFields.every((field) => actual[field] === expected[field]);
}

export class AgentArtifactPublicationConflictError extends AgentBaseError {
  readonly code = "ArtifactPublicationConflict" as const;

  constructor(
    readonly artifactDirectory: string,
    reason: string,
    options?: ErrorOptions,
  ) {
    super(`Artifact publication conflict at ${artifactDirectory}: ${reason}.`, options);
  }
}
