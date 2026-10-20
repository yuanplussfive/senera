import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageSettings } from "../../../Frontend/src/features/settings/sections/StorageSettings.tsx";
import { WorkspaceResourceProvider } from "../../../Frontend/src/shared/workspace/WorkspaceResourceProvider.tsx";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const workspaceId = "9d361ae3-a20a-4b65-a299-b9d47c2e9f26";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StorageSettings", () => {
  it("keeps configuration behind the shared view switch and preserves the last usable usage snapshot", async () => {
    let failNextStorageRequest = false;
    const fetchMock = vi.fn(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/migrations")) return jsonResponse({ workspaces: [] });
      if (url.pathname.endsWith("/application-storage")) {
        if (failNextStorageRequest) return new Response("", { status: 500 });
        return jsonResponse(createStorageSnapshot());
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithFrontendProviders(
      React.createElement(
        WorkspaceResourceProvider,
        { httpBaseUrl: "http://127.0.0.1:4180" },
        React.createElement(StorageSettings, {
          workspace: {
            snapshot: {
              workspaceId,
              workspaceRoot: "C:/workspace",
              configPath: "C:/workspace/senera.config.json",
            },
            refresh: vi.fn(),
          },
          configuration: React.createElement("div", null, "存储配置字段"),
        }),
      ),
    );

    await screen.findByText("应用状态");
    expect(await screen.findByText("暂无可清理的迁移备份")).toBeVisible();
    expect(screen.queryByText("存储配置字段")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看项目文件占用" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          new RegExp(`scope=project.*workspaceId=${workspaceId}`).test(String(input)),
        ),
      ).toBe(true),
    );

    await user.click(screen.getByRole("radio", { name: "配置" }));
    expect(screen.getByText("存储配置字段")).toBeVisible();

    await user.click(screen.getByRole("radio", { name: "概览" }));
    failNextStorageRequest = true;
    await user.click(screen.getByRole("button", { name: "刷新存储占用" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => /scope=runtime/.test(String(input)))).toBe(true));

    await screen.findByText("无法读取存储占用 (500)");
    expect(screen.getByText("应用状态")).toBeVisible();

    failNextStorageRequest = false;
    await user.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.queryByText("无法读取存储占用 (500)")).not.toBeInTheDocument());
    expect(screen.getByText("应用状态")).toBeVisible();
  });

  it("shows one labelled row per location with its facts and a copy affordance", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText }, onLine: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/migrations")) return jsonResponse(createMigrationSnapshot());
        if (url.pathname.endsWith("/application-storage")) return jsonResponse(createProjectStorageSnapshot());
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderWithFrontendProviders(
      React.createElement(
        WorkspaceResourceProvider,
        { httpBaseUrl: "http://127.0.0.1:4180" },
        React.createElement(StorageSettings, {
          workspace: {
            snapshot: {
              workspaceId,
              workspaceRoot: "C:/workspace",
              configPath: "C:/workspace/senera.config.json",
            },
            refresh: vi.fn(),
          },
          configuration: React.createElement("div", null, "存储配置字段"),
        }),
      ),
    );

    expect(await screen.findByText("83MB")).toBeVisible();
    expect(screen.getByText("当前")).toBeVisible();
    expect(screen.getAllByText("根目录")).toHaveLength(2);
    expect(screen.getByText("状态目录")).toBeVisible();
    expect(screen.getByText("配置文件")).toBeVisible();
    expect(screen.getByText("2.1GB")).toBeVisible();
    expect(screen.getByText("4.7GB")).toBeVisible();
    expect(screen.getByText("合计")).toBeVisible();
    expect(screen.getByText("2.3GB")).toBeVisible();
    expect(screen.getByText("部分统计：3 项内容无法读取")).toBeVisible();
    expect(screen.getByText("备份目录")).toBeVisible();
    expect(screen.getAllByText("78MB")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "清理" })).toBeEnabled();
    expect(screen.queryByText("工作区目录")).not.toBeInTheDocument();

    expect(screen.getAllByRole("button", { name: "复制路径" })).toHaveLength(6);
    fireEvent.click(screen.getAllByRole("button", { name: "复制路径" })[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("C:/application-state"));
  });
});

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
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
