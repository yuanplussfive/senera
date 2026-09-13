import { z } from "zod";

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

const PresetCommandSchema = z.discriminatedUnion("action", [
  z.object({ command: z.literal("preset"), action: z.literal("list") }).strict(),
  z.object({ command: z.literal("preset"), action: z.literal("show"), name: z.string().min(1).max(128) }).strict(),
  z.object({ command: z.literal("preset"), action: z.literal("use"), name: z.string().max(128).nullable() }).strict(),
  z
    .object({
      command: z.literal("preset"),
      action: z.literal("create"),
      name: z.string().min(1).max(128),
      content: z.unknown(),
    })
    .strict(),
]);

const LogsCommandSchema = z.discriminatedUnion("action", [
  z.object({ command: z.literal("logs"), action: z.literal("list") }).strict(),
  z
    .object({
      command: z.literal("logs"),
      action: z.literal("tail"),
      name: z.string().min(1).max(128),
      lines: z.number().int().positive().max(2000).optional(),
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
      limit: z.number().int().positive().max(12).optional(),
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
  PresetCommandSchema,
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
