import { z } from "zod";
import type { AgentDomainEvent, AgentEventSink } from "./AgentEvent.js";
import { AgentEventKinds, emitAgentEvent } from "./AgentEvent.js";

export const AgentUserProfileLimits = {
  NameMaxLength: 48,
  AvatarDataUrlMaxLength: 512 * 1024,
} as const;

const AvatarDataUrlSchema = z
  .string()
  .max(AgentUserProfileLimits.AvatarDataUrlMaxLength)
  .regex(/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i);

export const AgentUserProfileInputSchema = z
  .object({
    name: z.string().trim().min(1).max(AgentUserProfileLimits.NameMaxLength),
    avatarDataUrl: AvatarDataUrlSchema.nullable().optional(),
  })
  .strict();

export const AgentUserProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(AgentUserProfileLimits.NameMaxLength),
    avatarDataUrl: AvatarDataUrlSchema.nullable(),
    updatedAt: z.string().min(1),
  })
  .strict();

export type AgentUserProfileInput = z.output<typeof AgentUserProfileInputSchema>;
export type AgentUserProfile = z.output<typeof AgentUserProfileSchema>;

export interface AgentUserProfileRepository {
  loadUserProfile(): AgentUserProfile;
  saveUserProfile(profile: AgentUserProfileInput): AgentUserProfile;
}

export function createDefaultAgentUserProfile(updatedAt = new Date().toISOString()): AgentUserProfile {
  return {
    name: "用户",
    avatarDataUrl: null,
    updatedAt,
  };
}

export function createAgentUserProfile(
  input: AgentUserProfileInput,
  updatedAt = new Date().toISOString(),
): AgentUserProfile {
  const parsed = AgentUserProfileInputSchema.parse(input);
  return {
    name: parsed.name,
    avatarDataUrl: parsed.avatarDataUrl ?? null,
    updatedAt,
  };
}

export function parseStoredAgentUserProfile(value: unknown, updatedAt?: string): AgentUserProfile {
  const snapshot = AgentUserProfileSchema.safeParse(value);
  if (snapshot.success) return snapshot.data;

  const input = AgentUserProfileInputSchema.safeParse(value);
  if (input.success) {
    return createAgentUserProfile(input.data, updatedAt);
  }

  return createDefaultAgentUserProfile(updatedAt);
}

export class AgentUserProfileManager {
  constructor(private readonly repository: AgentUserProfileRepository) {}

  async emitSnapshot(request: { onEvent?: AgentEventSink }): Promise<void> {
    await emitAgentEvent(request.onEvent, this.snapshotEvent(this.repository.loadUserProfile()));
  }

  async updateProfile(request: {
    profile: AgentUserProfileInput;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    const profile = this.repository.saveUserProfile(request.profile);
    await emitAgentEvent(request.onEvent, this.snapshotEvent(profile));
  }

  private snapshotEvent(profile: AgentUserProfile): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ProfileSnapshot,
      context: {},
      data: profile,
    };
  }
}
