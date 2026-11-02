import { z } from "zod";

export const AgentUserProfileLimits = {
  NameMaxLength: 48,
  AvatarDataUrlMaxLength: 512 * 1024,
} as const;

const AvatarDataUrlSchema = z
  .string()
  .max(AgentUserProfileLimits.AvatarDataUrlMaxLength)
  .regex(/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i);
const AvatarPathSchema = z.string().trim().min(1).max(512);

export const AgentProfileIdentityInputSchema = z
  .object({
    name: z.string().trim().min(1).max(AgentUserProfileLimits.NameMaxLength),
    avatarDataUrl: AvatarDataUrlSchema.nullable().optional(),
    avatarPath: AvatarPathSchema.nullable().optional(),
  })
  .strict();
export const AgentProfileIdentitySchema = z
  .object({
    name: z.string().trim().min(1).max(AgentUserProfileLimits.NameMaxLength),
    avatarDataUrl: AvatarDataUrlSchema.nullable(),
    avatarPath: AvatarPathSchema.nullable(),
  })
  .strict();
export const AgentUserProfileInputSchema = AgentProfileIdentityInputSchema.extend({
  assistant: AgentProfileIdentityInputSchema.optional(),
}).strict();
/** Public profile writes concern the human only; AgentDirectory owns Bot identity. */
export const AgentUserProfileUpdateSchema = AgentProfileIdentityInputSchema;
export type AgentUserProfileUpdate = z.output<typeof AgentUserProfileUpdateSchema>;
export const AgentUserProfileSchema = AgentProfileIdentitySchema.extend({
  assistant: AgentProfileIdentitySchema,
  updatedAt: z.string().min(1),
}).strict();

export type AgentUserProfileInput = z.output<typeof AgentUserProfileInputSchema>;
export type AgentUserProfile = z.output<typeof AgentUserProfileSchema>;
export type AgentProfileIdentity = z.output<typeof AgentProfileIdentitySchema>;
