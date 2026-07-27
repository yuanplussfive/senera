import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";
import { clearTestToastCalls, readTestToastCalls } from "../mocks/sonner.mjs";
import {
  ConfigMutationHarness,
  configMutationEvent as event,
  createConfigSnapshot,
} from "./configMutationTestHarness.mjs";

beforeEach(() => {
  installMemoryLocalStorage();
  clearTestToastCalls();
  resetFrontendStore();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("system config queue coalesces unsent provider patches by provider id", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  render(
    React.createElement(ConfigMutationHarness, {
      configSnapshot: createConfigSnapshot(),
      send,
      status: "open",
      handleRef,
    }),
  );

  let activeCommandId;
  let firstPatchCommandId;
  let latestPatchCommandId;
  await act(async () => {
    activeCommandId = handleRef.current.setDefaultProviderModel("gpt");
    firstPatchCommandId = handleRef.current.upsertProviderEndpoint({
      Id: "custom",
      BaseUrl: "https://first.example.test/v1",
    });
    latestPatchCommandId = handleRef.current.upsertProviderEndpoint({
      Id: "custom",
      BaseUrl: "https://latest.example.test/v1",
    });
  });

  expect(firstPatchCommandId).toBe(latestPatchCommandId);
  expect(send).toHaveBeenCalledTimes(1);

  await act(async () => {
    handleRef.current.ingestConfigMutationEvent(
      event(EventKinds.ConfigSnapshot, "config", {
        ...createConfigSnapshot({ revision: 5 }),
        operation: { commandId: activeCommandId, kind: "provider.defaultModel.set" },
      }),
    );
  });

  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0]).toEqual({
    type: "provider.endpoint.upsert",
    commandId: latestPatchCommandId,
    endpoint: {
      Id: "custom",
      BaseUrl: "https://latest.example.test/v1",
    },
  });
});

test("system config queue replays the exact active SQLite command and preserves queued work after reconnect", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  const view = render(
    React.createElement(ConfigMutationHarness, {
      configSnapshot: createConfigSnapshot(),
      send,
      status: "open",
      handleRef,
    }),
  );

  await act(async () => {
    handleRef.current.saveConfig({ AgentLoop: { MaxSteps: 12 } });
    handleRef.current.deleteProviderModel({ modelId: "queued" });
  });
  expect(send).toHaveBeenCalledTimes(1);
  const firstRequest = send.mock.calls[0][0];
  expect(firstRequest).toMatchObject({ type: "config.update", baseRevision: 4 });

  await act(async () => {
    view.rerender(
      React.createElement(ConfigMutationHarness, {
        configSnapshot: createConfigSnapshot({ revision: 9 }),
        send,
        status: "idle",
        handleRef,
      }),
    );
  });

  expect(handleRef.current.configOperation).toMatchObject({ status: "pending" });
  expect(handleRef.current.providerModelOperations.queued).toMatchObject({ status: "pending" });
  expect(readTestToastCalls()).not.toContainEqual(
    expect.objectContaining({ title: frontendMessage("config.mainDisconnected") }),
  );

  await act(async () => {
    view.rerender(
      React.createElement(ConfigMutationHarness, {
        configSnapshot: createConfigSnapshot({ revision: 9 }),
        send,
        status: "open",
        handleRef,
      }),
    );
  });

  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0]).toEqual(firstRequest);

  await act(async () => {
    handleRef.current.ingestConfigMutationEvent(
      event(EventKinds.ConfigSnapshot, "config", {
        ...createConfigSnapshot({ revision: 9 }),
        operation: { commandId: firstRequest.commandId, kind: "config_update" },
      }),
    );
  });

  expect(send).toHaveBeenCalledTimes(3);
  expect(send.mock.calls[2][0]).toMatchObject({ type: "provider.model.delete", modelId: "queued" });
  expect(handleRef.current.configOperation).toMatchObject({ status: "success" });
});

test("system config queue does not replay an active JSON command without a durable receipt", async () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  const jsonSnapshot = createConfigSnapshot({ source: "json", revision: undefined, version: 7 });
  const view = render(
    React.createElement(ConfigMutationHarness, {
      configSnapshot: jsonSnapshot,
      send,
      status: "open",
      handleRef,
    }),
  );

  await act(async () => {
    handleRef.current.deleteProviderModel({ modelId: "legacy" });
  });
  expect(send).toHaveBeenCalledTimes(1);

  await act(async () => {
    view.rerender(
      React.createElement(ConfigMutationHarness, {
        configSnapshot: jsonSnapshot,
        send,
        status: "idle",
        handleRef,
      }),
    );
  });

  expect(handleRef.current.providerModelOperations.legacy).toMatchObject({ status: "error" });
  expect(readTestToastCalls()).toContainEqual(
    expect.objectContaining({ title: frontendMessage("config.mainDisconnected") }),
  );

  await act(async () => {
    view.rerender(
      React.createElement(ConfigMutationHarness, {
        configSnapshot: jsonSnapshot,
        send,
        status: "open",
        handleRef,
      }),
    );
  });
  expect(send).toHaveBeenCalledTimes(1);
});
