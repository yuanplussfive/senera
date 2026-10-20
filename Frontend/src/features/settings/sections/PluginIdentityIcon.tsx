import { Icon } from "@iconify/react/offline";
import gitLogo from "@iconify-icons/logos/git-icon";
import type { ComponentProps } from "react";
import type {
  AgentPluginBrandIcon,
  AgentPluginIdentityPresentation,
  AgentToolPresentationIcon as AgentToolPresentationIconName,
} from "../../../../../Source/AgentSystem/Types/AgentToolPresentationTypes";
import { cn } from "../../../lib/util";
import { AgentToolPresentationIcon } from "../../../shared/workspace/AgentToolPresentationIcon";

const PluginBrandIcons = {
  git: gitLogo,
} as const satisfies Record<AgentPluginBrandIcon, typeof gitLogo>;

/** A package without identity metadata always receives this stable semantic mark. */
export const DefaultPluginIdentityIcon = "server" satisfies AgentToolPresentationIconName;

/**
 * The frame is intentionally quieter than a card: it only keeps a compact
 * logo legible against both surface themes. Reusing it prevents individual
 * settings surfaces from drifting toward different box treatments.
 */
export const PluginIdentityFrameClassName =
  "grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-panel/45 ring-1 ring-inset ring-line-subtle/25 text-content-primary transition-[background-color,box-shadow] group-hover:bg-surface-panel/70 group-hover:ring-line-subtle/40";

export function PluginIdentityFrame({ className, children, ...props }: ComponentProps<"span">): JSX.Element {
  return (
    <span {...props} className={cn(PluginIdentityFrameClassName, className)}>
      {children}
    </span>
  );
}

/**
 * Resolves a package-declared identity mark from the local registry. The
 * frontend does not infer logos from package IDs, display names, or transports.
 */
export function PluginIdentityIcon({
  brandIcon,
  icon,
  size = 16,
  className,
}: AgentPluginIdentityPresentation & {
  size?: number;
  className?: string;
}): JSX.Element {
  const brand = brandIcon ? PluginBrandIcons[brandIcon] : undefined;
  if (brand && brandIcon) {
    return (
      <Icon
        icon={brand}
        width={size}
        height={size}
        aria-hidden="true"
        className={cn("shrink-0 brightness-0 dark:invert", className)}
        data-plugin-brand-icon={brandIcon}
      />
    );
  }
  const semanticIcon = icon ?? DefaultPluginIdentityIcon;
  return (
    <AgentToolPresentationIcon
      icon={semanticIcon}
      size={size}
      className={className}
      aria-hidden="true"
      data-plugin-semantic-icon={semanticIcon}
      {...(icon === undefined ? { "data-plugin-fallback-icon": semanticIcon } : {})}
    />
  );
}
