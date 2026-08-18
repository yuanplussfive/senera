import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CapabilityIconStrip,
  CapabilityToggle,
  ToolPlanningModeControl,
} from "../../../Frontend/src/features/chat/ModelCapabilityControls.tsx";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

afterEach(() => cleanup());

describe("model capability controls", () => {
  it("summarizes enabled capabilities without rendering an icon for every capability", () => {
    const { container } = renderWithFrontendProviders(
      React.createElement(CapabilityIconStrip, {
        capabilities: {
          Chat: true,
          Embedding: true,
          Rerank: true,
          Vision: true,
          ImageOutput: true,
          Reasoning: false,
          ToolCalling: false,
          DeveloperRole: false,
          StreamingUsage: false,
        },
      }),
    );

    const summary = container.querySelector("[data-model-capability-summary]");
    expect(summary).toHaveAttribute("data-capability-count", "5");
    expect(summary.querySelectorAll("svg")).toHaveLength(3);
    expect(summary).toHaveTextContent("+2");
    expect(summary).toHaveAccessibleName(/对话.*图像输出/);
  });

  it("uses switch semantics for capability editing and retains the selected planning mode", async () => {
    const user = userEvent.setup();
    const onCapabilityChange = vi.fn();
    const onPlanningModeChange = vi.fn();
    const { container } = renderWithFrontendProviders(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(CapabilityToggle, {
          label: "对话",
          icon: React.createElement("span", null, "C"),
          iconClassName: "text-ink-500",
          enabled: true,
          disabled: false,
          onChange: onCapabilityChange,
        }),
        React.createElement(ToolPlanningModeControl, {
          value: "native",
          disabled: false,
          onChange: onPlanningModeChange,
        }),
      ),
    );

    expect(container.querySelectorAll("[data-model-capability-toggle]")).toHaveLength(1);
    expect(screen.getByRole("switch", { name: "对话" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "原生工具调用" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("switch", { name: "对话" }));
    await user.click(screen.getByRole("radio", { name: "BAML 规划" }));

    expect(onCapabilityChange).toHaveBeenCalledWith(false);
    expect(onPlanningModeChange).toHaveBeenCalledWith("baml");
  });
});
