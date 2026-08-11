import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { MarkdownRenderer } from "../../../Frontend/src/shared/code/MarkdownRenderer";
import {
  formatWorkspaceResourceLocation,
  parseWorkspaceResourceLocator,
} from "../../../Frontend/src/shared/workspace/WorkspaceResourceLocator";

describe("workspace resource locators", () => {
  test.each([
    ["E:/senera/Source/file.ts:123:7", { path: "E:/senera/Source/file.ts", line: 123, column: 7 }],
    ["E:\\senera\\Source\\file.ts", { path: "E:/senera/Source/file.ts" }],
    ["/E:/senera/Source/file.ts", { path: "E:/senera/Source/file.ts" }],
    ["/workspace/Source/file.ts#L45", { path: "/workspace/Source/file.ts", line: 45 }],
    ["file:///E:/senera/image.png#L2", { path: "E:/senera/image.png", line: 2 }],
    ["Source/AgentSystem/App.ts", { path: "Source/AgentSystem/App.ts" }],
  ])("parses %s", (value, expected) => {
    expect(parseWorkspaceResourceLocator(value)).toEqual(expected);
  });

  test("leaves external links and document anchors outside the workspace protocol", () => {
    expect(parseWorkspaceResourceLocator("https://example.com/file.ts")).toBeUndefined();
    expect(parseWorkspaceResourceLocator("#configuration")).toBeUndefined();
    expect(parseWorkspaceResourceLocator("mailto:user@example.com")).toBeUndefined();
    expect(parseWorkspaceResourceLocator("javascript:/payload.png")).toBeUndefined();
    expect(parseWorkspaceResourceLocator("//example.com/image.png")).toBeUndefined();
  });

  test("formats source positions without changing the resource path", () => {
    expect(formatWorkspaceResourceLocation({ path: "Source/App.ts", line: 9, column: 2 })).toBe("Source/App.ts:9:2");
  });
});

describe("Markdown workspace resources", () => {
  test("marks local links as workspace resources and prevents browser navigation", async () => {
    const user = userEvent.setup();
    const onWindowError = vi.fn((event) => event.preventDefault());
    window.addEventListener("error", onWindowError);
    render(React.createElement(MarkdownRenderer, null, "[AgentPi.ts](E:/senera/Source/AgentSystem/Pi/AgentPi.ts:42)"));

    const link = screen.getByRole("link", { name: "AgentPi.ts" });
    expect(link).toHaveAttribute("data-workspace-resource", "E:/senera/Source/AgentSystem/Pi/AgentPi.ts");
    await user.click(link);
    expect(onWindowError).not.toHaveBeenCalled();
    window.removeEventListener("error", onWindowError);
  });

  test("keeps HTTPS links as external links", () => {
    render(React.createElement(MarkdownRenderer, null, "[Docs](https://example.com/docs)"));
    expect(screen.getByRole("link", { name: /Docs/u })).toHaveAttribute("target", "_blank");
  });
});
