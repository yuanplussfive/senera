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
    <div className={cn("text-[13px] font-medium leading-5 text-ink-800", className)}>
      {children}
      {required ? <span className="ml-1 text-brick-600">*</span> : null}
    </div>
  );
}

export function FormHint({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <p className={cn("text-[12px] leading-5 text-ink-450", className)}>{children}</p>;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-11 w-full min-w-0 rounded-lg border border-ink-200 bg-paper-50 px-3.5 text-[14px] text-ink-850",
        "outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-ink-350",
        "hover:border-ink-300 focus:border-terra-300 focus:ring-2 focus:ring-terra-100",
        "aria-[invalid=true]:border-brick-300 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-brick-100/70",
        "disabled:cursor-not-allowed disabled:bg-paper-100 disabled:opacity-60",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
