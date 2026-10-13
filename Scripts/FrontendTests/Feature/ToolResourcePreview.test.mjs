import React from "react";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const { ToolResourcePreview } = await import("../../../Frontend/src/features/workflow/ToolResourcePreview.tsx");
const { ToolWorkspaceChangePreview } =
  await import("../../../Frontend/src/features/workflow/ToolWorkspaceChangePreview.tsx");
const { ToolArtifactPreview } = await import("../../../Frontend/src/features/workflow/ToolArtifactPreview.tsx");
const { ToolRunOutputSummary } = await import("../../../Frontend/src/features/workflow/ToolRunOutputSummary.tsx");
const { collectToolResources, collectToolWorkspaceChanges, collectToolWorkspaceObservation } =
  await import("../../../Frontend/src/features/workflow/toolResourceProjection.ts");
const { mergeToolResultPresentation } = await import("../../../Frontend/src/store/session/toolResultPresentation.ts");
const { WorkspaceResourceProvider } =
  await import("../../../Frontend/src/shared/workspace/WorkspaceResourceProvider.tsx");
const { toast } = await import("sonner");
const { frontendMessage } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");

const resourceId = "res_0123456789abcdef0123456789abcdef";
const resourceIds = [
  resourceId,
  "res_abcdef0123456789abcdef0123456789",
  "res_11111111111111111111111111111111",
  "res_22222222222222222222222222222222",
  "res_33333333333333333333333333333333",
  "res_44444444444444444444444444444444",
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("keeps media resources compact, opens them explicitly, and previews documents only on hover", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => "const answer = 42;",
  });
  vi.stubGlobal("fetch", fetchMock);

  const view = renderResources([
    resource("image.png", "image/png", undefined, resourceIds[0]),
    resource("sound.mp3", "audio/mpeg", undefined, resourceIds[1]),
    resource("movie.mp4", "video/mp4", undefined, resourceIds[2]),
    resource("report.pdf", "application/pdf", undefined, resourceIds[3]),
    resource("answer.ts", "text/plain", undefined, resourceIds[4]),
    resource("archive.zip", "application/zip", undefined, resourceIds[5]),
  ]);

  expect(view.container.querySelectorAll("[data-tool-resource]")).toHaveLength(6);
  expect(view.container.querySelector("[data-resource-hover-preview]")).toBeNull();
  expect(document.body.querySelector("[data-resource-hover-preview]")).toBeNull();
  expect(document.body.querySelector("img, audio, video, iframe")).toBeNull();
  expect(view.container.querySelector('[data-resource-kind="file"]')).not.toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();

  for (const id of resourceIds.slice(0, 3)) {
    fireEvent.pointerEnter(view.container.querySelector(`[data-tool-resource="senera://resource/${id}"]`));
    expect(document.body.querySelector("[data-resource-hover-preview]")).toBeNull();
  }
  expect(document.body.querySelector("img, audio, video")).toBeNull();
  for (const id of resourceIds.slice(1, 3)) {
    const link = view.container.querySelector(`[data-tool-resource="senera://resource/${id}"] a`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("href")).toContain(`/resources/${id}`);
  }

  fireEvent.pointerEnter(view.container.querySelector(`[data-tool-resource="senera://resource/${resourceIds[3]}"]`));
  await waitFor(() => expect(document.body.querySelector('[data-resource-preview-kind="pdf"] iframe')).not.toBeNull());
  fireEvent.pointerLeave(view.container.querySelector(`[data-tool-resource="senera://resource/${resourceIds[3]}"]`));
  await waitFor(() => expect(document.body.querySelector("[data-resource-hover-preview]")).toBeNull());

  fireEvent.pointerEnter(view.container.querySelector(`[data-tool-resource="senera://resource/${resourceIds[4]}"]`));
  await waitFor(() =>
    expect(document.body.querySelector('[data-resource-preview-content="text"] diffs-container')).not.toBeNull(),
  );
  await waitFor(() =>
    expect(
      document.body.querySelector('[data-resource-preview-content="text"] diffs-container')?.shadowRoot?.textContent,
    ).toContain("42"),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining(`/resources/${resourceIds[4]}`),
    expect.objectContaining({ credentials: "include" }),
  );
  expect(view.container.querySelector("[data-resource-hover-preview]")).toBeNull();
});

