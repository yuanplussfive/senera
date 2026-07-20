import type { Story } from "@ladle/react";
import { useState } from "react";
import { Button } from "./Button";
import { ErrorBoundary } from "./ErrorBoundary";

function FailureProbe({ failed }: { failed: boolean }): JSX.Element {
  if (failed) {
    throw new Error("Simulated render failure for ErrorBoundary preview");
  }

  return (
    <div className="border-t border-line-subtle py-8 text-center text-[13px] text-content-secondary">
      子界面当前可以正常渲染。
    </div>
  );
}

export const ComponentRecovery: Story = () => {
  const [failed, setFailed] = useState(false);

  return (
    <main className="min-h-[520px] bg-surface-canvas p-6 text-content-primary sm:p-10">
      <div className="mx-auto max-w-[680px]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[18px] font-semibold text-content-strong">组件级错误恢复</h1>
            <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
              错误边界捕获子界面渲染错误，不影响外层操作。
            </p>
          </div>
          <Button variant="outline" onClick={() => setFailed((value) => !value)}>
            {failed ? "恢复子界面" : "模拟渲染错误"}
          </Button>
        </div>

        <div className="mt-6 h-[300px] overflow-hidden border border-line bg-surface-panel">
          <ErrorBoundary resetKey={failed}>
            <FailureProbe failed={failed} />
          </ErrorBoundary>
        </div>
      </div>
    </main>
  );
};

export const AppRecovery: Story = () => (
  <main className="min-h-[520px] bg-surface-canvas p-6 text-content-primary sm:p-10">
    <div className="mx-auto max-w-[980px]">
      <ErrorBoundary presentation="app">
        <FailureProbe failed />
      </ErrorBoundary>
    </div>
  </main>
);

export const CustomFallback: Story = () => (
  <main className="min-h-[420px] bg-surface-canvas p-6 text-content-primary sm:p-10">
    <div className="mx-auto max-w-[680px]">
      <h1 className="text-[18px] font-semibold text-content-strong">自定义恢复界面</h1>
      <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
        业务可以提供自己的说明，但错误捕获和重置仍由公共组件负责。
      </p>

      <div className="mt-6 border border-line bg-surface-panel p-5">
        <ErrorBoundary
          fallback={(error) => (
            <div role="alert">
              <div className="text-[14px] font-semibold text-content-strong">预览暂时无法显示</div>
              <p className="mt-1 text-[12.5px] leading-5 text-content-muted">{error.message}</p>
            </div>
          )}
        >
          <FailureProbe failed />
        </ErrorBoundary>
      </div>
    </div>
  </main>
);
