import type { ConversationIdentity } from "../../store/sessionStore";
import { cn } from "../../lib/util";
import { AppIcon, LogoMark } from "../../shared/ui";
import { buildWorkspaceResourceUrl } from "../../api/workspaceResourceClient";
import { useWorkspaceResourceController } from "../../shared/workspace/WorkspaceResourceProvider";
import { useCallback, useEffect, useState } from "react";

export type ProfileIdentityKind = "user" | "assistant";

export function ProfileIdentityAvatar({
  identity,
  kind,
  size = "normal",
}: {
  identity: ConversationIdentity;
  kind: ProfileIdentityKind;
  size?: "normal" | "hero";
}): JSX.Element {
  const { source: avatarSource, onError } = useProfileAvatar(identity);
  const className = size === "hero" ? "h-20 w-20 rounded-full text-[24px]" : "h-8 w-8 rounded-full text-[12px]";
  const initial = identity.name.trim().slice(0, 1).toUpperCase();

  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden bg-content-strong font-semibold text-content-inverse ring-1 ring-line-subtle",
        className,
      )}
    >
      {avatarSource ? (
        <img src={avatarSource} alt={identity.name} className="h-full w-full object-cover" onError={onError} />
      ) : kind === "assistant" ? (
        <LogoMark size={size === "hero" ? 64 : 30} />
      ) : initial ? (
        initial
      ) : (
        <AppIcon icon="user" className={size === "hero" ? "h-6 w-6" : "h-3.5 w-3.5"} />
      )}
    </div>
  );
}

export function useProfileAvatar(identity: ConversationIdentity): {
  readonly source: string | undefined;
  readonly onError: () => void;
} {
  const resources = useWorkspaceResourceController();
  const workspaceSource =
    identity.avatarPath && resources
      ? buildWorkspaceResourceUrl(resources.httpBaseUrl, identity.avatarPath, true)
      : undefined;
  const candidate = workspaceSource ?? identity.avatarDataUrl ?? undefined;
  const [failedSource, setFailedSource] = useState<string>();
  useEffect(() => {
    if (failedSource && failedSource !== candidate) setFailedSource(undefined);
  }, [candidate, failedSource]);
  const onError = useCallback(() => {
    if (candidate) setFailedSource(candidate);
  }, [candidate]);
  return { source: candidate && candidate !== failedSource ? candidate : undefined, onError };
}
