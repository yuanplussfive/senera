import { describe, expect, it } from "vitest";
import {
  closeWorkspaceTab,
  createBlankWorkspaceTab,
  createInitialWorkspaceTabState,
  createWorkspaceTab,
  navigateWorkspaceTab,
  openWorkspaceTabInTabs,
  parseWorkspaceAddress,
  readWorkspaceTabAddress,
  readWorkspaceTabEntry,
  readWorkspaceTabLocator,
  stepWorkspaceTabHistory,
  syncWorkspaceTabPath,
  updateWorkspaceTabTitle,
} from "../../../Frontend/src/shared/workspace/WorkspaceTabs.ts";

describe("workspace tab address parsing", () => {
  it("keeps an empty address as a new tab target", () => {
    expect(parseWorkspaceAddress("  ")).toEqual({ kind: "blank" });
  });

  it("normalizes localhost and host:port entries into http URLs", () => {
    expect(parseWorkspaceAddress("localhost:3000")).toEqual({ kind: "web", url: "http://localhost:3000/" });
    expect(parseWorkspaceAddress("127.0.0.1:5173/app")).toEqual({
      kind: "web",
      url: "http://127.0.0.1:5173/app",
    });
  });

  it("accepts explicit http and https URLs", () => {
    expect(parseWorkspaceAddress("https://example.com/docs")).toEqual({
      kind: "web",
      url: "https://example.com/docs",
    });
  });

  it("treats relative paths as workspace files and keeps source positions", () => {
    expect(parseWorkspaceAddress("./src/App.tsx")).toEqual({
      kind: "workspace",
      locator: { path: "src/App.tsx" },
    });
    expect(parseWorkspaceAddress("src/App.tsx:12:4")).toEqual({
      kind: "workspace",
      locator: { path: "src/App.tsx", line: 12, column: 4 },
    });
  });

  it("rejects unsupported schemes and protocol-relative URLs", () => {
    expect(parseWorkspaceAddress("mailto:team@example.com")).toEqual({ kind: "invalid" });
    expect(parseWorkspaceAddress("//example.com")).toEqual({ kind: "invalid" });
  });
});

describe("workspace tab lifecycle", () => {
  it("starts with one blank tab", () => {
    const state = createInitialWorkspaceTabState("workspace-tab-1");
    expect(state.activeTabId).toBe("workspace-tab-1");
    expect(state.tabs).toHaveLength(1);
    expect(readWorkspaceTabEntry(state.tabs[0])).toEqual({ kind: "blank" });
  });

  it("focuses an existing resource instead of opening a duplicate tab", () => {
    const existing = createWorkspaceTab("tab-a", { path: "src/App.tsx" });
    const duplicate = createWorkspaceTab("tab-b", { path: "src/App.tsx" });
    const state = openWorkspaceTabInTabs([existing], "tab-a", duplicate);

    expect(state.tabs).toEqual([existing]);
    expect(state.activeTabId).toBe("tab-a");
  });

  it("reuses the active blank tab for the first opened resource", () => {
    const blank = createBlankWorkspaceTab("tab-1");
    const state = openWorkspaceTabInTabs([blank], "tab-1", createWorkspaceTab("tab-2", { path: "src/App.tsx" }));

    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe("tab-1");
    expect(readWorkspaceTabEntry(state.tabs[0]).kind).toBe("workspace");
  });

  it("keeps the blank tab when the opened resource already has a tab", () => {
    const blank = createBlankWorkspaceTab("tab-1");
    const existing = createWorkspaceTab("tab-2", { path: "src/App.tsx" });
    const state = openWorkspaceTabInTabs(
      [blank, existing],
      "tab-1",
      createWorkspaceTab("tab-3", { path: "src/App.tsx" }),
    );

    expect(state.tabs).toEqual([blank, existing]);
    expect(state.activeTabId).toBe("tab-2");
  });

  it("always appends a blank tab, even when another blank tab exists", () => {
    const existing = createBlankWorkspaceTab("tab-existing");
    const next = createBlankWorkspaceTab("tab-next");
    const state = openWorkspaceTabInTabs([existing], "tab-existing", next);

    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabId).toBe("tab-next");
  });

  it("turns the blank tab into the first navigation target and then pushes history", () => {
    const tab = createBlankWorkspaceTab("tab-1");
    const first = navigateWorkspaceTab(tab, { kind: "workspace", path: "src/App.tsx" });
    const second = navigateWorkspaceTab(first, { kind: "web", url: "http://localhost:3000/" });

    expect(first.history).toEqual([{ kind: "workspace", path: "src/App.tsx" }]);
    expect(first.historyIndex).toBe(0);
    expect(second.history).toHaveLength(2);
    expect(second.historyIndex).toBe(1);
    expect(readWorkspaceTabAddress(second)).toBe("http://localhost:3000/");
    expect(readWorkspaceTabLocator(second)).toBeUndefined();
  });

  it("steps backwards and forwards without leaving the history bounds", () => {
    const tab = navigateWorkspaceTab(
      navigateWorkspaceTab(createBlankWorkspaceTab("tab-1"), { kind: "workspace", path: "README.md" }),
      { kind: "web", url: "https://example.com/" },
    );

    expect(stepWorkspaceTabHistory(tab, -1).historyIndex).toBe(0);
    expect(stepWorkspaceTabHistory(tab, 1)).toBe(tab);
    expect(stepWorkspaceTabHistory(stepWorkspaceTabHistory(tab, -1), -1).historyIndex).toBe(0);
  });

  it("applies trimmed page titles and keeps the fallback for empty reports", () => {
    const tab = createBlankWorkspaceTab("tab-1");
    expect(updateWorkspaceTabTitle(tab, "   ")).toBe(tab);
    const titled = updateWorkspaceTabTitle(tab, "  Example page  ");
    expect(titled.title).toBe("Example page");
    expect(updateWorkspaceTabTitle(titled, "Example page")).toBe(titled);
  });

  it("ignores path syncs that match the current workspace entry", () => {
    const tab = createWorkspaceTab("tab-1", { path: "src/App.tsx" });
    expect(syncWorkspaceTabPath(tab, "src/App.tsx")).toBe(tab);
  });

  it("activates the neighboring tab when the active tab closes", () => {
    const tabs = [
      createBlankWorkspaceTab("tab-1"),
      createWorkspaceTab("tab-2", { path: "README.md" }),
      createWorkspaceTab("tab-3", { path: "src/App.tsx" }),
    ];
    expect(closeWorkspaceTab(tabs, "tab-2", "tab-2").activeTabId).toBe("tab-3");
    expect(closeWorkspaceTab(tabs, "tab-2", "tab-1").activeTabId).toBe("tab-2");
    expect(closeWorkspaceTab(tabs, "tab-1", "tab-3").activeTabId).toBe("tab-1");
  });

  it("reports an empty tab list when the last tab closes", () => {
    expect(closeWorkspaceTab([createBlankWorkspaceTab("tab-1")], "tab-1", "tab-1")).toEqual({
      tabs: [],
      activeTabId: "",
    });
  });
});