test("renders unified patches as readable diff rows instead of an undifferentiated text block", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        "diff --git a/.tmp/xiao-lu.json b/.tmp/xiao-lu.json\n--- a/.tmp/xiao-lu.json missing\n+++ b/.tmp/xiao-lu.json sha256:deadbeef 2026-09-24T10:50:27.095Z\n@@ -1,2 +1,2 @@\n-old value\n+new value",
    }),
  );

  const view = renderResources([resource("workspace.patch", "text/x-diff")]);

  expect(view.container.querySelector("[data-resource-diff]")).toBeNull();
  expect(document.body.querySelector("[data-resource-diff]")).toBeNull();
  fireEvent.pointerEnter(view.container.querySelector("[data-tool-resource]"));
  await waitFor(() => expect(document.body.querySelector("[data-resource-diff]")).not.toBeNull());
  let diffHost;
  await waitFor(() => {
    diffHost = document.body.querySelector("[data-resource-diff] diffs-container");
    expect(diffHost).not.toBeNull();
  });
  await waitFor(() => expect(diffHost?.shadowRoot?.textContent).toContain("new value"));
  expect(diffHost?.shadowRoot?.textContent).not.toContain("sha256:deadbeef");
  expect(diffHost?.shadowRoot?.textContent).not.toContain("missing");
});

test("uses canonical resource URLs for download and image enlargement", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    blob: async () => new Blob(["image"]),
  });
  vi.stubGlobal("fetch", fetchMock);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

  const view = renderResources([resource("preview.png", "image/png")]);
  expect(document.body.querySelector('[data-resource-preview-kind="image"] img')).toBeNull();
  fireEvent.pointerEnter(view.container.querySelector("[data-tool-resource]"));
  expect(document.body.querySelector("[data-resource-hover-preview]")).toBeNull();

  const download = view.getByRole("button", { name: frontendMessage("workflow.resource.download") });
  fireEvent.click(download);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(click).toHaveBeenCalled();

  fireEvent.click(view.getByRole("button", { name: "查看图片：preview.png" }));
  await waitFor(() => expect(document.body.querySelector("[data-image-preview-dialog]")).not.toBeNull());
  expect(document.body.querySelector("[data-image-preview-dialog] img")).toHaveAttribute(
    "src",
    expect.stringContaining(`/resources/${resourceId}`),
  );
  fireEvent.click(view.getByRole("button", { name: frontendMessage("ui.close") }));
  await waitFor(() => expect(document.body.querySelector("[data-image-preview-dialog]")).toBeNull());
});

test("reports a failed resource download instead of swallowing the error", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
  vi.stubGlobal("fetch", fetchMock);
  const toastError = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");

  const view = renderResources([resource("preview.png", "image/png")]);
  fireEvent.click(view.getByRole("button", { name: frontendMessage("workflow.resource.download") }));

  await waitFor(() => expect(toastError).toHaveBeenCalledWith(frontendMessage("resource.downloadFailed")));
});

test("bounds text previews before fetching oversized resources", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const view = renderResources([resource("large.log", "text/plain", 128 * 1024 + 1)]);

  expect(document.body.textContent).not.toContain("较大");
  fireEvent.pointerEnter(view.container.querySelector("[data-tool-resource]"));
  await waitFor(() => expect(document.body.textContent).toContain("较大"));
  expect(fetchMock).not.toHaveBeenCalled();
});

test("keeps the metadata view usable when no workspace resource controller is mounted", () => {
  const view = renderWithFrontendProviders(
    React.createElement(ToolResourcePreview, { resources: [resource("offline.bin", "application/octet-stream")] }),
  );

  expect(view.container.querySelector('[data-tool-resource][data-resource-kind="file"]')).not.toBeNull();
  expect(view.container.querySelector("button[aria-label]")).toBeNull();
});

