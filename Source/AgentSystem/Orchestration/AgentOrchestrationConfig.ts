import { z } from "zod";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";

const ThinkingLevelConfigurationSchema = z.enum(["inherit", "off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const NonEmptyConfigurationStringSchema = z.string().trim().min(1);
const OptionalPositiveQuotaSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional();
const OptionalNonNegativeQuotaSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable()
  .optional();

const AgentChildRunDeadlineConfigurationSchema = z
  .object({
    softTimeoutMs: z.number().int().min(60_000).max(86_400_000).default(1_500_000),
    wrapUpTimeoutMs: z.number().int().min(10_000).max(1_800_000).default(180_000),
    snapshotIntervalMs: z.number().int().min(500).max(60_000).default(5_000),
    activityExtension: z
      .object({
        recentActivityWindowMs: z.number().int().min(1_000).max(300_000).default(30_000),
        stepMs: z.number().int().min(1_000).max(300_000).default(60_000),
        maximumMs: z.number().int().min(0).max(1_800_000).default(120_000),
      })
      .strict()
      .default({ recentActivityWindowMs: 30_000, stepMs: 60_000, maximumMs: 120_000 }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.activityExtension.maximumMs > 0 && value.activityExtension.stepMs > value.activityExtension.maximumMs) {
      context.addIssue({
        code: "custom",
        path: ["activityExtension", "stepMs"],
        message: "Activity extension step cannot exceed the maximum extension.",
      });
    }
  })
  .default({
    softTimeoutMs: 1_500_000,
    wrapUpTimeoutMs: 180_000,
    snapshotIntervalMs: 5_000,
    activityExtension: { recentActivityWindowMs: 30_000, stepMs: 60_000, maximumMs: 120_000 },
  });

const AgentDelegationModelPoolConfigurationSchema = z
  .object({
    inheritParent: z.boolean().default(true),
    modelProviderIds: z.array(NonEmptyConfigurationStringSchema).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const duplicateModelProviderIds = value.modelProviderIds.filter(
      (modelProviderId, index, modelProviderIds) => modelProviderIds.indexOf(modelProviderId) !== index,
    );
    if (duplicateModelProviderIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["modelProviderIds"],
        message: `Delegation model pool entries must be unique: ${[...new Set(duplicateModelProviderIds)].join(", ")}.`,
      });
    }
    if (!value.inheritParent && value.modelProviderIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["modelProviderIds"],
        message: "Delegation model pool must inherit the parent model or contain at least one configured model.",
      });
    }
  })
  .default({ inheritParent: true, modelProviderIds: [] });

const AgentDelegationCoordinationConfigurationSchema = z
  .object({
    defaultWaitTimeoutMs: z.number().int().min(0).max(3_600_000).default(30_000),
    maximumWaitTimeoutMs: z.number().int().min(1_000).max(86_400_000).default(3_600_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.defaultWaitTimeoutMs > value.maximumWaitTimeoutMs) {
      context.addIssue({
        code: "custom",
        path: ["defaultWaitTimeoutMs"],
        message: "The default child-run wait timeout cannot exceed the configured maximum.",
      });
    }
  })
  .default({ defaultWaitTimeoutMs: 30_000, maximumWaitTimeoutMs: 3_600_000 });

export const AgentDelegationConfigurationSchema = z
  .object({
    modelPool: AgentDelegationModelPoolConfigurationSchema,
    coordination: AgentDelegationCoordinationConfigurationSchema,
    defaults: z
      .object({
        skills: z.array(NonEmptyConfigurationStringSchema).default([]),
        thinkingLevel: ThinkingLevelConfigurationSchema.default("inherit"),
      })
      .strict()
      .default({ skills: [], thinkingLevel: "inherit" }),
    concurrency: z
      .object({
        maxRuns: OptionalPositiveQuotaSchema,
        maxWorkspaceWriters: OptionalPositiveQuotaSchema,
      })
      .strict()
      .default({}),
    workflows: z
      .object({
        maxNodes: OptionalPositiveQuotaSchema,
      })
      .strict()
      .default({}),
    execution: z
      .object({
        deadline: AgentChildRunDeadlineConfigurationSchema,
        maxDepth: OptionalNonNegativeQuotaSchema,
      })
      .strict()
      .default({
        deadline: {
          softTimeoutMs: 1_500_000,
          wrapUpTimeoutMs: 180_000,
          snapshotIntervalMs: 5_000,
          activityExtension: { recentActivityWindowMs: 30_000, stepMs: 60_000, maximumMs: 120_000 },
        },
      }),
  })
  .strict()
  .superRefine((value, context) => {
    const duplicateSkills = value.defaults.skills.filter((skill, index, skills) => skills.indexOf(skill) !== index);
    if (duplicateSkills.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["defaults", "skills"],
        message: `Delegation default skills must be unique: ${[...new Set(duplicateSkills)].join(", ")}.`,
      });
    }
    if (
      value.concurrency.maxWorkspaceWriters != null &&
      value.concurrency.maxRuns != null &&
      value.concurrency.maxWorkspaceWriters > value.concurrency.maxRuns
    ) {
      context.addIssue({
        code: "custom",
        path: ["concurrency", "maxWorkspaceWriters"],
        message: "maxWorkspaceWriters cannot exceed maxRuns.",
      });
    }
  });

export const AgentSchedulerConfigurationSchema = z
  .object({
    polling: z
      .object({
        intervalMs: z.number().int().min(250).max(60_000).default(1_000),
        claimDurationMs: z.number().int().min(5_000).max(3_600_000).default(300_000),
        claimBatchSize: z.number().int().min(1).max(128).default(16),
      })
      .strict()
      .default({ intervalMs: 1_000, claimDurationMs: 300_000, claimBatchSize: 16 }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.polling.claimDurationMs <= value.polling.intervalMs) {
      context.addIssue({
        code: "custom",
        path: ["polling", "claimDurationMs"],
        message: "Scheduled-task claim duration must exceed the polling interval.",
      });
    }
  });

export type AgentDelegationConfiguration = z.infer<typeof AgentDelegationConfigurationSchema>;
export type AgentSchedulerConfiguration = z.infer<typeof AgentSchedulerConfigurationSchema>;

export function resolveAgentDelegationConfiguration(config: AgentSystemConfig): AgentDelegationConfiguration {
  return AgentDelegationConfigurationSchema.parse(config.Extensions?.["agent-delegation"]?.Configuration ?? {});
}

export function resolveAgentChildRunWaitTimeoutMs(config: AgentSystemConfig, requested?: number): number {
  const coordination = resolveAgentDelegationConfiguration(config).coordination;
  const timeoutMs = requested ?? coordination.defaultWaitTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
    throw new Error("Child-run wait timeout must be a non-negative safe integer.");
  }
  if (timeoutMs > coordination.maximumWaitTimeoutMs) {
    throw new Error(
      `Child-run wait timeout ${timeoutMs}ms exceeds the configured maximum of ${coordination.maximumWaitTimeoutMs}ms.`,
    );
  }
  return timeoutMs;
}

export function resolveAgentSchedulerConfiguration(config: AgentSystemConfig): AgentSchedulerConfiguration {
  return AgentSchedulerConfigurationSchema.parse(config.Extensions?.["agent-scheduler"]?.Configuration ?? {});
}

export const AgentOrchestrationConfigurationContracts = Object.freeze([
  { extensionId: "agent-delegation", schema: AgentDelegationConfigurationSchema },
  { extensionId: "agent-scheduler", schema: AgentSchedulerConfigurationSchema },
] as const);
