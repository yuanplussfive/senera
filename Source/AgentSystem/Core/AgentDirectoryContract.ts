import { z } from "zod";
import { normalizeAgentPromptPresetPath } from "./AgentPromptPresetContract.js";
import { AgentShortIdPattern } from "../Identity/AgentShortId.js";

export const AgentDirectoryHttpPath = "/api/agents";
const Name = z.string().trim().min(1).max(48);
export const WorkspaceAgentIdSchema = z.string().uuid();
export const WorkspaceAgentSelectorSchema = z.union([WorkspaceAgentIdSchema, z.string().regex(AgentShortIdPattern)]);
const Id = WorkspaceAgentIdSchema;
const NumericIdentity = z.number().int().positive().safe();
const PresetPath = z.string().transform((value, context) => {
  const path = normalizeAgentPromptPresetPath(value);
  if (path) return path;
  context.addIssue({ code: "custom", message: "Select a Markdown document inside prompts/." });
  return z.NEVER;
});

export const WorkspaceAgentInputSchema = z
  .object({
    name: Name,
    avatarPath: z.string().min(1).nullable(),
    enabled: z.boolean(),
    modelProviderId: z.string().trim().min(1).nullable(),
    presetPath: PresetPath.nullable(),
    presetEnabled: z.boolean(),
  })
  .strict()
  .refine((agent) => !agent.presetEnabled || agent.presetPath !== null, "Select a preset before enabling it.");

export const WorkspaceAgentSchema = WorkspaceAgentInputSchema.safeExtend({
  id: Id,
  /** Stable public reference; enriched by the host when loading an older directory. */
  reference: z.string().regex(AgentShortIdPattern).optional(),
  qqUserId: NumericIdentity.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const WorkspaceAgentGroupInputSchema = z
  .object({
    name: Name,
    memberAgentIds: z
      .array(Id)
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate group member."),
  })
  .strict();

export const WorkspaceAgentGroupSchema = WorkspaceAgentGroupInputSchema.extend({
  id: NumericIdentity,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const AgentDirectorySnapshotSchema = z
  .object({
    version: z.literal(3),
    revision: z.number().int().nonnegative(),
    defaultAgentId: Id,
    operatorId: NumericIdentity.nullable(),
    agents: z.array(WorkspaceAgentSchema).min(1),
    groups: z.array(WorkspaceAgentGroupSchema),
    deletingAgentIds: z.array(Id),
  })
  .strict()
  .superRefine((value, context) => {
    const agentIds = new Set(value.agents.map((agent) => agent.id));
    const numericIds = value.agents.flatMap((agent) => (agent.qqUserId === null ? [] : [agent.qqUserId]));
    if (value.operatorId !== null) numericIds.push(value.operatorId);
    numericIds.push(...value.groups.map((group) => group.id));
    if (agentIds.size !== value.agents.length || new Set(numericIds).size !== numericIds.length) {
      context.addIssue({ code: "custom", message: "Agent and channel identities must be unique." });
    }
    if (!value.agents.some((agent) => agent.id === value.defaultAgentId && agent.enabled)) {
      context.addIssue({ code: "custom", message: "The default Agent must exist and be enabled." });
    }
    for (const group of value.groups) {
      if (group.memberAgentIds.some((id) => !agentIds.has(id))) {
        context.addIssue({ code: "custom", message: "Every group member must reference an existing Agent." });
      }
    }
    if (
      new Set(value.deletingAgentIds).size !== value.deletingAgentIds.length ||
      value.deletingAgentIds.some(
        (id) => !value.agents.some((agent) => agent.id === id && !agent.enabled) || id === value.defaultAgentId,
      )
    ) {
      context.addIssue({ code: "custom", message: "Deleting Agents must be unique, disabled and non-default." });
    }
  });

export const AgentDirectoryCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("agent.create"),
      revision: z.number().int().nonnegative(),
      agent: WorkspaceAgentInputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("agent.update"),
      revision: z.number().int().nonnegative(),
      id: Id,
      agent: WorkspaceAgentInputSchema,
    })
    .strict(),
  z.object({ type: z.literal("agent.default"), revision: z.number().int().nonnegative(), id: Id }).strict(),
  z.object({ type: z.literal("agent.delete"), revision: z.number().int().nonnegative(), id: Id }).strict(),
  z
    .object({
      type: z.literal("group.create"),
      revision: z.number().int().nonnegative(),
      group: WorkspaceAgentGroupInputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("group.update"),
      revision: z.number().int().nonnegative(),
      id: NumericIdentity,
      group: WorkspaceAgentGroupInputSchema,
    })
    .strict(),
]);

export type WorkspaceAgent = z.output<typeof WorkspaceAgentSchema>;
export type WorkspaceAgentInput = z.output<typeof WorkspaceAgentInputSchema>;
export function workspaceAgentInput(agent: WorkspaceAgent): WorkspaceAgentInput {
  const { name, avatarPath, enabled, modelProviderId, presetPath, presetEnabled } = agent;
  return { name, avatarPath, enabled, modelProviderId, presetPath, presetEnabled };
}
export type WorkspaceAgentGroup = z.output<typeof WorkspaceAgentGroupSchema>;
export type AgentDirectorySnapshot = z.output<typeof AgentDirectorySnapshotSchema>;
export type AgentDirectoryCommand = z.input<typeof AgentDirectoryCommandSchema>;

export interface AgentDirectoryRepository {
  loadAgentDirectory(): unknown;
  saveAgentDirectory(snapshot: AgentDirectorySnapshot): void;
}
