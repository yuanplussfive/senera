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

function ConfigDraftHarness({ handleRef, onSave, operation, snapshot }) {
  handleRef.current = useConfigSettingsDraftState({
    operation,
    snapshot,
    onRefresh: vi.fn(),
    onSave,
  });
  return null;
}

function createSnapshot() {
  return {
    path: "test",
    version: 1,
    revision: 1,
    value: {},
    source: "json",
    diagnostics: [],
    form: { version: 1, sections: [] },
  };
}
