import { describe, expect, it } from "vitest";
import { resolveGlobalShortcut } from "./useGlobalShortcuts";

function shortcutTarget(attributes: { isContentEditable?: boolean; tagName: string }): EventTarget {
  return attributes as unknown as EventTarget;
}

describe("resolveGlobalShortcut", () => {
  it("ignores global shortcuts from editable targets", () => {
    const textarea = shortcutTarget({ tagName: "TEXTAREA" });
    const input = shortcutTarget({ tagName: "INPUT" });
    const editable = shortcutTarget({ tagName: "DIV", isContentEditable: true });

    expect(resolveGlobalShortcut({ ctrlKey: true, metaKey: false, key: "b", target: textarea })).toBeNull();
    expect(resolveGlobalShortcut({ ctrlKey: true, metaKey: false, key: "n", target: input })).toBeNull();
    expect(resolveGlobalShortcut({ ctrlKey: false, metaKey: true, key: "b", target: editable })).toBeNull();
  });

  it("keeps resolving shortcuts outside editable targets", () => {
    expect(resolveGlobalShortcut({
      ctrlKey: true,
      metaKey: false,
      key: "b",
      target: shortcutTarget({ tagName: "BUTTON" }),
    })).toBe("toggle_session_panel");
    expect(resolveGlobalShortcut({
      ctrlKey: false,
      metaKey: true,
      key: "n",
      target: shortcutTarget({ tagName: "BODY" }),
    })).toBe("new_session");
  });
});
