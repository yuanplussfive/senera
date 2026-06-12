import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/util";

type ButtonVariant = "default" | "ghost" | "outline" | "destructive";
type ButtonSize = "default" | "icon" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-ink-900 text-paper-50 hover:bg-ink-800",
  ghost: "text-ink-600 hover:bg-ink-900/[0.05] hover:text-ink-900",
  outline: "border border-ink-200 bg-paper-50 text-ink-700 hover:bg-ink-900/[0.04]",
  destructive: "bg-brick-600 text-paper-50 hover:bg-brick-700",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-9 px-3",
  sm: "h-8 px-2.5 text-[12.5px]",
  icon: "h-8 w-8 p-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-200/70",
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
