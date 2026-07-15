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
    "bg-ink-900 text-paper-50 shadow-[0_1px_2px_rgb(33_30_24/0.2),0_6px_14px_-8px_rgb(33_30_24/0.5)] hover:bg-ink-800",
  ghost: "text-ink-600 hover:bg-ink-900/[0.05] hover:text-ink-900",
  outline:
    "border border-ink-200 bg-paper-50 text-ink-700 shadow-[0_1px_2px_rgb(33_30_24/0.04)] hover:border-ink-300 hover:bg-ink-900/[0.035]",
  destructive: "bg-brick-600 text-paper-50 shadow-[0_1px_2px_rgb(146_64_14/0.25)] hover:bg-brick-700",
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
        "focus-visible:outline-none",
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
