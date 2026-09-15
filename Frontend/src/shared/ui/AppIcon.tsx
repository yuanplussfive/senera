import {
  Activity01Icon,
  AiBrain01Icon,
  CalendarClockIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  CodeIcon,
  ComputerTerminal01Icon,
  File01Icon,
  FileCodeIcon,
  GitBranchIcon,
  GitForkIcon,
  Globe02Icon,
  Image01Icon,
  Loading03Icon,
  Message01Icon,
  MessageQuestionIcon,
  PackageIcon,
  PencilEdit01Icon,
  Search01Icon,
  UserMultipleIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react";
import { cn } from "../../lib/util";

/**
 * A deliberately small semantic icon vocabulary for product status and application activity.
 * Keep arbitrary icon selection out of feature code so visual language stays coherent.
 */
export const AppIconCatalog = {
  activity: Activity01Icon,
  brain: AiBrain01Icon,
  "calendar-clock": CalendarClockIcon,
  cancel: Cancel01Icon,
  check: CheckmarkCircle02Icon,
  clock: Clock01Icon,
  code: CodeIcon,
  "file-code": FileCodeIcon,
  "file-text": File01Icon,
  "git-branch": GitBranchIcon,
  delegation: GitForkIcon,
  globe: Globe02Icon,
  image: Image01Icon,
  loading: Loading03Icon,
  message: Message01Icon,
  "message-question": MessageQuestionIcon,
  package: PackageIcon,
  pencil: PencilEdit01Icon,
  search: Search01Icon,
  terminal: ComputerTerminal01Icon,
  tools: Wrench01Icon,
  users: UserMultipleIcon,
} as const;

export type AppIconName = keyof typeof AppIconCatalog;

export function AppIcon({
  icon,
  size = 16,
  strokeWidth = 1.75,
  className,
  ...props
}: Omit<HugeiconsIconProps, "icon" | "size" | "strokeWidth"> & {
  icon: AppIconName;
  size?: number | string;
  strokeWidth?: number;
}): JSX.Element {
  return (
    <HugeiconsIcon
      {...props}
      icon={AppIconCatalog[icon]}
      size={size}
      strokeWidth={strokeWidth}
      className={cn("shrink-0", className)}
    />
  );
}
