import { cn } from "../../lib/util";
import { resolveFilePreview } from "../../lib/filePreview";

interface FilePreviewIconProps {
  name: string;
  mime?: string;
  className?: string;
  iconClassName?: string;
}

export function FilePreviewIcon({ name, mime, className, iconClassName }: FilePreviewIconProps): JSX.Element {
  const preview = resolveFilePreview({ name, mime });
  const Icon = preview.Icon;

  return (
    <span
      className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-md border", preview.badgeClassName, className)}
      title={preview.label}
      aria-label={preview.label}
    >
      <Icon className={cn("h-3.5 w-3.5", preview.iconClassName, iconClassName)} />
    </span>
  );
}
