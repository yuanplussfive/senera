import { z } from "zod";
import { AgentStructuredModelClient } from "../ModelEndpoints/AgentStructuredModelClient.js";
import TypeBuilder from "../BamlClient/baml_client/type_builder.js";
import { AgentNativeToolApiByEndpoint } from "../ModelEndpoints/AgentModelEndpointContract.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { createAgentMemOSSemanticPromptCache } from "./AgentMemOSSemanticPromptCache.js";
import { AgentMemoryUtilityAssessmentSchema, AgentMemoryUtilityVersion } from "./AgentMemoryUtilityContract.js";
import {
  AgentMemOSSemanticMemoryTypes,
  type AgentMemOSFragmentPromptInput,
  type AgentMemOSSemanticDecision,
  type AgentMemOSSemanticFragment,
  type AgentMemOSSemanticCandidate,
  AgentMemOSSummarySchema,
} from "./AgentMemOSSemanticTypes.js";

const FragmentToolName = "MemOSSemanticFragment";
function createSummarySchema(summaryTokenLimit: number) {
  return AgentMemOSSummarySchema.describe(
    `A non-empty summary. The returned text is normalized to the configured ${summaryTokenLimit}-token budget after parsing.`,
  );
}

function fragmentFields(summaryTokenLimit: number) {
  return {
    topic: z.string().trim().min(1),
    summary: createSummarySchema(summaryTokenLimit),
    type: z.enum(AgentMemOSSemanticMemoryTypes),
    assessments: z.array(AgentMemoryUtilityAssessmentSchema),
  };
}

function createFragmentSchema(summaryTokenLimit: number) {
  const fields = fragmentFields(summaryTokenLimit);
  const skip = z
    .object({ action: z.literal("skip"), assessments: z.array(AgentMemoryUtilityAssessmentSchema) })
    .strict();
  const newFragment = z.object({ ...fields, action: z.literal("new") }).strict();
  const candidate = z.number().int().nonnegative();
  return z.union([
    skip,
    z.discriminatedUnion("action", [
      newFragment,
      z.object({ ...fields, action: z.literal("update"), candidate }).strict(),
      z.object({ ...fields, action: z.literal("supersede"), candidate }).strict(),
    ]),
  ]);
}

function createFragmentExtractionSchema(summaryTokenLimit: number, candidates: readonly AgentMemOSSemanticCandidate[]) {
  const actions = new Map<string, Pick<AgentMemOSSemanticFragment, "action" | "candidate">>([
    ["new", { action: "new" }],
  ]);
  for (const candidate of candidates) {
    if (candidate.assessmentOnly) continue;
    for (const action of ["update", "supersede"] as const) {
      actions.set(`${action}:${candidate.ref}`, { action, candidate: candidate.ref });
    }
  }
  return z.union([
    z.object({ action: z.literal("skip"), assessments: z.array(AgentMemoryUtilityAssessmentSchema) }).strict(),
    z
      .object({
        ...fragmentFields(summaryTokenLimit),
        action: z.enum([...actions.keys()]),
      })
      .strict()
      .transform(({ action, ...fragment }) => ({ ...fragment, ...actions.get(action)! })),
  ]);
}

export function createAgentMemOSExtractionRecordSchema(summaryTokenLimit: number) {
  const [skip, writable] = createFragmentSchema(summaryTokenLimit).options;
  const [newFragment, updateFragment, supersedeFragment] = writable.options;
  const assessmentFields = {
    assessmentVersion: z.literal(AgentMemoryUtilityVersion),
    assessmentTargets: z.array(z.string().min(1)),
    /** Missing only from extractions predating delivery-bound cache identity. */
    deliveryRevision: z.string().min(1).optional(),
  };
  return z.union([
    z
      .object({
        fragment: skip,
        ...assessmentFields,
        candidateId: z.never().optional(),
      })
      .strict(),
    z
      .object({
        fragment: newFragment,
        ...assessmentFields,
        candidateId: z.never().optional(),
      })
      .strict(),
    z
      .object({
        fragment: z.union([updateFragment, supersedeFragment]),
        ...assessmentFields,
        candidateId: z.string().min(1),
      })
      .strict(),
  ]);
}

