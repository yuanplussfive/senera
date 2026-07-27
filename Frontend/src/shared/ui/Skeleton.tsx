import { cn } from "../../lib/util";

/**
 * 骨架占位块。统一走 index.css 的 .shimmer（--theme-skeleton-* 令牌，主题安全），
 * 尺寸与圆角由调用处的 className 决定，应与真实内容一致以避免加载完成后的跳变。
 */
export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <span aria-hidden="true" className={cn("shimmer block rounded-sm", className)} />;
}
