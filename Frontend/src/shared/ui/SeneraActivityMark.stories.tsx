import type { Story } from "@ladle/react";
import { SeneraActivityMark } from "./SeneraActivityMark";

export const Live: Story = () => (
  <div className="flex items-center gap-3 p-4 text-content-secondary">
    <SeneraActivityMark size={16} />
    <span className="text-sm">思考中</span>
  </div>
);

export const Static: Story = () => (
  <div className="flex items-center gap-3 p-4 text-content-secondary">
    <SeneraActivityMark size={16} active={false} />
    <span className="text-sm">Senera 信号</span>
  </div>
);
