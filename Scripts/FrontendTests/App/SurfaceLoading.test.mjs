import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationSurfaceLoading, SettingsSurfaceLoading } from "../../../Frontend/src/app/SurfaceLoading.tsx";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";

afterEach(cleanup);

describe("application loading surfaces", () => {
  it("announces application loading while reserving the app shell geometry", () => {
    render(React.createElement(ApplicationSurfaceLoading));

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveClass("app-loading-shell", "h-dvh", "w-screen");
    expect(status).toHaveAttribute("data-application-loading");
    expect(status).toHaveTextContent(frontendMessage("app.loading"));
    expect(status.querySelector("[data-application-loading-sidebar]")).toHaveClass("w-[266px]", "min-[1024px]:flex");
    expect(status.querySelector("[data-application-loading-main]")).toBeInTheDocument();
    expect(status.querySelector("[data-application-loading-content]")).toBeInTheDocument();
    expect(status.querySelector("[data-application-loading-composer]")).toBeInTheDocument();
    expect(status.querySelector("[data-application-loading-workflow]")).toHaveClass("w-10", "min-[1024px]:flex");
    expect(status.querySelector("[data-workflow-dock-loading]")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Senera" })).toBeInTheDocument();
  });

  it("matches the desktop settings navigation and header geometry", () => {
    render(React.createElement(SettingsSurfaceLoading, { presentation: "desktop" }));

    const status = screen.getByRole("status", { name: frontendMessage("settings.loading") });
    expect(status).toHaveAttribute("data-settings-loading-presentation", "desktop");
    expect(status).toHaveClass("settings-loading-shell");
    expect(status.parentElement).toHaveClass("h-dvh", "min-h-[320px]");
    expect(status.querySelector("aside")).toHaveClass("w-[224px]");
    expect(status.querySelector("aside > div")).toHaveClass("h-[60px]");
    expect(status.querySelector('[data-settings-loading-header="compact"]')).toHaveClass(
      "h-[var(--senera-top-chrome-height)]",
    );
    expect(status.querySelector('[data-settings-loading-header="persistent"]')).toHaveClass("border-b", "sm:py-5");
    expect(status.querySelector('[data-settings-loading-header="persistent"] .h-6')).toBeInTheDocument();
    expect(status.querySelector(".senera-spinner")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: frontendMessage("settings.header.title") })).toBeInTheDocument();
  });

  it("reserves a responsive overlay surface instead of rendering a blank fallback", () => {
    render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement("button", { type: "button" }, "Underlying action"),
        React.createElement(SettingsSurfaceLoading, { presentation: "overlay" }),
      ),
    );

    const status = screen.getByRole("status", { name: frontendMessage("settings.loading") });
    const overlay = screen.getByRole("dialog", { name: frontendMessage("settings.loading") });
    expect(status).toHaveAttribute("data-settings-loading-presentation", "overlay");
    expect(status.parentElement).toHaveClass("max-h-[calc(100dvh-48px)]", "max-sm:h-dvh", "max-sm:w-screen");
    expect(status).toHaveClass("max-sm:rounded-none", "max-sm:border-0");
    expect(overlay).toHaveClass("fixed", "inset-0", "max-sm:p-0");
    expect(overlay).toHaveAttribute("aria-modal", "true");
    expect(overlay).toHaveAttribute("aria-busy", "true");
    expect(overlay).toHaveAttribute("tabindex", "-1");
    expect(overlay).toHaveAttribute("data-settings-loading-overlay");
    expect(document.querySelector("button")).toHaveProperty("inert", true);
    expect(document.activeElement).toBe(overlay);
  });
});
