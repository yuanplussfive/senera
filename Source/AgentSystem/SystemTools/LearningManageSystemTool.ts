import { z } from "zod";
import { resolveToolSearchConfig } from "../AgentDefaults.js";
import { AgentLearningDomains, AgentLearningStates } from "../ToolSearch/AgentLearningEpisodeTypes.js";
import { AgentToolSearchMemory } from "../ToolSearch/AgentToolSearchMemory.js";
import { createAgentToolSearchProjectId } from "../ToolSearch/AgentToolSearchProject.js";
import { defineSystemTool } from "./AgentSystemToolDefinition.js";
import { StandardAgentToolObservationProjection } from "../ToolRuntime/AgentToolObservationProjectionPlan.js";

const LearningManageActions = {
  Status: "status",
  List: "list",
  Inspect: "inspect",
  SkillTerms: "skill_terms",
} as const;

const LearningManageInput = z
  .object({
    action: z.enum(LearningManageActions),
    episodeId: z.string().trim().min(1).optional().describe("Learning episode id required by inspect."),
    skillName: z.string().trim().min(1).optional().describe("Optional Skill name filter for skill_terms."),
    limit: z.int().positive().optional().describe("Number of records required by list and skill_terms."),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.action === LearningManageActions.Inspect && !input.episodeId) {
      context.addIssue({ code: "custom", path: ["episodeId"], message: "Required by inspect." });
    }
    if (
      (input.action === LearningManageActions.List || input.action === LearningManageActions.SkillTerms) &&
      !input.limit
    ) {
      context.addIssue({ code: "custom", path: ["limit"], message: `Required by ${input.action}.` });
    }
  });

const LearningSubject = z
  .object({
    kind: z.enum(["tool", "skill"]),
    name: z.string(),
    revision: z.string().optional(),
  })
  .strict();

const LearningEpisode = z
  .object({
    id: z.string(),
    domain: z.enum(AgentLearningDomains),
    state: z.enum(AgentLearningStates),
    reason: z.string(),
    error: z.string(),
    attempts: z.number(),
    projectId: z.string(),
    sessionId: z.string(),
    requestId: z.string(),
    query: z.string(),
    subjects: z.array(LearningSubject),
    context: z
      .object({
        rawUserTurn: z.string(),
        standaloneRequest: z.string(),
        contextMode: z.string(),
        contextBasis: z.string(),
        candidates: z.array(z.string()),
        chosenTools: z.array(z.string()),
        activeSkills: z.array(
          z
            .object({
              name: z.string(),
              revision: z.string(),
              matchedTerms: z.array(z.string()),
            })
            .strict(),
        ),
      })
      .strict(),
    outcome: z
      .object({
        outcome: z.enum(["success", "failure", "unknown"]),
        score: z.number(),
        calls: z.array(z.object({}).passthrough()),
        final: z.object({}).passthrough(),
      })
      .strict(),
    createdAtMs: z.number(),
    updatedAtMs: z.number(),
  })
  .strict();

const SkillLearningTerm = z
  .object({
    projectId: z.string(),
    skillName: z.string(),
    skillRevision: z.string(),
    term: z.string(),
    source: z.string(),
    support: z.number(),
    weight: z.number(),
    lastSeenAt: z.number(),
  })
  .strict();

const LearningManageOutput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal(LearningManageActions.Status),
      projectId: z.string(),
      episodeCount: z.number(),
      episodeGroups: z.array(
        z
          .object({
            domain: z.enum(AgentLearningDomains),
            state: z.enum(AgentLearningStates),
            count: z.number(),
          })
          .strict(),
      ),
      skillTermCount: z.number(),
    })
    .strict(),
  z.object({ action: z.literal(LearningManageActions.List), episodes: z.array(LearningEpisode) }).strict(),
  z
    .object({
      action: z.literal(LearningManageActions.Inspect),
      found: z.boolean(),
      episode: LearningEpisode.optional(),
    })
    .strict(),
  z.object({ action: z.literal(LearningManageActions.SkillTerms), terms: z.array(SkillLearningTerm) }).strict(),
]);

export const LearningManageSystemTool = defineSystemTool({
  extension: {
    name: "agent-learning-manager",
    displayName: {
      "zh-CN": "学习诊断",
      "en-US": "Learning Diagnostics",
    },
    description: {
      "zh-CN": "检查工具与技能路由学习的可观测状态。",
      "en-US": "Inspects observable Tool and Skill routing-learning state.",
    },
    priority: 2,
  },
  metadata: {
    observation: StandardAgentToolObservationProjection,
    description: "Inspect learning status, recent episodes, one failure or skip, and revision-bound Skill terms.",
    permissions: ["filesystem:read:.senera/data/tool-search"],
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    search: {
      Summary: "查看 Tool/Skill 路由学习状态、跳过原因、失败详情和 Skill 触发词。",
      Tags: ["学习诊断", "Skill 学习", "Tool 学习", "可观测性"],
      Capabilities: [
        {
          Id: "learning.inspect",
          Title: "Learning diagnostics",
          Description: "Inspect routing-learning observations and learned Skill terms without modifying them.",
          Facets: {
            Actions: ["status", "list", "inspect"],
            Targets: ["learning-episode", "skill-routing-term", "tool-routing"],
            Inputs: ["episode-id", "skill-name", "limit"],
            Outputs: ["learning-status", "skip-reason", "failure-detail", "skill-term"],
            Effects: ["none"],
          },
          Aliases: ["为什么没有学到", "查看学习记录", "检查 Skill 触发词"],
          Risk: { SideEffect: "none", Permission: "read" },
        },
      ],
      UseCases: ["诊断学习数据库为空、模型学习失败、Skill 未被再次激活或某条经验被跳过。"],
      Examples: ["查看最近 20 条学习记录", "检查 csv-column-selector 学到的触发词"],
      Avoid: ["不要用于创建、发布或删除 Skill。"],
    },
  },
  name: "LearningManage",
  input: LearningManageInput,
  output: LearningManageOutput,
  execute(input, context) {
    const projectId = createAgentToolSearchProjectId(context.workspaceRoot);
    const memory = new AgentToolSearchMemory(resolveToolSearchConfig(context.config), context.workspaceRoot);
    try {
      switch (input.action) {
        case LearningManageActions.Status:
          return { action: input.action, projectId, ...memory.learningSummary(projectId) };
        case LearningManageActions.List:
          return {
            action: input.action,
            episodes: memory.learningEpisodes(projectId, input.limit!).map((episode) => LearningEpisode.parse(episode)),
          };
        case LearningManageActions.Inspect: {
          const episode = memory.learningEpisode(projectId, input.episodeId!);
          return {
            action: input.action,
            found: Boolean(episode),
            ...(episode ? { episode: LearningEpisode.parse(episode) } : {}),
          };
        }
        case LearningManageActions.SkillTerms:
          return {
            action: input.action,
            terms: memory.skillLearningTerms(projectId, input.skillName).slice(0, input.limit!),
          };
      }
    } finally {
      memory.close();
    }
  },
});
