import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/util";

export type StatusTokenSize = "compact" | "regular";

export interface StatusTokenProps extends ComponentPropsWithoutRef<"span"> {
  readonly size?: StatusTokenSize;
}

const sizeClassNames: Record<StatusTokenSize, string> = {
  compact: "h-4 px-1.5 text-[9px]",
  regular: "h-5 px-2 text-[10px]",
};

/** A fixed-height inline status label that keeps short CJK and Latin text optically centered. */
export const StatusToken = forwardRef<HTMLSpanElement, StatusTokenProps>(
  ({ size = "regular", className, style, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex shrink-0 align-middle items-center justify-center whitespace-nowrap rounded-full font-sans font-semibold",
        sizeClassNames[size],
        className,
      )}
      style={{ ...style, lineHeight: 1 }}
      {...props}
    />
  ),
);
StatusToken.displayName = "StatusToken";