test("merges later resource metadata without changing URI identity", () => {
  const resources = collectToolResources([
    { toolPresentation: { resources: [resource("placeholder.bin", "application/octet-stream")] } },
    {
      toolPresentation: {
        resources: [
          {
            ...resource("report.pdf", "application/pdf"),
            uri: `senera://resource/${resourceId}`,
            size: 42,
          },
        ],
      },
    },
  ]);

  expect(resources).toEqual([
    expect.objectContaining({
      uri: `senera://resource/${resourceId}`,
      name: "report.pdf",
      mime: "application/pdf",
      size: 42,
    }),
  ]);
});

test("keeps workspace changes separate from media resources and deduplicates repeated lifecycle rows", () => {
  const changes = collectToolWorkspaceChanges([
    {
      toolPresentation: {
        changes: [
          { kind: "workspace", key: "new.txt", status: "changed", workspaceStatus: "added", summary: "added" },
          { kind: "workspace", key: "old.txt", status: "changed", workspaceStatus: "deleted", summary: "deleted" },
          { kind: "evidence", key: "evidence", status: "added", summary: "evidence" },
        ],
      },
    },
    {
      toolPresentation: {
        changes: [{ kind: "workspace", key: "new.txt", status: "changed", workspaceStatus: "added", summary: "added" }],
      },
    },
  ]);
  const view = renderWithFrontendProviders(React.createElement(ToolWorkspaceChangePreview, { changes }));

  expect(changes).toHaveLength(2);
  expect(view.container.querySelectorAll("[data-workspace-change]")).toHaveLength(2);
  expect(view.container.textContent).toContain("new.txt");
  expect(view.container.textContent).toContain("old.txt");
  expect(view.container.querySelector('[data-workspace-change="old.txt"] button')?.hasAttribute("disabled")).toBe(true);
});

test("does not render a directory as a generated file in the run output", () => {
  const view = renderWithFrontendProviders(
    React.createElement(ToolArtifactPreview, {
      changes: [
        {
          kind: "workspace",
          key: "pelican-bicycle.svg",
          status: "changed",
          workspaceStatus: "added",
          workspaceBeforeKind: "missing",
          workspaceAfterKind: "file",
          summary: "added: pelican-bicycle.svg",
          addedLines: 170,
          removedLines: 0,
        },
        {
          kind: "workspace",
          key: "images",
          status: "changed",
          workspaceStatus: "added",
          workspaceBeforeKind: "missing",
          workspaceAfterKind: "directory",
          summary: "added: images",
        },
      ],
    }),
  );

  expect(view.container.querySelectorAll("[data-workspace-change]")).toHaveLength(1);
  expect(view.container.textContent).toContain("pelican-bicycle.svg");
  expect(view.container.textContent).not.toContain("images");
});

test("previews the hovered file from the hidden workspace patch without rendering a patch artifact", async () => {
  const patchResource = {
    ...resource("workspace.patch", "text/x-diff", undefined, resourceIds[0]),
    origin: "artifact",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        '===================================================================\n--- a/.tmp/xiao-lu.json missing\n+++ b/.tmp/xiao-lu.json sha256:deadbeef 2026-09-24T10:50:27.095Z\n@@ -0,0 +1,3 @@\n+{\n+  "name": "小鹿"\n+}\n',
    }),
  );

  const view = renderWithFrontendProviders(
    React.createElement(
      WorkspaceResourceProvider,
      { httpBaseUrl: "http://localhost:4310" },
      React.createElement(ToolWorkspaceChangePreview, {
        changes: [
          {
            kind: "workspace",
            key: ".tmp/xiao-lu.json",
            status: "changed",
            workspaceStatus: "added",
            summary: "added: .tmp/xiao-lu.json",
            addedLines: 3,
          },
        ],
        patchResources: [patchResource],
        showHeader: false,
      }),
    ),
  );

  fireEvent.mouseEnter(view.container.querySelector("[data-workspace-change-trigger]"));
  await waitFor(() => expect(document.body.querySelector("[data-workspace-change-preview]")).not.toBeNull());
  await waitFor(() => expect(document.body.querySelector('[data-workspace-preview-kind="diff"]')).not.toBeNull());

  expect(document.body.querySelector("[data-workspace-change-preview]")?.className).toContain(
    "w-[var(--radix-popover-trigger-width)]",
  );
  const diffHost = document.body.querySelector("[data-workspace-change-preview] [data-resource-diff] diffs-container");
  await waitFor(() => expect(diffHost?.shadowRoot?.textContent).toContain('"name"'));
  expect(document.body.textContent).not.toContain("workspace.patch");
  expect(vi.mocked(fetch)).toHaveBeenCalledWith(
    expect.stringContaining(`/resources/${resourceIds[0]}`),
    expect.objectContaining({ credentials: "include" }),
  );
});

