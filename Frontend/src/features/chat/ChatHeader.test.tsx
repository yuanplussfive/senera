import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "../../shared/ui";
import { ChatHeader } from "./ChatHeader";

describe("ChatHeader", () => {
  it("does not own shell breakpoint visibility for drawer entry actions", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ChatHeader
          title="Session"
          onOpenSessionPanel={() => undefined}
          onOpenWorkflowPanel={() => undefined}
        />
      </TooltipProvider>,
    );

    expect(markup).not.toContain("md:hidden");
    expect(markup).not.toContain("2xl:hidden");
  });
});
