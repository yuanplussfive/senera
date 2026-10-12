import { z } from "zod";
import { AgentStructuredModelClient } from "../ModelEndpoints/AgentStructuredModelClient.js";
import TypeBuilder from "../BamlClient/baml_client/type_builder.js";
import { AgentNativeToolApiByEndpoint } from "../ModelEndpoints/AgentModelEndpointContract.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { createAgentMemOSSemanticPromptCache } from "./AgentMemOSSemanticPromptCache.js";
import {
  AgentMemOSSemanticMemoryTypes,
  type AgentMemOSDigestPromptInput,
  type AgentMemOSFragmentPromptInput,
  type AgentMemOSSemanticFragment,
  type AgentMemOSSemanticCandidate,
  AgentMemOSSummarySchema,
} from "./AgentMemOSSemanticTypes.js";

const FragmentToolName = "MemOSSemanticFragment";
const DigestToolName = "MemOSPeriodDigest";
function fragmentFields(summaryCharacterLimit: number) {
  return {
    topic: z.string().trim().min(1),
    summary: AgentMemOSSummarySchema.max(summaryCharacterLimit),
    type: z.enum(AgentMemOSSemanticMemoryTypes),
  };
}

function createFragmentSchema(summaryCharacterLimit: number) {
  const fields = fragmentFields(summaryCharacterLimit);
  const newFragment = z.object({ ...fields, action: z.literal("new") }).strict();
  const candidate = z.number().int().nonnegative();
  return z.discriminatedUnion("action", [
    newFragment,
    z.object({ ...fields, action: z.literal("update"), candidate }).strict(),
    z.object({ ...fields, action: z.literal("supersede"), candidate }).strict(),
  ]);
}

function createFragmentExtractionSchema(
  summaryCharacterLimit: number,
  candidates: readonly AgentMemOSSemanticCandidate[],
) {
  const actions = new Map<string, Pick<AgentMemOSSemanticFragment, "action" | "candidate">>([
    ["new", { action: "new" }],
  ]);
  for (const candidate of candidates) {
    for (const action of ["update", "supersede"] as const) {
      actions.set(`${action}:${candidate.ref}`, { action, candidate: candidate.ref });
    }
  }
  return z
    .object({
      ...fragmentFields(summaryCharacterLimit),
      action: z.enum([...actions.keys()]),
    })
    .strict()
    .transform(({ action, ...fragment }) => ({ ...fragment, ...actions.get(action)! }));
}

export function createAgentMemOSExtractionRecordSchema(summaryCharacterLimit: number) {
  const [newFragment, updateFragment, supersedeFragment] = createFragmentSchema(summaryCharacterLimit).options;
  return z.union([
    z.object({ fragment: newFragment, candidateId: z.never().optional() }).strict(),
    z.object({ fragment: z.union([updateFragment, supersedeFragment]), candidateId: z.string().min(1) }).strict(),
  ]);
}

function createDigestSchema(summaryCharacterLimit: number) {
  return z.object({ summary: AgentMemOSSummarySchema.max(summaryCharacterLimit) }).strict();
}

function createFragmentSystemPrompt(summaryCharacterLimit: number): string {
  return [
    "Extract one memory from the completed turn, including explicit memoryIntents. Use history only to resolve context.",
    `Return a concrete topic, an evidence-based summary of at most ${summaryCharacterLimit} characters, and a native memory type. Routine requests are context; never invent facts or preferences.`,
    "Choose one allowed action: new for distinct knowledge; update:<ref> to confirm or refine a candidate; supersede:<ref> to replace contradictory knowledge. Preserve relevant existing information when updating.",
    "Return only the structured result; no prose or chain-of-thought.",
  ].join("\n");
}

function createDigestSystemPrompt(summaryCharacterLimit: number): string {
  return [
    "Compress the supplied semantic memory fragments into one period summary.",
    "Return only the requested structured result; never return prose or chain-of-thought.",
    "Preserve concrete people, places, dates, preferences, decisions, and unresolved items.",
    "Merge repeated information instead of listing it. Do not invent anything.",
    `The summary must be no longer than ${summaryCharacterLimit} characters.`,
  ].join("\n");
}

export class AgentMemOSSemanticModelClient {
  private readonly client: AgentStructuredModelClient;
  constructor(
    private readonly configuration: ResolvedAgentModelProviderConfig,
    private readonly cacheScopeKey: string,
    private readonly summaryCharacterLimit: number,
  ) {
    if (!Number.isSafeInteger(summaryCharacterLimit) || summaryCharacterLimit < 1)
      throw new Error("MemOS summary character limit must be a positive integer.");
    this.client = new AgentStructuredModelClient(configuration, "MemOSSemantic");
  }
  async extractFragment(
    input: AgentMemOSFragmentPromptInput,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<AgentMemOSSemanticFragment> {
    const schema = createFragmentExtractionSchema(this.summaryCharacterLimit, input.candidates);
    const actions = [
      "new",
      ...input.candidates.flatMap((candidate) => [`update:${candidate.ref}`, `supersede:${candidate.ref}`]),
    ];
    const tb = new TypeBuilder();
    tb.MemOSFragment.addProperty(
      "action",
      actions.length === 1
        ? tb.literalString(actions[0]!)
        : tb.union(actions.map((action) => tb.literalString(action))),
    );
    const systemPrompt = createFragmentSystemPrompt(this.summaryCharacterLimit);
    return this.client.execute({
      contract: {
        name: FragmentToolName,
        description: "Extract and reconcile one memory from a completed turn.",
        schema,
        bamlFunction: "ExtractMemOSFragment",
        bamlTypes: tb,
      },
      systemPrompt,
      userPrompt: JSON.stringify({
        current: {
          user: input.user,
          assistant: input.assistant,
          ...(input.stateCard ? { stateCard: input.stateCard } : {}),
          ...(input.memoryIntents.length ? { memoryIntents: input.memoryIntents } : {}),
        },
        ...(input.candidates.length ? { candidates: input.candidates } : {}),
        ...(input.history.length ? { history: input.history } : {}),
      }),
      requestId,
      signal,
      managedRetries: true,
      cache: this.cache("fragment", systemPrompt, z.toJSONSchema(schema, { io: "input", target: "draft-7" })),
    });
  }
  async summarizePeriod(
    input: AgentMemOSDigestPromptInput,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<{ readonly summary: string }> {
    if (!input.entries.length) throw new Error("MemOS period digest requires entries.");
    const schema = createDigestSchema(this.summaryCharacterLimit);
    const systemPrompt = createDigestSystemPrompt(this.summaryCharacterLimit);
    return this.client.execute({
      contract: {
        name: DigestToolName,
        description: "Compress memory fragments into one short period summary.",
        schema,
        bamlFunction: "SummarizeMemOSPeriod",
      },
      systemPrompt,
      userPrompt: JSON.stringify({ period: input.period, periodKey: input.periodKey, entries: input.entries }),
      requestId,
      signal,
      managedRetries: true,
      cache: this.cache(
        input.period === "day" ? "daily" : "monthly",
        systemPrompt,
        z.toJSONSchema(schema, { io: "input", target: "draft-7" }),
      ),
    });
  }
  private cache(phase: "fragment" | "daily" | "monthly", systemPrompt: string, contract: unknown) {
    return createAgentMemOSSemanticPromptCache({
      scopeKey: this.cacheScopeKey,
      phase,
      provider: this.configuration.ProviderId,
      api: AgentNativeToolApiByEndpoint[this.configuration.Endpoint],
      model: this.configuration.Model,
      systemPrompt,
      contract: JSON.stringify(contract),
    });
  }
}
