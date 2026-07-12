import React from "react";
import { render } from "@testing-library/react";
import { TooltipProvider } from "../../Frontend/src/shared/ui/Tooltip.tsx";

export function renderWithFrontendProviders(ui, options) {
  return render(React.createElement(TooltipProvider, { delayDuration: 0 }, ui), options);
}
