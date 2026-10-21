import type { ConversationIdentity, UserProfile } from "../../store/sessionStore";
import { DEFAULT_ASSISTANT_PROFILE } from "../../store/session/userProfile";
import { cn, formatTime } from "../../lib/util";
import { AppIcon, LogoMark } from "../../shared/ui";
import { ModelProviderIcon } from "./ModelProviderIcon";
import { useProfileAvatar } from "../session/ProfileAvatar";

export interface MessageMetaProps {
  title?: string;
  timestamp: string;
}

/**
 * Message timestamp. The reveal behaviour belongs to the caller: the assistant
 * header fades it in on hover, while the user footer already owns visibility.
 */
export function MessageTime({ timestamp, className }: { timestamp: string; className?: string }): JSX.Element {
  return (
    <span className={cn("shrink-0 text-[10.5px] tabular-nums text-content-muted", className)}>
      {formatTime(timestamp)}
    </span>
  );
}

export function MessageMeta({ title, timestamp }: MessageMetaProps): JSX.Element {
  return (
    <div className="flex min-w-0 items-baseline gap-2" data-ui-chrome>
      {title ? (
        <span className="min-w-0 truncate text-[13.5px] font-semibold text-content-primary">{title}</span>
      ) : null}
      <MessageTime
        timestamp={timestamp}
        className="opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100"
      />
    </div>
  );
}

export function AssistantMessageAvatar({
  profile = DEFAULT_ASSISTANT_PROFILE,
}: {
  profile?: ConversationIdentity;
}): JSX.Element {
  const { source: avatarSource, onError } = useProfileAvatar(profile);
  return (
    <span
      className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full"
      aria-label={profile.name}
      data-message-avatar="assistant"
    >
      {avatarSource ? (
        <img src={avatarSource} alt={profile.name} className="h-full w-full object-cover" onError={onError} />
      ) : (
        <LogoMark size={30} />
      )}
    </span>
  );
}

export interface MessageAvatarProps {
  role: "user" | "assistant";
  icon?: string;
  profile?: UserProfile;
}

export function MessageAvatar({ role, icon, profile }: MessageAvatarProps): JSX.Element {
  const avatar = useProfileAvatar(profile ?? { name: "", avatarDataUrl: null });
  if (role === "user") {
    const fallback = readUserInitial(profile?.name);
    return (
      <div
        className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-muted text-[12px] font-semibold text-content-secondary"
        data-message-avatar="user"
      >
        {avatar.source ? (
          <img
            src={avatar.source}
            alt={profile?.name ?? ""}
            className="h-full w-full object-cover"
            onError={avatar.onError}
          />
        ) : fallback ? (
          fallback
        ) : (
          <AppIcon icon="user" className="h-4 w-4" />
        )}
      </div>
    );
  }

  return icon ? (
    <span className="grid h-6 w-6 shrink-0 place-items-center text-content-secondary">
      <ModelProviderIcon icon={icon} size={15} />
    </span>
  ) : (
    <span className="h-6 w-6 shrink-0" aria-hidden="true" />
  );
}

export function readUserInitial(name?: string): string {
  return name?.trim().slice(0, 1).toUpperCase() ?? "";
}
