import type { Story } from "@ladle/react";
import { ThinkingIndicator } from "./ThinkingIndicator";

export const States: Story = () => (
  <main className="min-h-[220px] bg-surface-canvas p-8 text-content-secondary">
    <div className="flex flex-col gap-6">
      <ThinkingIndicator aria-label="正在思考" />
      <ThinkingIndicator size="compact" aria-label="正在思考" />
      <ThinkingIndicator size="compact" showIcon={false} aria-label="正在思考" />
    </div>
  </main>
);

export const ThemeColors: Story = () => (
  <main className="min-h-[220px] bg-surface-panel p-8">
    <div className="flex flex-wrap gap-8">
      <span className="text-accent-content">
        <ThinkingIndicator size="compact" aria-label="强调色思考" />
      </span>
      <span className="text-content-primary">
        <ThinkingIndicator size="compact" aria-label="主文字思考" />
      </span>
      <span className="text-content-muted">
        <ThinkingIndicator size="compact" aria-label="弱文字思考" />
      </span>
    </div>
  </main>
);
