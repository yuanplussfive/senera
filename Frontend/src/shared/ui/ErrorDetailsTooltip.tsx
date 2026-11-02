import type { ReactNode } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Tooltip, TooltipProvider } from "./Tooltip";

/** Loaded only when recovery details are visible, keeping portal dependencies out of bootstrap. */
export function ErrorDetailsTooltip({ children }: { children: ReactNode }): JSX.Element {
  return (
    <TooltipProvider>
      <Tooltip content={frontendMessage("app.errorBoundary.copyDetails")}>{children}</Tooltip>
    </TooltipProvider>
  );
}
