import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/util";

type ButtonVariant = "default" | "ghost" | "outline" | "destructive";
type ButtonSize = "default" | "icon" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "bg-accent-solid text-accent-on-solid shadow-accent hover:bg-accent-solid-hover active:bg-accent-solid-pressed",
  ghost: "text-content-secondary hover:bg-surface-hover hover:text-content-primary",
  outline:
    "border border-line bg-surface-panel text-content-secondary shadow-[0_1px_2px_rgb(33_30_24/0.04)] hover:border-line-strong hover:bg-surface-hover hover:text-content-primary",
  destructive:
    "bg-brick-600 text-paper-50 shadow-[0_1px_2px_rgb(146_64_14/0.25)] hover:bg-brick-700 focus-visible:ring-brick-200",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-10 px-4",
  sm: "h-9 px-3 text-[12.5px]",
  icon: "h-9 w-9 p-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium",
        "transition-[background-color,border-color,box-shadow,color] duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
        "disabled:pointer-events-none disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
