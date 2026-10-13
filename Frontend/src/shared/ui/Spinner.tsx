import type { SVGAttributes } from "react";
import { cn } from "../../lib/util";
import { AppIcon } from "./AppIcon";

export type SpinnerSize = "xs" | "sm" | "md";

const sizeClasses: Record<SpinnerSize, string> = {
  xs: "h-3 w-3",
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
};

const sizePixels: Record<SpinnerSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
};

/**
 * Quiet activity indicator for dense rows and buttons. The public name stays
 * Spinner for call-site compatibility, using the shared radial Loader glyph
 * so loading affordances and execution status have one visual language.
 */
export function Spinner({
  size = "sm",
  className,
  ...props
}: {
  size?: SpinnerSize;
  className?: string;
} & Omit<SVGAttributes<SVGSVGElement>, "className">): JSX.Element {
  const { height: _height, width: _width, strokeWidth: _strokeWidth, ...appIconProps } = props;
  return (
    <AppIcon
      icon="progress"
      size={sizePixels[size]}
      focusable="false"
      aria-hidden="true"
      className={cn("senera-spinner shrink-0", sizeClasses[size], className)}
      {...appIconProps}
    />
  );
}
