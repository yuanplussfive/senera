import { z } from "zod";
import { AgentLogPolicyLimits } from "../Types/AgentLogPolicyLimits.js";
import { AgentSelfSkillSearchLimits } from "./AgentSelfSkills.js";

/**
 * Single source of truth for the `senera` self-service command vocabulary.
 * Consumed by the model-facing `SeneraCommand` host tool and by the
 * `POST /senera/self` HTTP endpoint the standalone CLI calls, so both entry
 * points accept exactly the same command shapes.
 */
const ConfigCommandSchema = z.discriminatedUnion("action", [
  z.object({ command: z.literal("config"), action: z.literal("get"), path: z.string().max(256).optional() }).strict(),
  z.object({ command: z.literal("config"), action: z.literal("models") }).strict(),
  z.object({ command: z.literal("config"), action: z.literal("endpoints") }).strict(),
  z.object({ command: z.literal("config"), action: z.literal("history") }).strict(),
  z.object({ command: z.literal("config"), action: z.literal("env-path") }).strict(),
  z.object({ command: z.literal("config"), action: z.literal("check") }).strict(),
  z
    .object({
      command: z.literal("config"),
      action: z.literal("rollback"),
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      command: z.literal("config"),
      action: z.literal("update"),
      path: z.string().min(1).max(256),
      value: z.unknown(),
    })
    .strict(),
]);

const LogFilterShape = {
  kind: z.string().trim().min(1).max(256).optional(),
  level: z.string().trim().min(1).max(64).optional(),
  scope: z.string().trim().min(1).max(128).optional(),
  stream: z.string().trim().min(1).max(128).optional(),
} as const;
const LogLimitSchema = z.number().int().positive().max(AgentLogPolicyLimits.maximumQueryPageSize).optional();
const LogTimestampSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .describe("带时区的 RFC3339 时间，例如 2026-10-16T20:00:00+08:00");

const LogsCommandSchema = z.discriminatedUnion("action", [
  z.object({ command: z.literal("logs"), action: z.literal("list") }).strict(),
  z
    .object({
      command: z.literal("logs"),
      action: z.literal("latest"),
      ...LogFilterShape,
      limit: LogLimitSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("logs"),
      action: z.literal("range"),
      from: LogTimestampSchema,
      to: LogTimestampSchema,
      ...LogFilterShape,
      limit: LogLimitSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("logs"),
      action: z.literal("session"),
      sessionId: z.string().trim().min(1).max(256),
      limit: LogLimitSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("logs"),
      action: z.literal("next"),
      cursor: z.string().trim().min(1).max(AgentLogPolicyLimits.maximumQueryCursorLength),
      limit: LogLimitSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("logs"),
      action: z.literal("detail"),
      detailId: z.string().trim().min(1).max(256),
    })
    .strict(),
  z
    .object({
      command: z.literal("logs"),
      action: z.literal("trace"),
      requestId: z.string().trim().min(1).max(256),
      limit: z.number().int().positive().max(AgentLogPolicyLimits.maximumQueryPageSize).optional(),
    })
    .strict(),
  z.object({ command: z.literal("logs"), action: z.literal("health") }).strict(),
  z.object({ command: z.literal("logs"), action: z.literal("streams") }).strict(),
  z
    .object({
      command: z.literal("logs"),
      action: z.literal("tail"),
      name: z.string().min(1).max(128),
      lines: z.number().int().positive().max(AgentLogPolicyLimits.maximumTailLineCount).optional(),
    })
    .strict(),
]);

const SessionCommandSchema = z.discriminatedUnion("operation", [
  z
    .object({
      command: z.literal("session"),
      action: z.literal("model"),
      operation: z.literal("get"),
      sessionId: z.string().trim().min(1).max(256).optional(),
    })
    .strict(),
  z
    .object({
      command: z.literal("session"),
      action: z.literal("model"),
      operation: z.literal("set"),
      modelProviderId: z.string().trim().min(1).max(256),
      sessionId: z.string().trim().min(1).max(256).optional(),
    })
    .strict(),
]);

