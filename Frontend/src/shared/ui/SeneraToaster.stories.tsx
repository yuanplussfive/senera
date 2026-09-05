import type { Story } from "@ladle/react";
import { toast } from "sonner";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Button } from "./Button";
import { SeneraToaster } from "./SeneraToaster";

export const Statuses: Story = () => (
  <div className="min-h-[260px] bg-surface-canvas p-8 text-content-primary">
    <SeneraToaster position="top-right" />
    <div className="mx-auto max-w-xl">
      <h3 className="text-[15px] font-semibold">状态反馈</h3>
      <p className="mt-2 text-[13px] leading-6 text-content-secondary">{frontendMessage("preferences.description")}</p>
      <div className="mt-6 flex flex-wrap gap-2 border-y border-line-subtle py-6">
        <Button
          variant="outline"
          onClick={() =>
            toast.success(frontendMessage("resource.saved"), { description: frontendMessage("config.mainSaved") })
          }
        >
          {frontendMessage("config.main.save")}
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast.loading(frontendMessage("resource.saving"), {
              description: frontendMessage("auth.reconnectingDescription"),
            })
          }
        >
          {frontendMessage("resource.saving")}
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast.warning(frontendMessage("auth.reconnecting"), {
              description: frontendMessage("auth.reconnectingDescription"),
            })
          }
        >
          {frontendMessage("auth.reconnecting")}
        </Button>
      </div>
    </div>
  </div>
);
