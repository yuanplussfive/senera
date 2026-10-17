import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsSectionLoading } from "../../../Frontend/src/features/settings/SettingsLoading.tsx";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";

afterEach(cleanup);

describe("settings section loading surface", () => {
  it("keeps settings content geometry without falling back to a generic state view", () => {
    render(React.createElement(SettingsSectionLoading, { variant: "split" }));

    const status = screen.getByRole("status", { name: frontendMessage("settings.loading") });
    expect(status).toHaveAttribute("data-settings-section-loading");
    expect(status).toHaveAttribute("data-settings-section-loading-variant", "split");
    expect(status.querySelector("aside")).toBeInTheDocument();
    expect(status.querySelector("main")).toBeInTheDocument();
    expect(status.querySelector("[data-state-view]")).not.toBeInTheDocument();
  });
});
