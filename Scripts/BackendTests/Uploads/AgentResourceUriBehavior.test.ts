import { describe, expect, test } from "vitest";
import {
  createAgentResourceId,
  createAgentResourceUri,
  normalizeAgentResourceUri,
  parseAgentResourceId,
} from "../../../Source/AgentSystem/Resources/AgentResourceUri.js";
import {
  AgentUploadAttachmentListSchema,
  AgentUploadManifestSchema,
} from "../../../Source/AgentSystem/Uploads/AgentUploadTypes.js";

describe("Senera resource URIs", () => {
  test("uses one canonical URI for every addressable resource", () => {
    const uri = createAgentResourceUri("upl_fixture");

    expect(uri).toBe("senera://resource/upl_fixture");
    expect(parseAgentResourceId(uri)).toBe("upl_fixture");
    expect(normalizeAgentResourceUri(uri)).toBe(uri);
  });

  test("rejects retired upload and artifact asset authorities", () => {
    expect(normalizeAgentResourceUri("senera://upload/upl_fixture")).toBeUndefined();
    expect(normalizeAgentResourceUri("senera://artifact-asset/image-1")).toBeUndefined();
  });

  test("rejects ambiguous or unsafe references", () => {
    for (const value of [
      "https://example.test/resource",
      "senera://other/upl_fixture",
      "senera://resource/a/b",
      "senera://resource/..%2Foutside",
      "senera://resource/upl_fixture?token=secret",
    ]) {
      expect(normalizeAgentResourceUri(value)).toBeUndefined();
    }
  });

  test("derives a stable safe id for plugin-defined asset labels", () => {
    const first = createAgentResourceId("plugin/output/image 1");
    const second = createAgentResourceId("plugin/output/image 1");

    expect(first).toBe(second);
    expect(first).toMatch(/^res_[a-f0-9]{32}$/u);
    expect(parseAgentResourceId(createAgentResourceUri(first))).toBe(first);
  });

  test("accepts only canonical resource fields", () => {
    const manifest = AgentUploadManifestSchema.parse({
      resourceId: "upl_fixture",
      resourceUri: "senera://resource/upl_fixture",
      name: "notes.txt",
      mime: "text/plain",
      size: 5,
      sha256: "a".repeat(64),
      createdAt: "2026-01-01T00:00:00.000Z",
      storage: { fileName: "original" },
    });

    expect(manifest).toMatchObject({
      resourceId: "upl_fixture",
      resourceUri: "senera://resource/upl_fixture",
    });
    expect(() =>
      AgentUploadManifestSchema.parse({
        uploadId: "upl_fixture",
        uploadUri: "senera://upload/upl_fixture",
        name: "notes.txt",
        mime: "text/plain",
        size: 5,
        sha256: "a".repeat(64),
        createdAt: "2026-01-01T00:00:00.000Z",
        storage: { fileName: "original" },
      }),
    ).toThrow();
  });

  test("accepts only canonical session attachments", () => {
    const [attachment] = AgentUploadAttachmentListSchema.parse([
      {
        resourceUri: "senera://resource/upl_fixture",
        name: "notes.txt",
        mime: "text/plain",
        size: 5,
        status: "uploaded",
      },
    ]);

    expect(attachment).toMatchObject({ resourceUri: "senera://resource/upl_fixture" });
    expect(() =>
      AgentUploadAttachmentListSchema.parse([
        {
          uploadUri: "senera://upload/upl_fixture",
          name: "notes.txt",
          mime: "text/plain",
          size: 5,
          status: "uploaded",
        },
      ]),
    ).toThrow();
  });
});
