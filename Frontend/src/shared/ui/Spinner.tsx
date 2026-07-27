import { Loader2 } from "lucide-react";
import { cn } from "../../lib/util";

export type SpinnerSize = "xs" | "sm" | "md";

const sizeClasses: Record<SpinnerSize, string> = {
  xs: "h-3 w-3",
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
};

/**
 * 全站唯一的旋转加载图标。颜色继承 currentColor，由使用处的文字颜色决定；
 * 动画遵循全局减动效设置。
 */
export function Spinner({ size = "sm", className }: { size?: SpinnerSize; className?: string }): JSX.Element {
  return (
    <Loader2 aria-hidden="true" className={cn("shrink-0 motion-safe:animate-spin", sizeClasses[size], className)} />
  );
}
