import { User } from "lucide-react";
import type { UserProfile } from "../../store/sessionStore";
import { cn, formatTime } from "../../lib/util";
import { LogoMark } from "../../shared/ui";
import { ModelProviderIcon } from "./ModelProviderIcon";

export interface MessageMetaProps {
  title?: string;
  timestamp: string;
  align?: "left" | "right";
  order?: "title-first" | "time-first";
}

export function MessageMeta({
  title,
  timestamp,
  align = "left",
  order = "title-first",
}: MessageMetaProps): JSX.Element {
  const titleNode = title ? (
    <span className="min-w-0 truncate text-[13.5px] font-semibold text-content-primary">{title}</span>
  ) : null;
  const timeNode = (
    <span className="shrink-0 text-[10.5px] tabular-nums text-content-muted opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100">
      {formatTime(timestamp)}
    </span>
  );

  return (
    <div className={cn("flex min-w-0 items-baseline gap-2", align === "right" && "justify-end")} data-ui-chrome>
      {order === "time-first" ? timeNode : titleNode}
      {order === "time-first" ? titleNode : timeNode}
    </div>
  );
}

export function AssistantMessageAvatar(): JSX.Element {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center" aria-label="Senera" data-message-avatar="assistant">
      <LogoMark size={30} />
    </span>
  );
}

export interface MessageAvatarProps {
  role: "user" | "assistant";
  icon?: string;
  profile?: UserProfile;
}

export function MessageAvatar({ role, icon, profile }: MessageAvatarProps): JSX.Element {
  if (role === "user") {
    const fallback = readUserInitial(profile?.name);
    return (
      <div
        className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-muted text-[12px] font-semibold text-content-secondary"
        data-message-avatar="user"
      >
        {profile?.avatarDataUrl ? (
          <img src={profile.avatarDataUrl} alt={profile.name} className="h-full w-full object-cover" />
        ) : fallback ? (
          fallback
        ) : (
          <User className="h-4 w-4" />
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
