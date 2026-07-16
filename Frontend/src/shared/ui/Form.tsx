import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/util";

export function FormField({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={cn("grid gap-2", className)}>{children}</div>;
}

export function FormLabel({
  children,
  className,
  required,
}: {
  children: ReactNode;
  className?: string;
  required?: boolean;
}): JSX.Element {
  return (
    <div className={cn("text-[13px] font-medium leading-5 text-content-primary", className)}>
      {children}
      {required ? <span className="ml-1 text-brick-600">*</span> : null}
    </div>
  );
}

export function FormHint({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <p className={cn("text-[12px] leading-5 text-content-muted", className)}>{children}</p>;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-11 w-full min-w-0 rounded-lg border border-line bg-surface-panel px-3.5 text-[14px] text-content-primary",
        "outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-content-disabled",
        "hover:border-line-strong focus:border-accent-border focus:ring-2 focus:ring-accent-focus",
        "aria-[invalid=true]:border-brick-300 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-brick-100/70",
        "disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
