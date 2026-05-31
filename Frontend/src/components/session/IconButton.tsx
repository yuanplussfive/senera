import { forwardRef } from "react";
import { cn } from "../../lib/util";
import { Button, type ButtonProps } from "../ui-shadcn/button";

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, children, variant = "ghost", size = "icon", ...props }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      className={cn(
        "grid rounded-lg text-ink-600 hover:bg-ink-900/[0.05] hover:text-ink-900 focus-visible:ring-terra-300",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  ),
);
IconButton.displayName = "IconButton";
