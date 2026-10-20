import { AudioLines, CloudSun, Computer, FileSearch, ScanSearch } from "lucide-react";
import type { ComponentProps } from "react";
import {
  AgentToolPresentationIconNames,
  type AgentToolPresentationIcon as AgentToolPresentationIconName,
} from "../../../../Source/AgentSystem/Types/AgentToolPresentationTypes";
import { cn } from "../../lib/util";
import { AppIcon } from "../ui/AppIcon";
import { AgentToolSpecificPresentationIcons, resolveAgentToolPresentationAppIcon } from "./agentToolPresentationIcons";

const AgentToolPresentationIconNameSet = new Set<string>(AgentToolPresentationIconNames);
const AgentToolSpecificPresentationIconSet = new Set<string>(AgentToolSpecificPresentationIcons);
const AgentToolSpecificIconCatalog = {
  "audio-lines": AudioLines,
  "cloud-sun": CloudSun,
  "computer-desktop": Computer,
  "file-search": FileSearch,
  "scan-search": ScanSearch,
} as const;

/** Checks a host-provided semantic tool icon against the generated icon vocabulary. */
export function isAgentToolPresentationIcon(value: unknown): value is AgentToolPresentationIconName {
  return typeof value === "string" && AgentToolPresentationIconNameSet.has(value);
}

function isAgentToolSpecificPresentationIcon(
  value: AgentToolPresentationIconName,
): value is keyof typeof AgentToolSpecificIconCatalog {
  return AgentToolSpecificPresentationIconSet.has(value);
}

/**
 * Renders the host's semantic tool vocabulary through the shared icon adapter.
 */
export function AgentToolPresentationIcon({
  icon,
  size = 16,
  strokeWidth = 1.75,
  className,
  ...props
}: Omit<ComponentProps<typeof AppIcon>, "icon"> & { icon: AgentToolPresentationIconName }): JSX.Element | null {
  if (isAgentToolSpecificPresentationIcon(icon)) {
    const Icon = AgentToolSpecificIconCatalog[icon];
    const ariaHidden = props["aria-hidden"] ?? (props["aria-label"] || props["aria-labelledby"] ? undefined : true);
    return (
      <Icon
        {...props}
        aria-hidden={ariaHidden}
        width={size}
        height={size}
        strokeWidth={strokeWidth}
        className={cn("shrink-0", className)}
      />
    );
  }

  const appIcon = resolveAgentToolPresentationAppIcon(icon);
  return appIcon ? (
    <AppIcon icon={appIcon} size={size} strokeWidth={strokeWidth} className={className} {...props} />
  ) : null;
}