function createFragmentSystemPrompt(summaryTokenLimit: number): string {
  return [
    "Decide whether this completed turn contains one durable, dynamic memory. Use history only to resolve context.",
    "The host-bound current.subject identifies the person whose memory is being learned. Group speakers and quoted people remain separate. Do not turn another participant's statements, preferences or relationships into this person's memory, and do not treat the workspace owner profile as every channel speaker. Task context may describe collaboration with explicitly distinct participants.",
    "The assistant field is your own prior response, not independent evidence. Do not derive memories from its wording, roleplay, self-description, promises, or relationships.",
    "Do not retain profile names, assistant names, roleplay character names, persona settings, or fictional relationships. Use 用户 for the current person and 我 for yourself when either reference is essential to a real durable fact.",
    `If there is no evidence-backed preference, decision, task state, tool-confirmed result, external fact, or explicit memoryIntent worth retaining, return skip. Otherwise return a concrete topic, an evidence-based summary of at most ${summaryTokenLimit} model tokens, and exactly one of fact, preference, relationship, or context. fact, preference, and relationship describe reusable knowledge. context records a task's progress, attempts, conditions, outcomes and unresolved work; it may later be recalled as historical experience in another conversation. Preserve the conditions that distinguish historical outcomes from current state. Routine requests are context; never invent facts or preferences. Fact retention is assessed separately after extraction.`,
    "Choose new for distinct knowledge; update:<ref> to confirm or refine a candidate; supersede:<ref> to replace contradictory knowledge. Preserve relevant existing information when updating.",
    "Learn from current user statements and actual tool results supplied in sources. History resolves context; assistant prose alone cannot establish new facts. Do not produce evidence quotes, support/contradiction scores, confidence or importance estimates. Preserve relevant existing information when updating; supersede an explicit correction instead of making preferences compete on a score.",
    "For EVERY candidate marked delivered, return exactly one assessment with candidate ref, usefulness and a concrete reason. Do not assess other candidates. This is mandatory even with action skip; skip means no memory write, not no evaluation. Return an empty assessments array only when nothing was delivered.",
    "Evaluate actual use against deliveredVersions when provided: these are the immutable versions the task saw. The candidate summary is the current knowledge and may have changed since delivery; use it for update/supersede decisions, not to rewrite what the earlier task received.",
    "Candidates marked assessmentOnly describe delivered knowledge without write authority. Assess their use, but never update or supersede them.",
    "Use helpful when the final response or task execution actually uses the memory: answering a question about a known preference, tailoring a recommendation, or following remembered constraints are helpful uses. Use unhelpful only when using it demonstrably hindered the task. Use unused when it played no role; uncertain when the visible record cannot determine use. Mere delivery or task success does not imply usefulness. Your prior response is valid evidence of use, but not of a memory's truth. Do not require the user to repeat a known preference or explicitly praise its use.",
    "Return only the structured result; no prose or chain-of-thought.",
  ].join("\n");
}

export class AgentMemOSSemanticModelClient {
  private readonly client: AgentStructuredModelClient;
  private readonly textProjector: AgentTokenProjector;
  constructor(
    private readonly configuration: ResolvedAgentModelProviderConfig,
    private readonly cacheScopeKey: string,
    private readonly summaryTokenLimit: number,
  ) {
    if (!Number.isSafeInteger(summaryTokenLimit) || summaryTokenLimit < 1)
      throw new Error("MemOS summary token limit must be a positive integer.");
    this.client = new AgentStructuredModelClient(configuration, "MemOSSemantic");
    this.textProjector = new AgentTokenProjector(configuration.Model);
  }

  private projectSummary(summary: string): string {
    return this.textProjector.projectText(summary, this.summaryTokenLimit).text;
  }

  normalizeFragment(fragment: AgentMemOSSemanticFragment): AgentMemOSSemanticFragment {
    return { ...fragment, summary: this.projectSummary(fragment.summary) };
  }

  async extractFragment(
    input: AgentMemOSFragmentPromptInput,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<AgentMemOSSemanticDecision> {
    const schema = createFragmentExtractionSchema(this.summaryTokenLimit, input.candidates).superRefine(
      (decision, context) => {
        const seen = new Set<number>();
        for (const assessment of decision.assessments) {
          const candidate = input.candidates.find((candidate) => candidate.ref === assessment.candidate);
          if (!candidate?.delivered || seen.has(assessment.candidate))
            context.addIssue({ code: "custom", message: "Assess each delivered candidate exactly once." });
          seen.add(assessment.candidate);
        }
        if (input.candidates.some((candidate) => candidate.delivered && !seen.has(candidate.ref)))
          context.addIssue({
            code: "custom",
            message: "Every delivered memory requires a task assessment, including skip.",
          });
      },
    );
    const actions = [
      "new",
      ...input.candidates.flatMap((candidate) =>
        candidate.assessmentOnly ? [] : [`update:${candidate.ref}`, `supersede:${candidate.ref}`],
      ),
    ];
    const tb = new TypeBuilder();
    tb.MemOSFragment.addProperty(
      "action",
      actions.length === 1
        ? tb.literalString(actions[0]!)
        : tb.union(actions.map((action) => tb.literalString(action))),
    );
    const systemPrompt = createFragmentSystemPrompt(this.summaryTokenLimit);
    const candidates = input.candidates.map((candidate) => ({
      ...candidate,
      summary: this.projectSummary(candidate.summary),
      ...(candidate.deliveredVersions
        ? {
            deliveredVersions: candidate.deliveredVersions.map((version) => ({
              ...version,
              summary: this.projectSummary(version.summary),
            })),
          }
        : {}),
    }));
    const result = await this.client.execute({
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
          ...(input.subject
            ? {
                subject: {
                  kind: input.subject.kind,
                  ...(input.subject.reference ? { reference: input.subject.reference } : {}),
                },
              }
            : {}),
          user: input.user,
          assistant: input.assistant,
          ...(input.stateCard ? { stateCard: input.stateCard } : {}),
          ...(input.memoryIntents.length ? { memoryIntents: input.memoryIntents } : {}),
        },
        ...(candidates.length ? { candidates } : {}),
        ...(input.history.length ? { history: input.history } : {}),
        ...(input.sources?.length ? { sources: input.sources } : {}),
      }),
      requestId,
      signal,
      managedRetries: true,
      cache: this.cache("fragment", systemPrompt, z.toJSONSchema(schema, { io: "input", target: "draft-7" })),
    });
    return result.action === "skip" ? result : this.normalizeFragment(result);
  }
  private cache(phase: "fragment", systemPrompt: string, contract: unknown) {
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
