import type { UserProfileData } from "../../api/eventTypes";

export type UserProfile = UserProfileData & {
  syncState?: "synced" | "pending";
};

export const DEFAULT_USER_PROFILE: UserProfile = {
  name: "用户",
  avatarDataUrl: null,
  updatedAt: "",
};

export function normalizeUserProfile(value: unknown): UserProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_USER_PROFILE;
  const profile = value as Partial<UserProfile>;
  const name = typeof profile.name === "string" && profile.name.trim()
    ? profile.name.trim().slice(0, 48)
    : DEFAULT_USER_PROFILE.name;
  return {
    name,
    avatarDataUrl: typeof profile.avatarDataUrl === "string" && profile.avatarDataUrl.trim()
      ? profile.avatarDataUrl
      : null,
    updatedAt: typeof profile.updatedAt === "string" ? profile.updatedAt : "",
    syncState: profile.syncState === "pending" ? "pending" : "synced",
  };
}
