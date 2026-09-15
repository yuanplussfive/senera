import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/util";
import { MotionIconSwap } from "../motion";
import { Spinner } from "./Spinner";

type ButtonVariant = "default" | "ghost" | "outline" | "destructive";
type ButtonSize = "default" | "icon" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Keeps the action's geometry stable while work is in flight. */
  loading?: boolean;
  /** Brief completion feedback; the label remains in place. */
  success?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "bg-accent-solid text-accent-on-solid shadow-[0_1px_2px_rgb(var(--color-accent-700)/0.18)] hover:bg-accent-solid-hover hover:shadow-[0_2px_5px_rgb(var(--color-accent-700)/0.22)] active:bg-accent-solid-pressed active:shadow-none",
  ghost: "text-content-secondary hover:bg-surface-hover hover:text-content-primary",
  outline:
    "border border-line bg-surface-panel/90 text-content-secondary shadow-panel hover:border-line-strong hover:bg-surface-hover hover:text-content-primary",
  destructive:
    "bg-brick-600 text-paper-50 shadow-soft hover:bg-brick-700 hover:shadow-soft focus-visible:ring-brick-200 active:shadow-none",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-9 px-3.5",
  sm: "h-8 px-3 text-[12.5px]",
  icon: "h-9 w-9 p-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      type = "button",
      loading = false,
      success = false,
      disabled = false,
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-senera-button="true"
      data-button-variant={variant}
      data-button-size={size}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] text-[13px] font-medium",
        "transition-[background-color,border-color,box-shadow,color,transform] duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
        "active:translate-y-px",
        "disabled:pointer-events-none disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      <span className="relative inline-flex min-w-0 items-center justify-center">
        <span className={cn("inline-flex min-w-0 items-center gap-1.5", (loading || success) && "opacity-0")}>
          {children}
        </span>
        {loading || success ? (
          <MotionIconSwap stateKey={loading ? "loading" : "success"} className="absolute inset-0 m-auto h-3.5 w-3.5">
            {loading ? <Spinner size="xs" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
          </MotionIconSwap>
        ) : null}
      </span>
    </button>
  ),
);
Button.displayName = "Button";
