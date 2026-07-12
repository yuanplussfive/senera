import { User } from "lucide-react";
import type { UserProfile } from "../../store/sessionStore";
import { cn, formatTime } from "../../lib/util";
import { ModelProviderIcon } from "./ModelProviderIcon";

export interface MessageMetaProps {
  title: string;
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
  const titleNode = <span className="min-w-0 truncate text-[13px] font-semibold text-ink-850">{title}</span>;
  const timeNode = <span className="shrink-0 font-mono text-[10.5px] text-ink-400">{formatTime(timestamp)}</span>;

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
      <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-ink-200 text-[12px] font-semibold text-ink-700 ring-1 ring-ink-200/80">
        {profile?.avatarDataUrl ? (
          <img src={profile.avatarDataUrl} alt={profile.name} className="h-full w-full object-cover" />
        ) : fallback ? (
          fallback
        ) : (
          <User className="h-3.5 w-3.5" />
        )}
      </div>
    );
  }

  const hasIcon = !!icon;
  return (
    <div className="relative grid h-8 w-8 shrink-0 place-items-center">
      <div
        className={cn(
          "relative z-10 grid h-8 w-8 place-items-center rounded-xl text-ink-700",
          hasIcon ? "bg-paper-50 ring-1 ring-ink-200" : "bg-transparent",
        )}
      >
        {hasIcon ? <ModelProviderIcon icon={icon} size={18} /> : null}
      </div>
    </div>
  );
}

export function readUserInitial(name?: string): string {
  return name?.trim().slice(0, 1).toUpperCase() ?? "";
}