test("falls back to the current workspace content when no line-level patch is available", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      resource: {
        path: "src/current.ts",
        name: "current.ts",
        mime: "text/typescript",
        size: 24,
        kind: "text",
        editable: true,
        etag: "etag",
        content: "export const value = 42;\n",
      },
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  const view = renderWithFrontendProviders(
    React.createElement(
      WorkspaceResourceProvider,
      { httpBaseUrl: "http://localhost:4310" },
      React.createElement(ToolWorkspaceChangePreview, {
        changes: [
          {
            kind: "workspace",
            key: "src/current.ts",
            status: "changed",
            workspaceStatus: "modified",
            summary: "modified: src/current.ts",
            addedLines: 1,
            removedLines: 1,
          },
        ],
        showHeader: false,
      }),
    ),
  );

  fireEvent.focus(view.container.querySelector("[data-workspace-change-trigger]"));
  await waitFor(() => expect(document.body.querySelector('[data-workspace-preview-kind="text"]')).not.toBeNull());
  const sourceHost = document.body.querySelector('[data-workspace-preview-kind="text"] diffs-container');
  await waitFor(() => expect(sourceHost?.shadowRoot?.textContent).toContain("export const value = 42;"));
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/api/resources?path=src%2Fcurrent.ts"),
    expect.objectContaining({ credentials: "include" }),
  );
});

test("keeps the net workspace status when one file changes across multiple tool steps", () => {
  const changes = collectToolWorkspaceChanges([
    {
      toolPresentation: {
        changes: [
          {
            kind: "workspace",
            key: "new.txt",
            status: "changed",
            workspaceStatus: "added",
            summary: "added: new.txt",
            addedLines: 2,
          },
        ],
        workspaceObservation: {
          status: "complete",
          beforeEntryCount: 1,
          afterEntryCount: 2,
          changedFileCount: 1,
          warningCount: 0,
        },
      },
    },
    {
      toolPresentation: {
        changes: [
          {
            kind: "workspace",
            key: "new.txt",
            status: "changed",
            workspaceStatus: "modified",
            summary: "modified: new.txt",
            addedLines: 1,
            removedLines: 1,
          },
        ],
        workspaceObservation: {
          status: "complete",
          beforeEntryCount: 2,
          afterEntryCount: 2,
          changedFileCount: 1,
          warningCount: 0,
        },
      },
    },
  ]);

  expect(changes).toEqual([
    expect.objectContaining({
      key: "new.txt",
      workspaceStatus: "added",
      addedLines: 3,
      removedLines: 1,
    }),
  ]);
  expect(
    collectToolWorkspaceObservation([
      {
        toolPresentation: {
          changes,
          workspaceObservation: {
            status: "complete",
            beforeEntryCount: 1,
            afterEntryCount: 2,
            changedFileCount: 1,
            warningCount: 0,
          },
        },
      },
      {
        toolPresentation: {
          workspaceObservation: {
            status: "complete",
            beforeEntryCount: 2,
            afterEntryCount: 2,
            changedFileCount: 1,
            warningCount: 0,
          },
        },
      },
    ]),
  ).toMatchObject({ beforeEntryCount: 1, afterEntryCount: 2, changedFileCount: 1, warningCount: 0 });
});

