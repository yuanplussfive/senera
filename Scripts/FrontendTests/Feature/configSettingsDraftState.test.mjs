import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useConfigSettingsDraftState } from "../../../Frontend/src/features/settings/sections/configSettingsDraftState.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("discards a stale configuration save error and continues with the newer draft", async () => {
  const onSave = vi.fn((config) => (config.mode === "first" ? "save-first" : "save-second"));
  const handleRef = { current: null };
  const snapshot = createSnapshot();
  const view = render(React.createElement(ConfigDraftHarness, { handleRef, onSave, operation: null, snapshot }));

  await act(async () => {
    handleRef.current.updateDraft({ mode: "first" }, "immediate");
  });
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ mode: "first" }));

  await act(async () => {
    handleRef.current.updateDraft({ mode: "second" }, "immediate");
  });
  view.rerender(
    React.createElement(ConfigDraftHarness, {
      handleRef,
      onSave,
      operation: { commandId: "save-first", kind: "config_update", status: "error", message: "obsolete write failed" },
      snapshot,
    }),
  );

  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ mode: "second" }));
  expect(handleRef.current.localError).toBeNull();
  expect(handleRef.current.draft).toEqual({ mode: "second" });
});

test("reconciles a saved secret against the redacted snapshot without looping", async () => {
  const onSave = vi.fn(() => "save-secret");
  const handleRef = { current: null };
  const snapshot = createSnapshot({ value: { ApiKey: "__senera_redacted_secret__" } });
  const view = render(React.createElement(ConfigDraftHarness, { handleRef, onSave, operation: null, snapshot }));

  await act(async () => {
    handleRef.current.updateDraft({ ApiKey: "sk-real-key" }, "immediate");
  });
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ ApiKey: "sk-real-key" }));

  view.rerender(
    React.createElement(ConfigDraftHarness, {
      handleRef,
      onSave,
      operation: { commandId: "save-secret", kind: "config_update", status: "success" },
      snapshot,
    }),
  );

  await waitFor(() => {
    expect(handleRef.current.dirty).toBe(false);
    expect(handleRef.current.draft).toEqual({ ApiKey: "__senera_redacted_secret__" });
  });
  expect(onSave).toHaveBeenCalledTimes(1);
});

test("detects a newly typed secret as a real edit", async () => {
  const onSave = vi.fn(() => "save-secret");
  const handleRef = { current: null };
  const snapshot = createSnapshot({ value: { ApiKey: "__senera_redacted_secret__" } });
  render(React.createElement(ConfigDraftHarness, { handleRef, onSave, operation: null, snapshot }));

  await act(async () => {
    handleRef.current.updateDraft({ ApiKey: "sk-new-key" }, "immediate");
  });

  expect(handleRef.current.dirty).toBe(true);
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ ApiKey: "sk-new-key" }));
});

test("treats clearing a secret as a real edit", async () => {
  const onSave = vi.fn(() => "save-clear");
  const handleRef = { current: null };
  const snapshot = createSnapshot({ value: { ApiKey: "__senera_redacted_secret__" } });
  render(React.createElement(ConfigDraftHarness, { handleRef, onSave, operation: null, snapshot }));

  await act(async () => {
    handleRef.current.updateDraft({ ApiKey: "" }, "immediate");
  });

  expect(handleRef.current.dirty).toBe(true);
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ ApiKey: "" }));
});

function ConfigDraftHarness({ handleRef, onSave, operation, snapshot }) {
  handleRef.current = useConfigSettingsDraftState({
    operation,
    snapshot,
    onRefresh: vi.fn(),
    onSave,
  });
  return null;
}

function createSnapshot({ value = {} } = {}) {
  return {
    path: "test",
    version: 1,
    revision: 1,
    value,
    source: "json",
    diagnostics: [],
    form: { version: 1, sections: [] },
  };
}
