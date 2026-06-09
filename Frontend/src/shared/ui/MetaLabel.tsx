import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/util";

export type MetaLabelSize = "xs" | "sm" | "md";

export interface MetaLabelProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  size?: MetaLabelSize;
}

const metaLabelSizeClasses: Record<MetaLabelSize, string> = {
  xs: "text-[9.5px]",
  sm: "text-[10px]",
  md: "text-[10.5px]",
};

export function metaLabelClassName(size: MetaLabelSize = "md", className?: string): string {
  return cn(
    "font-mono uppercase tracking-wider text-ink-400",
    metaLabelSizeClasses[size],
    className,
  );
}

export function MetaLabel({
  as: Component = "span",
  children,
  className,
  size = "md",
  ...props
}: MetaLabelProps): JSX.Element {
  return (
    <Component
      className={metaLabelClassName(size, className)}
      {...props}
    >
      {children}
    </Component>
  );
}