test("removes a file that was created and deleted within one run", () => {
  expect(
    collectToolWorkspaceChanges([
      {
        toolPresentation: {
          changes: [
            { kind: "workspace", key: "temporary.txt", status: "changed", workspaceStatus: "added", summary: "added" },
          ],
        },
      },
      {
        toolPresentation: {
          changes: [
            {
              kind: "workspace",
              key: "temporary.txt",
              status: "changed",
              workspaceStatus: "deleted",
              summary: "deleted",
            },
          ],
        },
      },
    ]),
  ).toEqual([]);
});

test("discloses observed tool-batch coverage without presenting it as a capture failure", () => {
  const observation = collectToolWorkspaceObservation([
    {
      toolPresentation: {
        workspaceObservation: {
          status: "complete",
          source: "filesystem-observer",
          sources: ["filesystem-observer"],
          coverage: "observed",
          scope: { kind: "tool_batch", id: "batch-1" },
          beforeEntryCount: 1,
          afterEntryCount: 2,
          changedFileCount: 1,
          warningCount: 0,
        },
      },
    },
  ]);
  const view = renderWithFrontendProviders(
    React.createElement(ToolWorkspaceChangePreview, {
      changes: [
        {
          kind: "workspace",
          key: "generated.txt",
          status: "changed",
          workspaceStatus: "added",
          summary: "added: generated.txt",
        },
      ],
      observation,
    }),
  );

  expect(view.container.querySelector('[data-workspace-observation="observed"]')).not.toBeNull();
  expect(view.container.querySelector('[data-workspace-observation="partial"]')).toBeNull();
  expect(view.container.textContent).toContain("同一批次观察");
});

test("shows a producer-neutral warning when bounded workspace capture is partial", () => {
  const observation = collectToolWorkspaceObservation([
    {
      toolPresentation: {
        workspaceObservation: {
          status: "partial",
          beforeEntryCount: 2,
          afterEntryCount: 2,
          changedFileCount: 0,
          warningCount: 1,
          warnings: ["capture boundary reached"],
        },
      },
    },
  ]);
  const view = renderWithFrontendProviders(
    React.createElement(ToolWorkspaceChangePreview, { changes: [], observation }),
  );

  expect(view.container.querySelector('[data-workspace-observation="partial"]')).not.toBeNull();
  expect(view.container.textContent).toContain("捕获警告");
});

test("renders a partial workspace warning once when projecting a complete artifact surface", () => {
  const observation = {
    status: "partial",
    beforeEntryCount: 2,
    afterEntryCount: 2,
    changedFileCount: 1,
    warningCount: 2,
    warnings: ["capture boundary reached", "nested directory skipped"],
  };
  const view = renderWithFrontendProviders(
    React.createElement(ToolArtifactPreview, {
      changes: [
        {
          kind: "workspace",
          key: "src/created.ts",
          status: "changed",
          workspaceStatus: "added",
          summary: "added: src/created.ts",
          addedLines: 1,
        },
      ],
      observation,
    }),
  );

  expect(view.container.textContent?.match(/工作区预览不完整/g)).toHaveLength(1);
  expect(view.container.querySelectorAll('[data-workspace-observation="partial"]')).toHaveLength(1);
});

test("collapses generated resources after three rows and reveals the rest on demand", async () => {
  const resources = [
    resource("one.png", "image/png", undefined, resourceIds[0]),
    resource("two.mp3", "audio/mpeg", undefined, resourceIds[1]),
    resource("three.pdf", "application/pdf", undefined, resourceIds[2]),
    resource("four.txt", "text/plain", undefined, resourceIds[3]),
  ];
  const view = renderWithFrontendProviders(
    React.createElement(
      WorkspaceResourceProvider,
      { httpBaseUrl: "http://localhost:4310" },
      React.createElement(ToolArtifactPreview, { resources }),
    ),
  );

  expect(view.container.querySelectorAll("[data-tool-resource]")).toHaveLength(3);
  expect(view.container.textContent).not.toContain("four.txt");
  const showMore = view.getByRole("button", { name: "再显示 1 个文件" });
  fireEvent.click(showMore);
  await waitFor(() => expect(view.container.querySelectorAll("[data-tool-resource]")).toHaveLength(4));
  expect(view.container.querySelector("[data-tool-resource-list]")).toHaveClass("rounded-lg", "border");
  fireEvent.click(view.getByRole("button", { name: "收起文件列表" }));
  await waitFor(() => expect(view.container.querySelectorAll("[data-tool-resource]")).toHaveLength(3));
});

