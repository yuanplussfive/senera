import type { ComponentProps } from "react";
import type {
  AgentPluginIdentityPresentation,
  AgentToolPresentationIcon as AgentToolPresentationIconName,
} from "../../../../../Source/AgentSystem/Types/AgentToolPresentationTypes";
import { cn } from "../../../lib/util";
import { AgentToolPresentationIcon } from "../../../shared/workspace/AgentToolPresentationIcon";
import { BrandIcon } from "../../../shared/ui/BrandIcon";

/** A package without identity metadata always receives this stable semantic mark. */
export const DefaultPluginIdentityIcon = "puzzle" satisfies AgentToolPresentationIconName;

/**
 * One optical column for package and tool marks, without decorating each
 * identity as a separate tile. Color follows the surrounding theme.
 */
export const PluginIdentityFrameClassName = "grid h-8 w-8 shrink-0 place-items-center text-content-secondary";

export function PluginIdentityFrame({ className, children, ...props }: ComponentProps<"span">): JSX.Element {
  return (
    <span {...props} className={cn(PluginIdentityFrameClassName, className)}>
      {children}
    </span>
  );
}

/** Directory/hero identity; tool rows retain the smaller unboxed frame. */
export function PluginIdentityTile({ className, children, ...props }: ComponentProps<"span">): JSX.Element {
  return (
    <span
      {...props}
      className={cn(
        "grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-line bg-surface-panel text-content-secondary",
        className,
      )}
    >
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
  if (brandIcon) return <BrandIcon brand={brandIcon} size={size} className={className} />;
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
