import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { GroundedDigest } from "../BamlClient/baml_client/types.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { readAgentString } from "../Core/AgentUnknownValue.js";
import { allocateAgentTokenBudget } from "../Text/AgentTokenAllocation.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import { AgentModelTokenEstimator } from "../Text/AgentTextBudget.js";
import type {
  AgentPiToolObservationDigestPromptInput,
  AgentPiToolObservationDigestSource,
} from "./AgentPiToolObservationDigestPrompt.js";
import {
  assertAgentPiToolObservationBounded,
  isAgentPiObservationContextProjected,
  isAgentPiToolResultMessage,
  projectAgentPiToolObservationDetail,
  agentPiToolObservationIdentity,
  readAgentPiMessageTextContent,
  readAgentPiToolObservation,
  writeAgentPiMessageTextContent,
  type AgentPiToolObservation,
} from "./AgentPiToolObservation.js";

export interface AgentPiToolObservationDigestModelClient {
  condenseToolObservations(
    input: AgentPiToolObservationDigestPromptInput,
    options?: { signal?: AbortSignal },
  ): Promise<GroundedDigest>;
}

export interface AgentPiToolObservationDigestRequest {
  readonly objective?: string;
  readonly targetTokens: number;
  readonly signal?: AbortSignal;
  readonly sourceIdentities?: readonly string[];
}

export interface AgentPiToolObservationDigestInspection {
  readonly sourceCount: number;
  readonly contentTokens: number;
}

export interface AgentPiToolObservationDigesterOptions {
  readonly client: AgentPiToolObservationDigestModelClient;
  readonly model: string;
  readonly contextWindowTokens: number;
  readonly outputReserveTokens: number;
  readonly maxCachedDigests?: number;
}

interface ObservationSource {
  readonly messageIndex: number;
  readonly observation: AgentPiToolObservation;
  readonly source: AgentPiToolObservationDigestSource;
}

type DigestOutcome =
  | { readonly state: "completed"; readonly digest: GroundedDigest }
  | { readonly state: "failed"; readonly error: unknown; reported: boolean };

export const AgentPiToolObservationDigestCacheDefaults = {
  MaxEntries: 32,
} as const;

export class AgentPiToolObservationDigester {
  constructor(private readonly options: AgentPiToolObservationDigesterOptions) {}

  createSession(): AgentPiToolObservationDigestSession {
    return new AgentPiToolObservationDigestSession(this.options);
  }
}

export class AgentPiToolObservationDigestSession {
  private readonly tokenProjector: AgentTokenProjector;
  private readonly tokenEstimator: AgentModelTokenEstimator;
  private readonly digests = new Map<string, Promise<DigestOutcome>>();
  private readonly maxCachedDigests: number;

  constructor(private readonly options: AgentPiToolObservationDigesterOptions) {
    this.tokenProjector = new AgentTokenProjector(options.model);
    this.tokenEstimator = new AgentModelTokenEstimator({ model: options.model });
    this.maxCachedDigests = resolveMaxCachedDigests(options.maxCachedDigests);
  }

  get targetTokens(): number {
    return this.options.outputReserveTokens;
  }

  inspect(
    messages: readonly AgentMessage[],
    sourceIdentities?: readonly string[],
  ): AgentPiToolObservationDigestInspection {
    const sources = this.collectSources(messages, sourceIdentities);
    return {
      sourceCount: sources.length,
      contentTokens: sources.reduce(
        (total, source) => total + this.tokenEstimator.estimate(source.source.content).tokenCount,
        0,
      ),
    };
  }

  async enrich(
    messages: readonly AgentMessage[],
    request: AgentPiToolObservationDigestRequest,
  ): Promise<AgentMessage[]> {
    const sources = this.collectSources(messages, request.sourceIdentities);
    if (sources.length === 0) return [...messages];

    const input = this.projectPromptInput(sources, request);
    const digest = await this.readDigest(this.digestIdentity(sources, request.objective), input, request.signal);
    if (!digest) return [...messages];
    if (digest.entries.length === 0) return [...messages];

    const target = sources[0];
    if (!target) return [...messages];
    const detail = projectAgentPiToolObservationDetail(target.observation);
    const content = JSON.stringify({
      ...target.observation,
      detail: {
        ...detail,
        semantic_digest: this.renderGroundedDigest(digest, request.targetTokens),
      },
    });
    return messages.map((message, index) =>
      index === target.messageIndex ? writeAgentPiMessageTextContent(message, content) : message,
    );
  }

  release(
    messages: readonly AgentMessage[],
    request: Pick<AgentPiToolObservationDigestRequest, "objective" | "sourceIdentities">,
  ): void {
    const sources = this.collectSources(messages, request.sourceIdentities);
    if (sources.length === 0) return;
    this.digests.delete(this.digestIdentity(sources, request.objective));
  }

