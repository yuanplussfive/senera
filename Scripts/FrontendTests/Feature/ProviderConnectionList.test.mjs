import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ProviderConnectionList } from "../../../Frontend/src/features/settings/sections/ProviderConnectionList.tsx";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import { TooltipProvider } from "../../../Frontend/src/shared/ui/index.ts";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("compact provider navigation combines accurate search and add controls in one toolbar", async () => {
  const onRequestAdd = vi.fn();
  const user = userEvent.setup();
  const props = createProps({ compact: true, onRequestAdd });
  const renderList = (listProps) =>
    React.createElement(TooltipProvider, { delayDuration: 0 }, React.createElement(ProviderConnectionList, listProps));
  const view = renderWithFrontendProviders(renderList(props));

  const toolbar = document.querySelector('[data-provider-list-toolbar="compact"]');
  const search = screen.getByRole("textbox", { name: frontendMessage("settings.provider.searchPlaceholder") });
  const add = screen.getByRole("button", { name: frontendMessage("settings.provider.add") });
  expect(toolbar).toContainElement(search);
  expect(toolbar).toContainElement(add);
  expect(screen.queryByText(frontendMessage("settings.model.serviceTitle"))).not.toBeInTheDocument();

  await user.click(add);
  expect(onRequestAdd).toHaveBeenCalledTimes(1);

  view.rerender(renderList({ ...props, compact: false }));
  expect(screen.getByText(frontendMessage("settings.model.serviceTitle"))).toBeInTheDocument();
  expect(
    screen.getByRole("textbox", { name: frontendMessage("settings.provider.searchPlaceholder") }),
  ).toBeInTheDocument();
  expect(document.querySelector("[data-settings-state]")).toBeNull();
});

test("provider list reports availability without an inline toggle", () => {
  renderWithFrontendProviders(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(
        ProviderConnectionList,
        createProps({
          providers: [
            { Id: "openai", Enabled: true },
            { Id: "anthropic", Enabled: false },
          ],
          selectedProviderId: null,
        }),
      ),
    ),
  );

  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  for (const [provider, stateKey] of [
    ["openai", "settings.provider.enabled"],
    ["anthropic", "settings.provider.disabled"],
  ]) {
    expect(
      screen.getByRole("button", {
        name: frontendMessage("settings.provider.rowAria", {
          provider,
          state: frontendMessage(stateKey),
          selected: "",
        }),
      }),
    ).toBeInTheDocument();
  }
});

test("provider hosting the default model shows a default tag and keeps the whole row selectable", async () => {
  const user = userEvent.setup();
  const reason = "该供应商提供当前默认模型，无法关闭";
  const provider = { Id: "openai", Enabled: true };
  const onSelect = vi.fn();
  renderWithFrontendProviders(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(
        ProviderConnectionList,
        createProps({ providers: [provider], providerDisableReason: () => reason, onSelect }),
      ),
    ),
  );

  const tag = screen.getByLabelText(`${frontendMessage("config.model.defaultBadge")} · ${reason}`);
  expect(tag).toHaveTextContent(frontendMessage("config.model.defaultBadge"));

  await user.click(tag);
  expect(onSelect).toHaveBeenCalledWith(provider);
});

test("provider search keeps an explicit empty state when no provider matches", async () => {
  const user = userEvent.setup();
  const props = createProps();
  renderWithFrontendProviders(
    React.createElement(TooltipProvider, { delayDuration: 0 }, React.createElement(ProviderConnectionList, props)),
  );

  await user.type(
    screen.getByRole("textbox", { name: frontendMessage("settings.provider.searchPlaceholder") }),
    "does-not-exist",
  );

  expect(screen.getByText(frontendMessage("settings.provider.searchEmpty"))).toBeInTheDocument();
});

test("provider list keeps the provider hosting the default model at the top", () => {
  renderWithFrontendProviders(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(
        ProviderConnectionList,
        createProps({
          providers: [
            { Id: "openai", Enabled: true },
            { Id: "anthropic", Enabled: true },
            { Id: "deepseek", Enabled: true },
          ],
          selectedProviderId: "openai",
          defaultModelProviderId: "deepseek",
        }),
      ),
    ),
  );

  const rowNames = Array.from(document.querySelectorAll("button[aria-pressed]")).map((row) => row.textContent);
  expect(rowNames).toEqual(["deepseek", "anthropic", "openai"]);
});

function createProps(overrides = {}) {
  return {
    providers: [{ Id: "openai", Enabled: true }],
    selectedProviderId: "openai",
    defaultModelProviderId: null,
    disabled: false,
    onRequestAdd: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  };
}
