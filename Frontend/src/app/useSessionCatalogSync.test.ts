import { describe, expect, it } from "vitest";
import {
  buildConnectionOpenSyncRequests,
  buildManualRefreshRequests,
} from "./useSessionCatalogSync";
import type { UserProfile } from "../store/sessionStore";

const syncedProfile: UserProfile = {
  name: "Ada",
  avatarDataUrl: null,
  updatedAt: "2026-06-08T00:00:00.000Z",
  syncState: "synced",
};

describe("buildConnectionOpenSyncRequests", () => {
  it("requests the catalog, models, and remote profile snapshot for synced profiles", () => {
    expect(buildConnectionOpenSyncRequests(syncedProfile)).toEqual([
      { type: "session.list" },
      { type: "model.list" },
      { type: "plugin.config.list" },
      { type: "profile.get" },
    ]);
  });

  it("pushes a pending local profile before reading the remote profile", () => {
    expect(buildConnectionOpenSyncRequests({
      ...syncedProfile,
      name: "Grace",
      avatarDataUrl: "data:image/png;base64,avatar",
      syncState: "pending",
    })).toEqual([
      { type: "session.list" },
      { type: "model.list" },
      { type: "plugin.config.list" },
      {
        type: "profile.update",
        profile: {
          name: "Grace",
          avatarDataUrl: "data:image/png;base64,avatar",
        },
      },
    ]);
  });
});

describe("buildManualRefreshRequests", () => {
  it("always refreshes catalog, models, and profile snapshot without pushing local profile edits", () => {
    expect(buildManualRefreshRequests()).toEqual([
      { type: "session.list" },
      { type: "model.list" },
      { type: "plugin.config.list" },
      { type: "profile.get" },
    ]);
  });
});