  private collectSources(messages: readonly AgentMessage[], sourceIdentities?: readonly string[]): ObservationSource[] {
    const selectedIdentities = sourceIdentities ? new Set(sourceIdentities) : undefined;
    const sources = new Map<string, ObservationSource>();
    messages.forEach((message, messageIndex) => {
      if (!isAgentPiToolResultMessage(message)) return;
      const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
      if (!observation) return;
      assertAgentPiToolObservationBounded(observation);
      if (isAgentPiObservationContextProjected(observation)) return;
      if (selectedIdentities && !selectedIdentities.has(agentPiToolObservationIdentity(observation))) return;
      const id = readAgentString(observation.call_id);
      if (!id) return;
      sources.set(id, {
        messageIndex,
        observation,
        source: {
          id,
          toolName: readAgentString(observation.tool_name) ?? "",
          status: readAgentString(observation.status) ?? "unknown",
          artifactUri: readAgentString(observation.artifact_uri),
          content: JSON.stringify(projectAgentPiToolObservationDetail(observation)),
        },
      });
    });
    return [...sources.values()].sort((left, right) => left.source.id.localeCompare(right.source.id));
  }

  private projectPromptInput(
    sources: readonly ObservationSource[],
    request: AgentPiToolObservationDigestRequest,
  ): AgentPiToolObservationDigestPromptInput {
    const targetTokens = normalizePositiveTokenCount(request.targetTokens);
    const sourceRecords = sources.map((entry) => entry.source);
    const metadataTokens = this.tokenProjector.countJson({
      objective: request.objective,
      targetTokens,
      sources: sourceRecords.map((source) => ({ ...source, content: "" })),
    });
    const contentBudget = Math.max(
      0,
      this.options.contextWindowTokens - this.options.outputReserveTokens - metadataTokens,
    );
    const allocations = allocateAgentTokenBudget(
      sourceRecords.map((source) => ({
        identity: source.id,
        minimumTokens: 0,
        desiredTokens: this.tokenEstimator.estimate(source.content).tokenCount,
      })),
      contentBudget,
    );
    return {
      objective: request.objective,
      targetTokens,
      sources: sourceRecords.map((source) => {
        const allocated = allocations.get(source.id) ?? 0;
        return {
          ...source,
          content: allocated > 0 ? this.tokenProjector.previewText(source.content, allocated).text : "",
        };
      }),
    };
  }

  private readDigest(
    identity: string,
    input: AgentPiToolObservationDigestPromptInput,
    signal: AbortSignal | undefined,
  ): Promise<GroundedDigest | undefined> {
    const existing = this.digests.get(identity);
    if (existing) {
      this.digests.delete(identity);
      this.digests.set(identity, existing);
    }
    const pending =
      existing ??
      this.options.client
        .condenseToolObservations(input, { signal })
        .then<DigestOutcome>((digest) => ({ state: "completed", digest }))
        .catch<DigestOutcome>((error: unknown) => ({ state: "failed", error, reported: false }));
    if (!existing) this.cacheDigest(identity, pending);
    return pending.then((outcome) => {
      if (outcome.state === "completed") return outcome.digest;
      if (outcome.reported) return undefined;
      outcome.reported = true;
      throw outcome.error;
    });
  }

  private cacheDigest(identity: string, pending: Promise<DigestOutcome>): void {
    if (this.maxCachedDigests === 0) return;
    while (this.digests.size >= this.maxCachedDigests) {
      const oldestIdentity = this.digests.keys().next().value;
      if (oldestIdentity === undefined) break;
      this.digests.delete(oldestIdentity);
    }
    this.digests.set(identity, pending);
  }

  private digestIdentity(sources: readonly ObservationSource[], objective: string | undefined): string {
    return sha256HexOfCanonicalJson({
      objective,
      sources: sources.map(({ source }) => source),
    });
  }

  private renderGroundedDigest(digest: GroundedDigest, requestedTokenLimit: number): string {
    const tokenLimit = normalizePositiveTokenCount(requestedTokenLimit);
    const lines: string[] = [];
    for (const entry of digest.entries) {
      const references = `[${entry.sources.join(", ")}]`;
      const line = `- ${entry.text} ${references}`;
      const candidate = [...lines, line].join("\n");
      if (!this.tokenProjector.previewText(candidate, tokenLimit).truncated) {
        lines.push(line);
        continue;
      }
      if (lines.length === 0) {
        const framingTokens = this.tokenEstimator.estimate(`-  ${references}`).tokenCount;
        const textBudget = Math.max(1, tokenLimit - framingTokens);
        lines.push(`- ${this.tokenProjector.previewText(entry.text, textBudget).text} ${references}`);
      }
      break;
    }
    return lines.join("\n");
  }
}

function normalizePositiveTokenCount(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

function resolveMaxCachedDigests(value: number | undefined): number {
  const resolved = value ?? AgentPiToolObservationDigestCacheDefaults.MaxEntries;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Error(`Pi tool observation digest maxCachedDigests must be a non-negative safe integer: ${resolved}`);
  }
  return resolved;
}
