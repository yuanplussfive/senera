import type { Story } from "@ladle/react";
import { ErrorBanner, InlineError, RetryButton, StateView } from "./StateView";
import { AppIcon } from "./AppIcon";
import { Skeleton } from "./Skeleton";
import { Spinner } from "./Spinner";

export const Loading: Story = () => (
  <div className="h-64 border border-line-subtle">
    <StateView status="loading" description="正在获取模型列表" />
  </div>
);

export const ErrorWithRetry: Story = () => (
  <div className="h-64 border border-line-subtle">
    <StateView status="error" title="模型列表获取失败" description="请检查网络连接后重试" onRetry={() => undefined} />
  </div>
);

export const ErrorWithCustomAction: Story = () => (
  <div className="h-64 border border-line-subtle">
    <StateView
      status="error"
      title="服务连接已中断"
      description="重新连接后可以继续加载模型列表"
      action={<RetryButton onRetry={() => undefined} label="重新连接" />}
    />
  </div>
);

export const Empty: Story = () => (
  <div className="h-64 border border-line-subtle">
    <StateView
      status="empty"
      icon={<AppIcon icon="folder" size={16} aria-hidden="true" />}
      description="添加供应商后填写连接信息"
    />
  </div>
);

export const InlineErrorRow: Story = () => (
  <div className="flex max-w-sm flex-col gap-4 p-8">
    <InlineError announce="assertive">供应商密钥无效</InlineError>
    <InlineError announce="polite" onRetry={() => undefined} retryLabel="重新获取">
      模型列表获取失败，连接可能已断开，这里演示一条较长的错误信息的折行表现
    </InlineError>
  </div>
);

export const Banner: Story = () => (
  <div className="flex max-w-xl flex-col gap-6 p-8">
    <ErrorBanner
      title="历史同步失败"
      description="这段会话还在后端，重新同步后会恢复消息。"
      onRetry={() => undefined}
    />
    <ErrorBanner
      title="资源读取失败"
      description="文件可能已被移动或删除。"
      action={
        <button type="button" className="text-[12px] font-medium text-accent-content hover:text-accent-content-hover">
          重新选择
        </button>
      }
    />
  </div>
);

export const Primitives: Story = () => (
  <div className="flex flex-col gap-6 p-8">
    <div className="flex items-center gap-4 text-content-secondary">
      <Spinner size="xs" />
      <Spinner size="sm" />
      <Spinner size="md" />
      <RetryButton onRetry={() => undefined} />
    </div>
    <div className="flex max-w-xs flex-col gap-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-[62%]" />
    </div>
  </div>
);
