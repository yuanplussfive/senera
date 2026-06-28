import { z } from "zod";
import { createRequestId } from "../AgentIds.js";
import { AgentUserProfileInputSchema } from "../AgentUserProfile.js";
import { AgentUploadAttachmentListSchema } from "../Uploads/AgentUploadTypes.js";
import { AgentSystemConfigSchema } from "../Schemas/AgentSystemConfigSchema.js";

const AgentPresetFormatSchema = z.enum(["json", "markdown", "text"]);

const AgentProviderModelEndpointRequestSchema = z
  .object({
    Id: z.string().min(1),
    Icon: z.string().optional(),
    Enabled: z.boolean().optional(),
    Kind: z.literal("OpenAICompatible").optional(),
    BaseUrl: z.string().optional(),
    ApiKey: z.string().optional(),
    ApiVersion: z.string().optional(),
    Headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const AgentWebSocketRequestSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("session.create"),
      sessionId: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.message"),
      sessionId: z.string().min(1),
      requestId: z.string().min(1).optional(),
      modelProviderId: z.string().min(1).optional(),
      input: z.string().min(1),
      attachments: AgentUploadAttachmentListSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.close"),
      sessionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.cancel"),
      sessionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.truncate_from"),
      sessionId: z.string().min(1),
      requestId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.list"),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.history"),
      sessionId: z.string().min(1),
      refresh: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.rename"),
      sessionId: z.string().min(1),
      title: z.string().min(1).max(120),
    })
    .strict(),
  z
    .object({
      type: z.literal("model.list"),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.models.fetch"),
      providerId: z.string().min(1),
      force: z.boolean().optional(),
      endpoint: AgentProviderModelEndpointRequestSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("config.get"),
    })
    .strict(),
  z
    .object({
      type: z.literal("config.update"),
      requestId: z.string().min(1).optional(),
      config: AgentSystemConfigSchema,
      mirrorJson: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("plugin.config.list"),
    })
    .strict(),
  z
    .object({
      type: z.literal("plugin.config.update"),
      requestId: z.string().min(1).optional(),
      pluginName: z.string().min(1),
      toml: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("plugin.config.set_enabled"),
      requestId: z.string().min(1).optional(),
      pluginName: z.string().min(1),
      toolName: z.string().min(1).optional(),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("preset.list"),
    })
    .strict(),
  z
    .object({
      type: z.literal("preset.save"),
      requestId: z.string().min(1).optional(),
      name: z.string().min(1),
      format: AgentPresetFormatSchema,
      content: z.string(),
      activate: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("preset.delete"),
      requestId: z.string().min(1).optional(),
      name: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("preset.set_active"),
      requestId: z.string().min(1).optional(),
      name: z.string().min(1).nullable().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("profile.get"),
    })
    .strict(),
  z
    .object({
      type: z.literal("profile.update"),
      profile: AgentUserProfileInputSchema,
    })
    .strict(),
]);

export type AgentWebSocketRequest = z.infer<typeof AgentWebSocketRequestSchema>;
export type AgentWebSocketRequestOf<TType extends AgentWebSocketRequest["type"]> =
  Extract<AgentWebSocketRequest, { type: TType }>;

export { createRequestId };
