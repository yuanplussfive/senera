import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationSurfaceLoading, SettingsSurfaceLoading } from "../../../Frontend/src/app/SurfaceLoading.tsx";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";

afterEach(cleanup);

describe("application loading surfaces", () => {
  it("announces application loading without changing the viewport geometry", () => {
    render(React.createElement(ApplicationSurfaceLoading));

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveClass("min-h-screen");
    expect(status).toHaveTextContent(frontendMessage("app.loading"));
    expect(screen.getByRole("heading", { name: "Senera" })).toBeInTheDocument();
  });

  it("matches the desktop settings navigation and header geometry", () => {
    render(React.createElement(SettingsSurfaceLoading, { presentation: "desktop" }));

    const status = screen.getByRole("status", { name: frontendMessage("settings.loading") });
    expect(status).toHaveAttribute("data-settings-loading-presentation", "desktop");
    expect(status.parentElement).toHaveClass("h-dvh", "min-h-[320px]");
    expect(status.querySelector("aside")).toHaveClass("w-[220px]");
    expect(status.querySelector("main > header")).toHaveClass("h-[58px]");
    expect(screen.getByRole("heading", { name: frontendMessage("settings.header.title") })).toBeInTheDocument();
  });

  it("reserves a responsive overlay surface instead of rendering a blank fallback", () => {
    render(React.createElement(SettingsSurfaceLoading, { presentation: "overlay" }));

    const status = screen.getByRole("status", { name: frontendMessage("settings.loading") });
    const overlay = status.parentElement?.parentElement;
    expect(status).toHaveAttribute("data-settings-loading-presentation", "overlay");
    expect(status.parentElement).toHaveClass("min-h-[320px]", "max-sm:h-dvh", "max-sm:w-screen");
    expect(overlay).toHaveClass("fixed", "inset-0", "max-sm:p-0");
  });
});