test("right-side output rows keep open and download actions without hover previews", () => {
  const view = renderWithFrontendProviders(
    React.createElement(
      WorkspaceResourceProvider,
      { httpBaseUrl: "http://localhost:4310" },
      React.createElement(ToolArtifactPreview, {
        enableHoverPreview: false,
        resources: [resource("answer.txt", "text/plain")],
        changes: [
          {
            kind: "workspace",
            key: "src/answer.ts",
            status: "changed",
            workspaceStatus: "added",
            summary: "added: src/answer.ts",
            addedLines: 3,
          },
        ],
      }),
    ),
  );

  fireEvent.pointerEnter(view.container.querySelector("[data-tool-resource]"));
  fireEvent.pointerEnter(view.container.querySelector("[data-workspace-change-trigger]"));

  expect(document.body.querySelector("[data-resource-hover-preview]")).toBeNull();
  expect(document.body.querySelector("[data-workspace-change-preview]")).toBeNull();
  expect(view.getAllByRole("button", { name: frontendMessage("workflow.resource.download") })).toHaveLength(1);
  expect(view.getByRole("button", { name: frontendMessage("workflow.workspace.open") })).toBeInTheDocument();
});

test("does not open line previews or empty-content placeholders for binary workspace changes", async () => {
  const view = renderWithFrontendProviders(
    React.createElement(
      WorkspaceResourceProvider,
      { httpBaseUrl: "http://localhost:4310" },
      React.createElement(ToolWorkspaceChangePreview, {
        changes: [
          {
            kind: "workspace",
            key: ".tmp/assets/senera-workbench.png",
            status: "changed",
            workspaceStatus: "modified",
            summary: "modified: .tmp/assets/senera-workbench.png",
          },
        ],
      }),
    ),
  );

  fireEvent.pointerEnter(view.container.querySelector("[data-workspace-change]"));
  await new Promise((resolve) => setTimeout(resolve, 220));

  expect(document.body.querySelector("[data-workspace-change-preview]")).toBeNull();
  expect(view.container.textContent).not.toContain("没有可用的文件内容或行级变更");
  expect(view.container.querySelector("[data-workspace-change-trigger]")?.textContent).toContain(
    "senera-workbench.png",
  );
});

test("keeps workspace capture warnings in the execution surface instead of the conversation output", () => {
  const view = renderWithFrontendProviders(
    React.createElement(ToolRunOutputSummary, {
      run: {
        requestId: "request-output-warning",
        status: "completed",
        input: "copy image",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:01.000Z",
        steps: [
          {
            id: "tool-output-warning",
            kind: "tool",
            title: "copy image",
            status: "done",
            startedAt: "2026-01-01T00:00:00.000Z",
            endedAt: "2026-01-01T00:00:01.000Z",
            toolPresentation: {
              changes: [
                {
                  kind: "workspace",
                  key: ".tmp/assets/senera-workbench.png",
                  status: "changed",
                  workspaceStatus: "modified",
                  summary: "modified: .tmp/assets/senera-workbench.png",
                },
              ],
              workspaceObservation: {
                status: "partial",
                warningCount: 1,
                warnings: ["EBUSY"],
                beforeEntryCount: 1,
                afterEntryCount: 1,
                changedFileCount: 1,
              },
            },
          },
        ],
      },
    }),
  );

  expect(view.container.querySelector("[data-tool-run-output-summary]")).not.toBeNull();
  expect(view.container.textContent).not.toContain("工作区预览不完整");
  expect(view.container.textContent).not.toContain("捕获警告");
  expect(view.container.textContent).toContain("senera-workbench.png");
});

