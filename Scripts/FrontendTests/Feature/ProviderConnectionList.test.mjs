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
});

function createProps(overrides = {}) {
  return {
    providers: [{ Id: "openai", Enabled: true }],
    catalogs: {},
    errors: {},
    loadingProviderIds: {},
    selectedProviderId: "openai",
    disabled: false,
    onRequestAdd: vi.fn(),
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}
