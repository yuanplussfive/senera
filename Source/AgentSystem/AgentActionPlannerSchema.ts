import { z } from "zod";
import {
  ActionKind,
  type ActionDecision as BamlActionDecision,
  type ActionSelection as BamlActionSelection,
} from "./BamlClient/baml_client/index.js";
import type { AgentToolCatalogItem } from "./AgentToolCatalogProjector.js";
import type {
  AgentActionCapabilityNeed,
  AgentActionDecision,
  AgentActionKind,
} from "./AgentActionPlannerTypes.js";

const ActionSelectionSchema = z
  .object({
    action: z.enum(ActionKind),
  })
  .strict();

const ActionDecisionSchema = z
  .object({
    action: z.enum(ActionKind),
    answer: z.object({
      content: z.string(),
    }).nullish(),
    askUser: z.object({
      question: z.string(),
      reason: z.string().nullish(),
    }).nullish(),
    useTools: z.object({
      preferredTools: z.array(z.string()),
      instruction: z.string(),
    }).nullish(),
    discoverTools: z.object({
      queries: z.array(z.string()),
      needs: z.array(z.object({
        actions: z.array(z.string()).nullish(),
        targets: z.array(z.string()).nullish(),
        inputs: z.array(z.string()).nullish(),
        outputs: z.array(z.string()).nullish(),
        evidence: z.array(z.string()).nullish(),
        effects: z.array(z.string()).nullish(),
      }).strict()),
    }).nullish(),
  })
  .strict()
  .superRefine((decision, context) => {
    const payloadKeys = ([{
      name: "answer",
      value: decision.answer,
    }, {
      name: "askUser",
      value: decision.askUser,
    }, {
      name: "useTools",
      value: decision.useTools,
    }, {
      name: "discoverTools",
      value: decision.discoverTools,
    }] as const).filter((entry) => entry.value !== null && entry.value !== undefined);
    const expectedPayload = ActionPayloadByKind[decision.action];
    if (payloadKeys.length !== 1 || payloadKeys[0]?.name !== expectedPayload) {
      context.addIssue({
        code: "custom",
        path: [expectedPayload],
        message: `Action ${decision.action} 必须且只能提供 ${expectedPayload} payload。`,
      });
    }

    if (decision.action === ActionKind.Answer && !readNonEmptyString(decision.answer?.content)) {
      context.addIssue({
        code: "custom",
        path: ["answer", "content"],
        message: "Answer 需要 answer.content 提供最终回复内容。",
      });
    }

    if (decision.action === ActionKind.AskUser && !readNonEmptyString(decision.askUser?.question)) {
      context.addIssue({
        code: "custom",
        path: ["askUser", "question"],
        message: "AskUser 需要 askUser.question。",
      });
    }

    if (decision.action === ActionKind.UseTools && (decision.useTools?.preferredTools ?? []).length === 0) {
      context.addIssue({
        code: "custom",
        path: ["useTools", "preferredTools"],
        message: "UseTools 需要至少一个 preferredTools。",
      });
    }

    if (decision.action === ActionKind.UseTools && !readNonEmptyString(decision.useTools?.instruction)) {
      context.addIssue({
        code: "custom",
        path: ["useTools", "instruction"],
        message: "UseTools 需要 useTools.instruction。",
      });
    }

    if (decision.action === ActionKind.DiscoverTools && (decision.discoverTools?.queries ?? []).length === 0) {
      context.addIssue({
        code: "custom",
        path: ["discoverTools", "queries"],
        message: "DiscoverTools 需要至少一个 queries。",
      });
    }
  });

export const ActionKindMap = {
  [ActionKind.Answer]: "answer",
  [ActionKind.AskUser]: "ask_user",
  [ActionKind.DiscoverTools]: "discover_tools",
  [ActionKind.UseTools]: "use_tools",
} satisfies Record<ActionKind, AgentActionKind>;

export function parseActionSelection(selection: BamlActionSelection): ActionKind {
  return ActionSelectionSchema.parse(selection).action;
}

export function parseActionDecision(
  decision: BamlActionDecision,
  catalog: {
    list(): AgentToolCatalogItem[];
  },
): AgentActionDecision {
  const parsed = ActionDecisionSchema.parse(decision);
  const knownTools = new Set(catalog.list().map((tool) => tool.name));
  const preferredTools = parsed.useTools?.preferredTools ?? [];
  const unknownTools = preferredTools.filter((tool) => !knownTools.has(tool));
  if (unknownTools.length > 0) {
    throw new AgentActionPlannerValidationError([
      `preferredTools 包含未注册工具：${unknownTools.join(", ")}`,
    ], decision);
  }

  switch (parsed.action) {
    case ActionKind.Answer:
      return {
        action: "answer",
        answer: {
          content: readNonEmptyString(parsed.answer?.content) ?? "",
        },
      };
    case ActionKind.AskUser:
      return {
        action: "ask_user",
        askUser: {
          question: readNonEmptyString(parsed.askUser?.question) ?? "",
          reason: readNonEmptyString(parsed.askUser?.reason) ?? null,
        },
      };
    case ActionKind.DiscoverTools:
      return {
        action: "discover_tools",
        discoverTools: {
          queries: uniqueTrimmed(parsed.discoverTools?.queries ?? []),
          needs: (parsed.discoverTools?.needs ?? []).map(normalizeCapabilityNeed),
        },
      };
    case ActionKind.UseTools:
      return {
        action: "use_tools",
        useTools: {
          preferredTools: uniqueTrimmed(parsed.useTools?.preferredTools ?? []),
          instruction: readNonEmptyString(parsed.useTools?.instruction) ?? "",
        },
      };
  }
}

export function assertSelectedAction(decision: AgentActionDecision, selectedAction: ActionKind): void {
  const expected = ActionKindMap[selectedAction];
  if (decision.action !== expected) {
    throw new AgentActionPlannerValidationError([
      `payload action ${decision.action} 与 selectedAction ${selectedAction} 不一致。`,
    ], decision);
  }
}

export class AgentActionPlannerValidationError extends Error {
  constructor(
    readonly issues: string[],
    readonly invalidDecision: unknown,
  ) {
    super(issues.join("\n"));
    this.name = "AgentActionPlannerValidationError";
  }
}

const ActionPayloadByKind = {
  [ActionKind.Answer]: "answer",
  [ActionKind.AskUser]: "askUser",
  [ActionKind.DiscoverTools]: "discoverTools",
  [ActionKind.UseTools]: "useTools",
} as const satisfies Record<ActionKind, "answer" | "askUser" | "discoverTools" | "useTools">;

function normalizeCapabilityNeed(value: {
  actions?: string[] | null;
  targets?: string[] | null;
  inputs?: string[] | null;
  outputs?: string[] | null;
  evidence?: string[] | null;
  effects?: string[] | null;
}): AgentActionCapabilityNeed {
  return {
    actions: uniqueTrimmed(value.actions ?? []),
    targets: uniqueTrimmed(value.targets ?? []),
    inputs: uniqueTrimmed(value.inputs ?? []),
    outputs: uniqueTrimmed(value.outputs ?? []),
    evidence: uniqueTrimmed(value.evidence ?? []),
    effects: uniqueTrimmed(value.effects ?? []),
  };
}

function uniqueTrimmed(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
