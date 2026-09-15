import { X } from "lucide-react";
import type { ReactNode } from "react";
import { ImageCanvasViewer, type ImageCanvasViewerLabels } from "./ImageCanvasViewer";
import { Dialog, DialogContent, IconButton, Tooltip } from "../ui";

export interface ImagePreviewDialogProps {
  readonly alt: string;
  readonly closeLabel: string;
  readonly headerActions?: ReactNode;
  readonly labels: ImageCanvasViewerLabels;
  readonly onError?: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly source: string;
  readonly title: string;
}

export function ImagePreviewDialog({
  alt,
  closeLabel,
  headerActions,
  labels,
  onError,
  onOpenChange,
  open,
  source,
  title,
}: ImagePreviewDialogProps): JSX.Element {
  const controlClassName = "text-content-secondary hover:bg-surface-hover hover:text-content-primary";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        showClose={false}
        showHeader={false}
        placement="inset"
        motionPreset="focus"
        frameClassName="inset-2 sm:inset-4"
        className="h-full !max-h-none w-full max-w-none"
        bodyClassName="flex min-h-0 flex-1 flex-col"
        data-image-preview-dialog
        aria-describedby={undefined}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle px-2 sm:px-3">
          <Tooltip content={alt || title} side="bottom">
            <span className="min-w-0 flex-1 truncate px-1 text-[12px] text-content-secondary">{alt || title}</span>
          </Tooltip>
          <div className="flex shrink-0 items-center gap-0.5">
            {headerActions}
            <IconButton
              label={closeLabel}
              tooltip={closeLabel}
              tooltipSide="bottom"
              size="md"
              className={controlClassName}
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
        <ImageCanvasViewer
          alt={alt || title}
          className="min-h-0 flex-1"
          labels={labels}
          source={source}
          onError={onError}
        />
      </DialogContent>
    </Dialog>
  );
}
