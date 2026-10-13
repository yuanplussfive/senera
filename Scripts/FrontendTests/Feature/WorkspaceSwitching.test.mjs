import React from "react";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useWorkspaceController } from "../../../Frontend/src/app/useWorkspaceController.ts";
import { WorkspaceFileTree } from "../../../Frontend/src/shared/workspace/WorkspaceFileTree.tsx";
import { buildResourceUploadUrl, buildResourceContentUrl } from "../../../Frontend/src/api/uploadClient.ts";
import { buildWorkspaceResourceUrl } from "../../../Frontend/src/api/workspaceResourceClient.ts";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { useStore } from "../../../Frontend/src/store/sessionStore.ts";
import { activateWorkspaceSessionProjection } from "../../../Frontend/src/store/workspaceSessionProjection.ts";
import { useComposerDraft } from "../../../Frontend/src/features/chat/useComposerDraft.ts";

test("text drafts persist per workspace and session and observe updates from another window", () => {
  const aKey = JSON.stringify(["draft-a", "session-a"]);
  const bKey = JSON.stringify(["draft-b", "session-a"]);
  const hook = renderHook(({ draftKey }) => useComposerDraft(draftKey), { initialProps: { draftKey: aKey } });
  act(() => hook.result.current[1]("A 的草稿"));
  hook.rerender({ draftKey: bKey });
  expect(hook.result.current[0]).toBe("");
  act(() => hook.result.current[1]("B 的草稿"));
  hook.rerender({ draftKey: JSON.stringify(["draft-a", "session-b"]) });
  expect(hook.result.current[0]).toBe("");
  hook.unmount();
  const restored = renderHook(() => useComposerDraft(aKey));
  expect(restored.result.current[0]).toBe("A 的草稿");
  act(() => {
    localStorage.setItem(`senera-composer:${aKey}`, "另一窗口的修改");
    window.dispatchEvent(new Event("storage"));
  });
  expect(restored.result.current[0]).toBe("另一窗口的修改");
  act(() => restored.result.current[1](""));
  expect(localStorage.getItem(`senera-composer:${aKey}`)).toBeNull();
  localStorage.removeItem(`senera-composer:${bKey}`);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const snapshot = {
  workspaceId: "workspace-a",
  workspaceRoot: "E:/a",
  configPath: "E:/application/config.json",
  websocketUrl: "ws://server/",
  workspaces: [],
  capabilities: { browseDirectories: true },
};
function controller(status = "open") {
  const send = vi.fn(() => true),
    onReady = vi.fn();
  const sendRef = { current: send },
    statusRef = { current: status };
  const hook = renderHook(
    ({ status }) => useWorkspaceController({ sendRef, statusRef, status, onWorkspaceReady: onReady }),
    { initialProps: { status } },
  );
  return { ...hook, send, onReady, statusRef };
}
test("workspace opening accepts only its correlated result, ignoring stale snapshots", () => {
  const hook = controller();
  act(() => hook.result.current.switchWorkspace("E:/b"));
  const request = hook.send.mock.calls.at(-1)[0];
  act(() => {
    hook.result.current.ingestWorkspaceEvent({ kind: EventKinds.WorkspaceSnapshot, data: snapshot });
    hook.result.current.ingestWorkspaceEvent({
      kind: EventKinds.WorkspaceSwitched,
      data: { ...snapshot, requestId: "stale" },
    });
  });
  expect(hook.result.current.phase).toBe("switching");
  expect(hook.onReady).not.toHaveBeenCalled();
  act(() =>
    hook.result.current.ingestWorkspaceEvent({
      kind: EventKinds.WorkspaceSwitched,
      data: { ...snapshot, requestId: request.requestId },
    }),
  );
  expect(hook.result.current.phase).toBe("succeeded");
  expect(hook.onReady).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-a" }), true);
});
test("reconnection reissues the same idempotent opening request without guessing success", () => {
  const hook = controller();
  act(() => hook.result.current.switchWorkspace("E:/b"));
  const request = hook.send.mock.calls.at(-1)[0];
  hook.statusRef.current = "closed";
  hook.rerender({ status: "closed" });
  hook.statusRef.current = "open";
  hook.rerender({ status: "open" });
  expect(hook.send.mock.calls.at(-1)[0]).toEqual(request);
  expect(hook.result.current.phase).toBe("switching");
});
test("a failed opening releases the request slot while retaining the current workspace", () => {
  const hook = controller();
  act(() => hook.result.current.ingestWorkspaceEvent({ kind: EventKinds.WorkspaceSnapshot, data: snapshot }));
  act(() => hook.result.current.switchWorkspace("E:/b"));
  const request = hook.send.mock.calls.at(-1)[0];
  act(() =>
    hook.result.current.ingestWorkspaceEvent({
      kind: EventKinds.WorkspaceSwitchFailed,
      data: { requestId: request.requestId, workspaceRoot: "E:/b", message: "Access denied" },
    }),
  );
  expect(hook.result.current.snapshot.workspaceId).toBe("workspace-a");
  expect(hook.result.current.error.message).toBe("Access denied");
  act(() => expect(hook.result.current.switchWorkspace("E:/c")).toBe(true));
});

test("a disconnected workspace never treats an unsent switch as accepted", () => {
  const hook = controller("closed");
  act(() => expect(hook.result.current.switchWorkspace("E:/b")).toBe(false));
  expect(hook.result.current.connected).toBe(false);
  expect(hook.result.current.phase).toBe("failed");
  expect(hook.result.current.error).toBeTruthy();
  expect(hook.send).not.toHaveBeenCalled();
});

test("switching restores workspace session projections and their model selections independently", () => {
  activateWorkspaceSessionProjection("projection-a");
  useStore.setState({
    activeSessionId: "session-a",
    selectedModelProviderId: "model-a",
    selectedThinkingLevel: "high",
  });
  activateWorkspaceSessionProjection("projection-b");
  useStore.setState({ activeSessionId: "session-b", selectedModelProviderId: "model-b", selectedThinkingLevel: "low" });
  activateWorkspaceSessionProjection("projection-a");
  expect(useStore.getState()).toMatchObject({
    activeSessionId: "session-a",
    selectedModelProviderId: "model-a",
    selectedThinkingLevel: "high",
  });
  activateWorkspaceSessionProjection("projection-b");
  expect(useStore.getState()).toMatchObject({
    activeSessionId: "session-b",
    selectedModelProviderId: "model-b",
    selectedThinkingLevel: "low",
  });
  useStore.setState(useStore.getInitialState());
});
test("uploads and previews carry workspace scope and drop unrelated base queries", () => {
  const base = "http://server/?workspaceId=workspace-b&secret=remove";
  for (const value of [
    buildResourceUploadUrl(base),
    buildWorkspaceResourceUrl(base, "src/file.ts"),
    buildResourceContentUrl(base, "senera://resource/example"),
  ]) {
    const url = new URL(value);
    expect(url.searchParams.get("workspaceId")).toBe("workspace-b");
    expect(url.searchParams.has("secret")).toBe(false);
  }
});
test("file tree loads folders on expansion and searches unopened directories", async () => {
  class EventSourceFake {
    close() {}
  }
  vi.stubGlobal("EventSource", EventSourceFake);
  const fetchMock = vi.fn(async (value) => {
    const url = new URL(value);
    const entries = url.searchParams.has("query")
      ? [{ name: "weather.ts", path: "deep/weather.ts", kind: "file" }]
      : url.searchParams.get("path") === "src"
        ? [{ name: "sample.ts", path: "src/sample.ts", kind: "text" }]
        : [{ name: "src", path: "src", kind: "directory" }];
    return new Response(JSON.stringify({ ok: true, path: ".", entries }), {
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const select = vi.fn();
  const { container, getByPlaceholderText, rerender } = render(
    React.createElement(WorkspaceFileTree, { httpBaseUrl: "http://server/?workspaceId=b", onSelect: select }),
  );
  const user = (await import("@testing-library/user-event")).default.setup();
  const findTreeItem = async (path, search = false) => {
    let item;
    await waitFor(() => {
      const root = container.querySelectorAll("file-tree-container")[search ? 1 : 0].shadowRoot;
      item = root?.querySelector(`[role="treeitem"][data-item-path="${path}"]`);
      expect(item).toBeTruthy();
    });
    return item;
  };
  await user.click(await findTreeItem("src/"));
  await user.click(await findTreeItem("src/sample.ts"));
  expect(select).toHaveBeenCalledWith("src/sample.ts");
  rerender(
    React.createElement(WorkspaceFileTree, {
      httpBaseUrl: "http://server/?workspaceId=b",
      onSelect: select,
      activePath: "src/sample.ts",
    }),
  );
  await user.click(await findTreeItem("src/sample.ts"));
  expect(select).toHaveBeenCalledTimes(2);
  await user.type(getByPlaceholderText("搜索当前工作区文件"), "weather");
  await user.click(await findTreeItem("deep/weather.ts", true));
  expect(select).toHaveBeenCalledWith("deep/weather.ts");
});
