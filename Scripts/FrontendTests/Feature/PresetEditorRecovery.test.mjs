import React, {
  Suspense,
  lazy,
  useState,
} from "react";
import {
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  PresetEditorFailureBoundary,
  PresetTextEditorFallback,
} from "../../../Frontend/src/features/chat/PresetWorkspace.tsx";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

const LazyCrashingEditor = lazy(async () => ({
  default: function CrashingEditor() {
    const error = new Error("editor render failed");
    error._suppressLogging = true;
    throw error;
  },
}));

function RecoveryHarness() {
  const [content, setContent] = useState("draft preset");
  return React.createElement(
    PresetEditorFailureBoundary,
    {
      fallback: React.createElement(PresetTextEditorFallback, {
        content,
        disabled: false,
        onChange: setContent,
      }),
    },
    React.createElement(
      Suspense,
      { fallback: React.createElement("span", null, "loading") },
      React.createElement(LazyCrashingEditor),
    ),
  );
}

afterEach(() => {
  cleanup();
});

describe("PresetEditorFailureBoundary", () => {
  it("keeps the draft editable after a lazy editor fails to render", async () => {
    const user = userEvent.setup();
    const suppressExpectedError = (event) => {
      if (event.error?.message === "editor render failed") {
        event.preventDefault();
      }
    };
    window.addEventListener("error", suppressExpectedError);

    try {
      render(React.createElement(RecoveryHarness));

      const editor = await screen.findByRole("textbox", { name: "角色预设内容" });
      expect(screen.getByRole("alert")).toHaveTextContent("基础文本编辑器");
      expect(editor).toHaveValue("draft preset");

      await user.clear(editor);
      await user.type(editor, "recovered draft");
      expect(editor).toHaveValue("recovered draft");
    } finally {
      window.removeEventListener("error", suppressExpectedError);
    }
  });

  it("keeps the fallback editor disabled when preset mutations are busy", () => {
    render(React.createElement(PresetTextEditorFallback, {
      content: "locked draft",
      disabled: true,
      onChange: () => undefined,
    }));

    expect(screen.getByRole("textbox", { name: "角色预设内容" })).toBeDisabled();
  });
});
