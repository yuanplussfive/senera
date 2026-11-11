import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageUsageTable } from "../../../Frontend/src/features/settings/sections/StorageUsageTable.tsx";
import { WorkspaceResourceProvider } from "../../../Frontend/src/shared/workspace/WorkspaceResourceProvider.tsx";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const workspaceId = "9d361ae3-a20a-4b65-a299-b9d47c2e9f26";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StorageUsageTable", () => {
  it("lists locations and refreshes usage explicitly", async () => {
    let failNextStorageRequest = false;
    const fetchMock = vi.fn(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/migrations")) return jsonResponse({ workspaces: [] });
      if (url.pathname.endsWith("/application-storage")) {
        if (failNextStorageRequest) return new Response("", { status: 500 });
        return jsonResponse(
          url.searchParams.get("scope") === "project" ? createProjectStorageSnapshot() : createStorageSnapshot(),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderTable("http://127.0.0.1:4190");

    await screen.findByText("应用状态");
    expect(screen.getByText("workspace")).toBeVisible();
    expect(screen.getByText("128 B")).toBeVisible();
    expect(screen.getAllByText("64 B")).toHaveLength(2);
    expect(screen.getByText("合计")).toBeVisible();
    expect(screen.getByText(/统计于/)).toBeVisible();
    expect(screen.queryByText("迁移备份")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看项目文件占用" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = new URL(String(input));
          return url.searchParams.get("scope") === "project" && url.searchParams.get("workspaceId") === workspaceId;
        }),
      ).toBe(true),
    );
    expect(await screen.findByText("4.7 GiB")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "刷新存储占用" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = new URL(String(input));
          return url.searchParams.get("scope") === "runtime" && url.searchParams.get("refresh") === "1";
        }),
      ).toBe(true),
    );

    failNextStorageRequest = true;
    await user.click(screen.getByRole("button", { name: "刷新存储占用" }));

    await screen.findByText("无法读取存储占用 (500)");
    expect(screen.getByText("应用状态")).toBeVisible();

    failNextStorageRequest = false;
    await user.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.queryByText("无法读取存储占用 (500)")).not.toBeInTheDocument());
    expect(screen.getByText("应用状态")).toBeVisible();
  });

  it("coalesces usage refreshes when several backups are cleaned", async () => {
    vi.stubGlobal("confirm", () => true);
    const migrationSnapshot = createMigrationSnapshot();
    const [firstBackup] = migrationSnapshot.workspaces[0].inventory.backups;
    migrationSnapshot.workspaces[0].inventory.backups.push({
      ...firstBackup,
      id: "2026-10-15T10-00-00-000Z",
      path: "C:/workspace/.senera/migrations/2026-10-15T10-00-00-000Z",
    });
    const fetchMock = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/migrations")) {
        if (init?.method === "DELETE") return new Response("", { status: 200 });
        return jsonResponse(migrationSnapshot);
      }
      if (url.pathname.endsWith("/application-storage")) return jsonResponse(createStorageSnapshot());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderTable("http://127.0.0.1:4193");

    const cleanButtons = await screen.findAllByRole("button", { name: "清理" });
    expect(cleanButtons).toHaveLength(2);
    await user.click(cleanButtons[0]);
    await user.click(screen.getAllByRole("button", { name: "清理" })[1]);

    const refreshCalls = () =>
      fetchMock.mock.calls.filter(([input]) => {
        const url = new URL(String(input));
        return url.pathname.endsWith("/application-storage") && url.searchParams.get("refresh") === "1";
      });
    await waitFor(() => expect(refreshCalls()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(refreshCalls()).toHaveLength(1);
  });

  it("shows migration backups and cleans one when confirmed", async () => {
    vi.stubGlobal("confirm", () => true);
    const fetchMock = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/migrations")) {
        if (init?.method === "DELETE") return new Response("", { status: 200 });
        return jsonResponse(createMigrationSnapshot());
      }
      if (url.pathname.endsWith("/application-storage")) return jsonResponse(createStorageSnapshot());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderTable("http://127.0.0.1:4191");

    expect(await screen.findByText("迁移备份")).toBeVisible();
    expect(screen.getByText("备份目录")).toBeVisible();
    expect(screen.getByRole("button", { name: "清理" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "清理" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url = new URL(String(input));
          return url.pathname.endsWith("/migrations") && init?.method === "DELETE";
        }),
      ).toBe(true),
    );
  });

  it("reopens with the last usage snapshot instead of waiting for a new scan", async () => {
    const fetchMock = vi.fn(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/migrations")) return jsonResponse({ workspaces: [] });
      if (url.pathname.endsWith("/application-storage")) return jsonResponse(createStorageSnapshot());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const render = () => renderTable("http://127.0.0.1:4192");

    const first = render();
    expect(await screen.findByText("应用状态")).toBeVisible();
    first.unmount();

    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/migrations")) return jsonResponse({ workspaces: [] });
      return new Promise(() => undefined);
    });
    render();
    expect(screen.getByText("应用状态")).toBeVisible();
    expect(screen.getByText("128 B")).toBeVisible();
  });
});

