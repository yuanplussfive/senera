import { Fragment, type CSSProperties } from "react";
import { cn } from "../../lib/util";
import { AppIcon } from "../../shared/ui/AppIcon";
import type { ToolActivityInspection } from "./toolActivityPresentation";

/**
 * Renders a tool action and its target as separate visual parts. The target
 * arrow is intentionally an icon so it cannot be confused with disclosure
 * controls or become part of a localized label string.
 */
export function ToolActivityLabel({
  inspection,
  fallback,
  className,
  style,
  title,
}: {
  inspection?: ToolActivityInspection;
  fallback: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
}): JSX.Element {
  const action = inspection?.action;
  const target = inspection?.argumentPreview;
  const targetParts = inspection?.argumentPreviewParts?.length
    ? inspection.argumentPreviewParts
    : target
      ? [target]
      : [];
  const structured = Boolean(action && targetParts.length > 0 && !inspection?.workspaceSummary);

  if (!structured) {
    if (!className && !style && !title) return <>{fallback}</>;
    return (
      <span className={cn("min-w-0 whitespace-nowrap", className)} style={style} title={title} data-tool-activity-label>
        {fallback}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full flex-nowrap items-center gap-1.5 overflow-hidden whitespace-nowrap",
        className,
      )}
      style={style}
      title={title}
      data-tool-activity-label
    >
      <span className="shrink-0 text-content-primary">{action}</span>
      {inspection?.identity ? (
        <span className="min-w-0 max-w-[35%] truncate text-content-muted">{inspection.identity}</span>
      ) : null}
      <AppIcon
        icon="arrow-right"
        size={12}
        strokeWidth={1.7}
        className="shrink-0 text-content-muted"
        data-tool-activity-arrow
      />
      <span className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden text-content-secondary">
        {targetParts.map((part, index) => (
          <Fragment key={`${part}:${index}`}>
            {index > 0 ? (
              <AppIcon
                icon="link"
                size={11}
                strokeWidth={1.7}
                className="shrink-0 text-content-muted"
                data-tool-activity-link
              />
            ) : null}
            <span className={cn("min-w-0 truncate", index === targetParts.length - 1 ? "flex-1" : "shrink-0")}>
              {part}
            </span>
          </Fragment>
        ))}
      </span>
    </span>
  );
}
