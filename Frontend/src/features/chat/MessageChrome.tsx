import { User } from "lucide-react";
import type { UserProfile } from "../../store/sessionStore";
import { cn, formatTime } from "../../lib/util";
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
    <span className="min-w-0 truncate text-[12px] font-medium text-ink-600">{title}</span>
  ) : null;
  const timeNode = (
    <span className="shrink-0 text-[10.5px] tabular-nums text-ink-400 opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100">
      {formatTime(timestamp)}
    </span>
  );

  return (
    <div className={cn("flex min-w-0 items-baseline gap-2", align === "right" && "justify-end")}>
      {order === "time-first" ? timeNode : titleNode}
      {order === "time-first" ? titleNode : timeNode}
    </div>
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
      <div className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-ink-200 text-[10px] font-semibold text-ink-700">
        {profile?.avatarDataUrl ? (
          <img src={profile.avatarDataUrl} alt={profile.name} className="h-full w-full object-cover" />
        ) : fallback ? (
          fallback
        ) : (
          <User className="h-3 w-3" />
        )}
      </div>
    );
  }

  return icon ? (
    <span className="grid h-6 w-6 shrink-0 place-items-center text-ink-500">
      <ModelProviderIcon icon={icon} size={15} />
    </span>
  ) : (
    <span className="h-6 w-6 shrink-0" aria-hidden="true" />
  );
}

export function readUserInitial(name?: string): string {
  return name?.trim().slice(0, 1).toUpperCase() ?? "";
}
