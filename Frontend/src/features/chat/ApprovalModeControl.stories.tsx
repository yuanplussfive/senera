import type { Story } from "@ladle/react";
import { useState } from "react";
import { ExecutionApprovalModes, type ExecutionApprovalMode } from "../../api/executionApprovalMode";
import { useResponsiveMode } from "../../shared/responsive";
import ApprovalModeControl from "./ApprovalModeControl";

export const Modes: Story = () => {
  const [mode, setMode] = useState<ExecutionApprovalMode>(ExecutionApprovalModes.Agent);
  const { prefersCompactControls } = useResponsiveMode();
  return (
    <div className="flex min-h-[520px] flex-col items-center justify-end gap-4 bg-surface-canvas p-5 text-content-primary">
      <p className="text-xs text-content-muted">审批策略带用途说明，选中标记在右侧；手机保留紧凑入口。</p>
      <ApprovalModeControl
        disabled={false}
        mode={mode}
        onSelect={setMode}
        prefersCompactControls={prefersCompactControls}
      />
    </div>
  );
};
