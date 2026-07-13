import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ProviderModelLifecycleDialogs } from "../../../Frontend/src/features/settings/sections/ProviderModelLifecycleDialogs.tsx";

const openAi = { Id: "openai", Enabled: true };
const anthropic = { Id: "anthropic", Enabled: true };
const gpt = { Id: "openai:gpt-4.1", ProviderId: "openai", Model: "gpt-4.1" };
const embedding = { Id: "openai:text-embedding-3", ProviderId: "openai", Model: "text-embedding-3" };
const sonnet = { Id: "anthropic:sonnet", ProviderId: "anthropic", Model: "claude-sonnet" };

afterEach(() => cleanup());

function renderLifecycle(overrides = {}) {
  const onConfirmModelRemoval = vi.fn(() => true);
  const onConfirmProviderRemoval = vi.fn(() => true);
  render(
    React.createElement(ProviderModelLifecycleDialogs, {
      candidateModels: [
        { model: gpt, provider: openAi },
        { model: sonnet, provider: anthropic },
      ],
      defaultModelId: gpt.Id,
      disabled: false,
      modelToRemove: null,
      models: [gpt, embedding, sonnet],
      providerToRemove: null,
      onCloseModelRemoval: vi.fn(),
      onCloseProviderRemoval: vi.fn(),
      onConfirmModelRemoval,
      onConfirmProviderRemoval,
      ...overrides,
    }),
  );
  return { onConfirmModelRemoval, onConfirmProviderRemoval };
}

test("default-model removal requires an explicit replacement and sends one atomic command", () => {
  const { onConfirmModelRemoval } = renderLifecycle({ modelToRemove: gpt });

  const confirm = screen.getByRole("button", { name: "替换默认并移除" });
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByLabelText("新的默认助手模型"), {
    target: { value: sonnet.Id },
  });
  fireEvent.click(confirm);

  expect(onConfirmModelRemoval).toHaveBeenCalledWith({
    modelId: gpt.Id,
    replacementDefaultModelId: sonnet.Id,
  });
});

test("provider removal presents every associated model and confirms a visible cascade", () => {
  const { onConfirmProviderRemoval } = renderLifecycle({ providerToRemove: openAi });

  expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
  expect(screen.getByText("text-embedding-3")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("新的默认助手模型"), {
    target: { value: sonnet.Id },
  });
  fireEvent.click(screen.getByRole("button", { name: "替换默认并删除供应商" }));

  expect(onConfirmProviderRemoval).toHaveBeenCalledWith({
    providerId: openAi.Id,
    cascadeModels: true,
    replacementDefaultModelId: sonnet.Id,
  });
});
