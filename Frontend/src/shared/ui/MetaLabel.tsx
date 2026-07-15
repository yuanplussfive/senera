import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cn } from "../../lib/util";

export type MetaLabelSize = "xs" | "sm" | "md";

export type MetaLabelProps<T extends ElementType = "span"> = {
  as?: T;
  children: ReactNode;
  className?: string;
  size?: MetaLabelSize;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

const metaLabelSizeClasses: Record<MetaLabelSize, string> = {
  xs: "text-[9.5px]",
  sm: "text-[10px]",
  md: "text-[10.5px]",
};

export function metaLabelClassName(size: MetaLabelSize = "md", className?: string): string {
  return cn("select-none font-medium text-ink-500", metaLabelSizeClasses[size], className);
}

export function MetaLabel<T extends ElementType = "span">({
  as,
  children,
  className,
  size = "md",
  ...props
}: MetaLabelProps<T>): JSX.Element {
  const Component = as ?? "span";
  return (
    <Component className={metaLabelClassName(size, className)} {...props}>
      {children}
    </Component>
  );
}