const SkillsCommandSchema = z.discriminatedUnion("action", [
  z.object({ command: z.literal("skills"), action: z.literal("list") }).strict(),
  z
    .object({
      command: z.literal("skills"),
      action: z.literal("search"),
      query: z.string().trim().min(1).max(2048),
      limit: z.number().int().positive().max(AgentSelfSkillSearchLimits.maximum).optional(),
    })
    .strict(),
  z
    .object({
      command: z.literal("skills"),
      action: z.literal("inspect"),
      name: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      command: z.literal("skills"),
      action: z.literal("resources"),
      name: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      command: z.literal("skills"),
      action: z.literal("read"),
      name: z.string().trim().min(1).max(128),
      path: z.string().trim().min(1).max(512),
      revision: z.string().trim().min(16).max(128).optional(),
    })
    .strict(),
  z
    .object({
      command: z.literal("skills"),
      action: z.literal("diff"),
      name: z.string().trim().min(1).max(128),
      revision: z.string().trim().min(16).max(128),
    })
    .strict(),
  z
    .object({
      command: z.literal("skills"),
      action: z.literal("check"),
      name: z.string().trim().min(1).max(128).optional(),
    })
    .strict(),
  z
    .object({
      command: z.literal("skills"),
      action: z.literal("history"),
      name: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      command: z.literal("skills"),
      action: z.literal("create"),
      name: z.string().trim().min(1).max(128),
      content: z
        .string()
        .min(1)
        .max(1_024 * 1_024),
    })
    .strict(),
  z
    .object({
      command: z.literal("skills"),
      action: z.literal("update"),
      name: z.string().trim().min(1).max(128),
      content: z
        .string()
        .min(1)
        .max(1_024 * 1_024),
      expectedRevision: z.string().trim().min(16).max(128),
    })
    .strict(),
  z
    .object({
      command: z.literal("skills"),
      action: z.literal("archive"),
      name: z.string().trim().min(1).max(128),
      expectedRevision: z.string().trim().min(16).max(128),
    })
    .strict(),
  z
    .object({
      command: z.literal("skills"),
      action: z.literal("restore"),
      name: z.string().trim().min(1).max(128),
      revision: z.string().trim().min(16).max(128),
    })
    .strict(),
]);

export const AgentSelfCommandSchema = z.discriminatedUnion("command", [
  ConfigCommandSchema,
  LogsCommandSchema,
  SessionCommandSchema,
  SkillsCommandSchema,
  z.object({ command: z.literal("workspace"), action: z.literal("info") }).strict(),
  z.object({ command: z.literal("sessions"), action: z.literal("list") }).strict(),
  z.object({ command: z.literal("plugins"), action: z.literal("list") }).strict(),
  z.object({ command: z.literal("capabilities") }).strict(),
  z.object({ command: z.literal("status") }).strict(),
  z.object({ command: z.literal("doctor"), action: z.literal("status") }).strict(),
  z
    .object({
      command: z.literal("approval"),
      action: z.literal("resolve"),
      approvalId: z.string().min(1).max(128),
      decision: z.enum(["approve", "deny"]),
    })
    .strict(),
]);

export type AgentSelfCommandSchemaInput = z.input<typeof AgentSelfCommandSchema>;

/** Plugin commands are declared by the live plugin registry, so they cannot
 * be baked into the shipped union. The envelope is intentionally structural;
 * dispatch still requires an exact registered command before execution. */
export const AgentSelfPluginCommandEnvelopeSchema = z
  .object({
    command: z.string().trim().min(1).max(64),
    action: z.string().trim().min(1).max(64).optional(),
    args: z.array(z.string()).max(128).optional(),
  })
  .strict();

export const AgentSelfInvocationSchema = z.union([AgentSelfCommandSchema, AgentSelfPluginCommandEnvelopeSchema]);

export type AgentSelfInvocationSchemaInput = z.input<typeof AgentSelfInvocationSchema>;
