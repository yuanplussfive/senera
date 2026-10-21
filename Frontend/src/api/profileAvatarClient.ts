import { SeneraResourceHttpRoutes } from "./resourceContract";
import { buildHttpApiUrl } from "./httpApiUrl";

export type ProfileAvatarIdentity = "user" | "assistant";

export function buildProfileAvatarUrl(httpBaseUrl: string, identity: ProfileAvatarIdentity): string {
  const url = new URL(buildHttpApiUrl(httpBaseUrl, SeneraResourceHttpRoutes.ProfileAvatar));
  url.searchParams.set("identity", identity);
  return url.toString();
}

export async function saveProfileAvatar(
  httpBaseUrl: string,
  identity: ProfileAvatarIdentity,
  file: File,
  csrfToken?: string,
): Promise<string> {
  const response = await fetch(buildProfileAvatarUrl(httpBaseUrl, identity), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      ...(csrfToken ? { "X-Senera-Csrf": csrfToken } : {}),
    },
    body: file,
  });
  const payload = await readJson(response);
  if (!response.ok || !isProfileAvatarResponse(payload)) {
    const message =
      isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
        ? payload.error.message
        : "Profile avatar upload failed.";
    throw new Error(message);
  }
  return payload.avatarPath;
}

function isProfileAvatarResponse(value: unknown): value is { ok: true; avatarPath: string } {
  return isRecord(value) && value.ok === true && typeof value.avatarPath === "string" && value.avatarPath.length > 0;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
