import { cn } from "../../lib/util";
import { resolveFilePreview } from "../../lib/filePreview";
import { AppIcon, Tooltip } from "../../shared/ui";

interface FilePreviewIconProps {
  name: string;
  mime?: string;
  className?: string;
  iconClassName?: string;
}

export function FilePreviewIcon({ name, mime, className, iconClassName }: FilePreviewIconProps): JSX.Element {
  const preview = resolveFilePreview({ name, mime });
  return (
    <Tooltip content={preview.label} side="top">
      <span
        className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-md border", preview.badgeClassName, className)}
        role="img"
        aria-label={preview.label}
      >
        <AppIcon icon={preview.icon} size={14} className={cn(preview.iconClassName, iconClassName)} />
      </span>
    </Tooltip>
  );
}