test("summarizes a run output after the execution details and keeps additional files expandable", async () => {
  const changes = Array.from({ length: 7 }, (_, index) => ({
    kind: "workspace",
    key: `src/file-${index}.ts`,
    status: "changed",
    workspaceStatus: index === 0 ? "added" : "modified",
    summary: `changed src/file-${index}.ts`,
    addedLines: index === 0 ? 4 : 1,
    removedLines: index === 0 ? 0 : 1,
  }));
  const view = renderWithFrontendProviders(
    React.createElement(ToolRunOutputSummary, {
      run: {
        requestId: "request-output",
        status: "completed",
        input: "create files",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:01.000Z",
        steps: [
          {
            id: "tool-output",
            kind: "tool",
            title: "write files",
            status: "done",
            startedAt: "2026-01-01T00:00:00.000Z",
            endedAt: "2026-01-01T00:00:01.000Z",
            toolPresentation: {
              resources: [resource("result.txt", "text/plain")],
              changes,
            },
          },
        ],
      },
    }),
  );

  expect(view.container.querySelector("[data-tool-run-output-summary]")).not.toBeNull();
  expect(view.container.textContent).toContain("本轮产出");
  expect(view.container.textContent).toContain("+10");
  expect(view.container.textContent).toContain("−6");
  expect(view.container.textContent).not.toContain("行");
  expect(view.container.querySelector(".text-emerald-700")).toHaveTextContent("+10");
  expect(view.container.querySelector(".text-rose-700")).toHaveTextContent("−6");
  expect(view.container.querySelectorAll("[data-workspace-change]")).toHaveLength(3);

  fireEvent.click(view.getByRole("button", { name: "再显示 4 个文件" }));
  await waitFor(() => expect(view.container.querySelectorAll("[data-workspace-change]")).toHaveLength(7));
  expect(view.getByRole("button", { name: "收起文件列表" })).toBeInTheDocument();
});

test("merges lifecycle and detail changes without dropping workspace metadata", () => {
  const merged = mergeToolResultPresentation(
    {
      type: "senera.tool_result_presentation.v1",
      version: 1,
      status: "success",
      headline: "created",
      facts: [],
      evidence: [],
      changes: [
        {
          kind: "workspace",
          status: "changed",
          key: "src/created.ts",
          summary: "added: src/created.ts",
          workspaceStatus: "added",
          addedLines: 1,
        },
      ],
    },
    {
      type: "senera.tool_result_presentation.v1",
      version: 1,
      status: "success",
      headline: "created",
      facts: [],
      evidence: [],
      changes: [
        {
          kind: "workspace",
          status: "changed",
          key: "src/created.ts",
          summary: "added: src/created.ts",
          removedLines: 0,
        },
      ],
      workspaceCheckpoint: {
        id: "workspace:revision",
        baseRevision: "base",
        revision: "revision",
        capturedAt: "2026-08-13T00:00:01.000Z",
        changedPaths: ["src/created.ts"],
        changeDigest: "digest",
      },
    },
  );

  expect(merged?.changes).toEqual([
    expect.objectContaining({
      key: "src/created.ts",
      workspaceStatus: "added",
      addedLines: 1,
      removedLines: 0,
    }),
  ]);
  expect(merged?.workspaceCheckpoint?.changedPaths).toEqual(["src/created.ts"]);
});

function renderResources(resources) {
  return renderWithFrontendProviders(
    React.createElement(
      WorkspaceResourceProvider,
      { httpBaseUrl: "http://localhost:4310" },
      React.createElement(ToolResourcePreview, { layout: "grid", resources }),
    ),
  );
}

function resource(name, mime, size, id = resourceId) {
  return {
    uri: `senera://resource/${id}`,
    name,
    mime,
    ...(size === undefined ? {} : { size }),
    origin: "tool",
  };
}
