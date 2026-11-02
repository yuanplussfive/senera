import { cn } from "../../lib/util";
import { resolveFilePreview } from "../../lib/filePreview";
import { AppIcon, Tooltip } from "../../shared/ui";

interface FilePreviewIconProps {
  name: string;
  mime?: string;
  className?: string;
  iconClassName?: string;
  row?: boolean;
}

export type FilePreviewRowTone = "neutral" | "added" | "deleted";

interface FilePreviewRowIconProps {
  readonly name: string;
  readonly mime?: string;
  readonly tone?: FilePreviewRowTone;
}

export function FilePreviewIcon({
  name,
  mime,
  className,
  iconClassName,
  row = false,
}: FilePreviewIconProps): JSX.Element {
  const preview = resolveFilePreview({ name, mime });
  return (
    <Tooltip content={preview.label} side="top">
      <span
        className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-md border", preview.badgeClassName, className)}
        role="img"
        aria-label={preview.label}
        data-file-preview-row-icon={row || undefined}
      >
        <AppIcon icon={preview.icon} size={14} className={cn(preview.iconClassName, iconClassName)} />
      </span>
    </Tooltip>
  );
}

/**
 * The common file glyph frame for result rows. File resources and workspace
 * mutations share this geometry so their names begin on the same column.
 */
export function FilePreviewRowIcon({ name, mime, tone = "neutral" }: FilePreviewRowIconProps): JSX.Element {
  return (
    <FilePreviewIcon
      name={name}
      mime={mime}
      row
      className={cn(
        "h-7 w-7",
        tone === "added" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "deleted" && "bg-rose-500/10 text-rose-700 dark:text-rose-300",
        tone === "neutral" && "bg-surface-hover text-content-secondary",
      )}
    />
  );
}