function renderTable(httpBaseUrl) {
  return renderWithFrontendProviders(
    React.createElement(
      WorkspaceResourceProvider,
      { httpBaseUrl },
      React.createElement(StorageUsageTable, {
        workspace: {
          snapshot: {
            workspaceId,
            workspaceRoot: "C:/workspace",
            configPath: "C:/workspace/senera.config.json",
          },
          refresh: vi.fn(),
        },
      }),
    ),
  );
}

function createProjectStorageSnapshot() {
  const snapshot = createStorageSnapshot();
  snapshot.bytes = 86799085;
  snapshot.workspaces[0].bytes = 2281579884;
  snapshot.workspaces[0].projectBytes = 5000000000;
  snapshot.workspaces[0].projectCoverage = "partial";
  snapshot.workspaces[0].projectUnavailableEntryCount = 3;
  snapshot.workspaces.push({
    id: "0f6dd2d0-6f0e-4bd8-b17b-2c53f9f76dd1",
    name: "media",
    root: "C:/media",
    stateRoot: "C:/media/.senera",
    scope: "workspace-state",
    bytes: 148600926,
    coverage: "complete",
    unavailableEntryCount: 0,
  });
  snapshot.projectScanIncluded = true;
  snapshot.projectScanWorkspaceId = workspaceId;
  return snapshot;
}

function createMigrationSnapshot() {
  return {
    workspaces: [
      {
        id: workspaceId,
        name: "workspace",
        root: "C:/workspace",
        inventory: {
          stateRoot: "C:/workspace/.senera",
          migrationRoot: "C:/workspace/.senera/migrations",
          markerPath: "C:/workspace/.senera/migrations/marker.json",
          markerStatus: "valid",
          backups: [
            {
              id: "2026-10-14T16-16-28-023Z",
              path: "C:/workspace/.senera/migrations/2026-10-14T16-16-28-023Z",
              bytes: 81267546,
              createdAt: "2026-10-14T16:16:28.025Z",
              referencedByMarker: true,
            },
          ],
        },
      },
    ],
  };
}

function createStorageSnapshot() {
  return {
    root: "C:/application-state",
    scope: "application-state",
    measuredAt: "2026-11-10T03:00:00.000Z",
    bytes: 128,
    coverage: "complete",
    unavailableEntryCount: 0,
    workspaces: [
      {
        id: workspaceId,
        name: "workspace",
        root: "C:/workspace",
        stateRoot: "C:/workspace/.senera",
        scope: "workspace-state",
        bytes: 64,
        coverage: "complete",
        unavailableEntryCount: 0,
      },
    ],
    projectScanIncluded: false,
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}
