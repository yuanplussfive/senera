import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ChatLoadingSurface,
  ChatPanelLoadingSurface,
} from "../../../Frontend/src/features/chat/ChatLoadingSurface.tsx";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";

afterEach(cleanup);

describe("chat panel loading surface", () => {
  it("keeps the first viewport geometry while the chat module is loading", () => {
    render(React.createElement(ChatPanelLoadingSurface));

    const status = screen.getByRole("status", { name: frontendMessage("app.loading") });
    expect(status).toHaveAttribute("data-chat-panel-loading");
    expect(status.querySelector("[data-chat-panel-loading-header]")).toBeInTheDocument();
    expect(status.querySelector("[data-chat-panel-loading-content]")).toBeInTheDocument();
    expect(status.querySelector("[data-chat-panel-loading-composer]")).toBeInTheDocument();
    expect(status.querySelector("[data-state-view]")).not.toBeInTheDocument();
  });

  it("renders the shared conversation skeleton inside the message track", () => {
    render(React.createElement(ChatLoadingSurface));

    const status = screen.getByRole("status", { name: frontendMessage("app.loading") });
    const track = status.querySelector("[data-chat-loading-surface] [data-conversation-skeleton]");
    expect(track).not.toBeNull();
    expect(track.querySelectorAll("[data-skeleton-row]").length).toBeGreaterThan(0);
  });
});
